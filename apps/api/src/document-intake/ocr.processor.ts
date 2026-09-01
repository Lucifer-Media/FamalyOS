import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { FilesService } from '../files/files.service';
import { OcrService } from './ocr.service';
import { classifyDocumentText, extractSuggestedAttributes, applyOcrQualityToClassification } from '../entity-types/document-classifier';
import { getEntityTypeSchema } from '../entity-types/entity-type-registry';
import { OllamaService } from '../ai-assistant/ollama.service';
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
    private readonly ollama: OllamaService,
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

      const rawClassification = targetEntity
        ? { entityType: targetEntity.entityType, confidence: 1, matchedKeywords: [] as string[] }
        : ocrResult.extractedText
          ? classifyDocumentText(ocrResult.extractedText)
          : null;
      // Понижаем/обнуляем уверенность классификации, если сам OCR распознал
      // текст ненадёжно — иначе случайное совпадение ключевой фразы в шуме
      // может дать обманчиво высокую уверенность (см. комментарий в
      // applyOcrQualityToClassification).
      const classification = targetEntity
        ? rawClassification
        : applyOcrQualityToClassification(rawClassification, ocrResult.extractedText, ocrResult.confidence);

      const entityType = classification?.entityType;

      const extraction =
        entityType && ocrResult.extractedText
          ? extractSuggestedAttributes(entityType, ocrResult.extractedText)
          : { attributes: {}, fieldConfidence: {} };

      // Дополнение через локальную LLM (Ollama) — ТОЛЬКО если она настроена
      // (OLLAMA_URL) и regex-извлечение нашло мало полей. Никогда не
      // перезаписывает то, что уже нашла надёжная regex-логика — только
      // добавляет то, чего там не было. Полностью опционально: без
      // OLLAMA_URL этот блок не делает ни одного сетевого вызова.
      if (entityType && ocrResult.extractedText && this.ollama.isConfigured()) {
        const schema = getEntityTypeSchema(entityType);
        const missingFieldCount = schema ? schema.fields.length - Object.keys(extraction.attributes).length : 0;
        if (schema && missingFieldCount > 0) {
          const llmResult = await this.ollama.extractFields(entityType, schema.fields, ocrResult.extractedText);
          if (!llmResult.unavailable) {
            for (const [key, value] of Object.entries(llmResult.attributes)) {
              if (extraction.attributes[key] === undefined) {
                extraction.attributes[key] = value;
                extraction.fieldConfidence[key] = llmResult.fieldConfidence[key];
              }
            }
          }
        }
      }

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
