import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { FilesService } from '../files/files.service';
import { OcrService } from './ocr.service';
import { classifyDocumentText, extractSuggestedAttributes } from '../entity-types/document-classifier';
import { AuditService } from '../audit/audit.service';
import { OCR_QUEUE_NAME } from './ocr-queue.module';
import { OcrJobData } from './document-intake.service';

/**
 * Воркер очереди — здесь и происходит собственно OCR/классификация/
 * извлечение полей, вынесенные из HTTP-запроса загрузки. Работает в том же
 * процессе Node (NestJS), но асинхронно относительно веб-запросов: если
 * приходит 20 документов подряд, все они мгновенно встают в очередь, а
 * воркер обрабатывает их один за другим (concurrency настраивается —
 * намеренно ограничена, чтобы не перегружать CPU домашнего сервера
 * несколькими параллельными Tesseract-процессами одновременно).
 */
@Processor(OCR_QUEUE_NAME, { concurrency: 2 })
export class OcrProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly ocr: OcrService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<OcrJobData>): Promise<void> {
    const { intakeId, userId, familySpaceId, fileId, targetEntityId } = job.data;
    this.logger.log(`Обработка intake ${intakeId} (файл ${fileId})`);

    try {
      const file = await this.prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
      const targetEntity = targetEntityId
        ? await this.prisma.entity.findUnique({ where: { id: targetEntityId } })
        : null;

      const { buffer } = await this.files.readBuffer(userId, familySpaceId, fileId);
      const ocrResult = await this.ocr.extract(buffer, file.mimeType);

      const savedOcr = await this.prisma.fileOcrResult.create({
        data: {
          fileId,
          fileVersion: file.currentVersion,
          engine: 'TESSERACT',
          language: 'rus',
          textSource: ocrResult.textSource,
          extractedText: ocrResult.extractedText,
          confidence: ocrResult.confidence,
          errorMessage: ocrResult.errorMessage,
          rawBlocks: ocrResult.pages ? ({ pages: ocrResult.pages } as any) : undefined,
        },
      });

      const entityType =
        targetEntity?.entityType ??
        (ocrResult.extractedText ? classifyDocumentText(ocrResult.extractedText)?.entityType : undefined);
      const classification = targetEntity
        ? { entityType: targetEntity.entityType, confidence: 1 }
        : ocrResult.extractedText
          ? classifyDocumentText(ocrResult.extractedText)
          : null;

      const extraction =
        entityType && ocrResult.extractedText
          ? extractSuggestedAttributes(entityType, ocrResult.extractedText)
          : { attributes: {}, fieldConfidence: {} };

      await this.prisma.documentIntake.update({
        where: { id: intakeId },
        data: {
          ocrResultId: savedOcr.id,
          suggestedEntityType: classification?.entityType,
          suggestedAttributes: extraction.attributes as any,
          suggestedFieldConfidence: extraction.fieldConfidence as any,
          suggestedConfidence: classification?.confidence,
          // Готово к подтверждению пользователем — даже если ocrResult.errorMessage
          // заполнен, это штатная ситуация ("не удалось распознать"), не сбой воркера.
          status: 'PENDING',
        },
      });

      await this.audit.log({
        familySpaceId,
        actorUserId: userId,
        action: 'document_intake.processed',
        resourceType: 'DocumentIntake',
        resourceId: intakeId,
        metadata: {
          suggestedEntityType: classification?.entityType,
          ocrTextSource: ocrResult.textSource,
          ocrHasError: Boolean(ocrResult.errorMessage),
        },
      });
    } catch (err) {
      // Сюда попадают ТОЛЬКО непредвиденные сбои воркера (недоступна БД, файл
      // повреждён на уровне чтения и т.п.) — обычные "OCR не смог распознать"
      // обрабатываются выше как штатный результат со статусом PENDING.
      this.logger.error(`Сбой обработки intake ${intakeId}`, err as Error);
      await this.prisma.documentIntake
        .update({
          where: { id: intakeId },
          data: { status: 'FAILED', processingError: (err as Error).message },
        })
        .catch(() => undefined);
      await this.audit
        .log({
          familySpaceId,
          actorUserId: userId,
          action: 'document_intake.failed',
          resourceType: 'DocumentIntake',
          resourceId: intakeId,
          metadata: { error: (err as Error).message },
        })
        .catch(() => undefined);
      throw err; // позволяем BullMQ учесть попытку/повторить согласно defaultJobOptions
    }
  }
}
