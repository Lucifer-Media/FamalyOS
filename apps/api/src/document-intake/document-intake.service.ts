import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { OcrService } from './ocr.service';
import { classifyDocumentText, extractSuggestedAttributes } from '../entity-types/document-classifier';
import { getEntityTypeSchema } from '../entity-types/entity-type-registry';
import { EntitiesService } from '../entities/entities.service';

@Injectable()
export class DocumentIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly ocr: OcrService,
    private readonly entities: EntitiesService,
  ) {}

  /**
   * Шаг 1-5 конвейера: загрузка уже произошла (используется существующий
   * FilesService.upload), здесь — распознавание + классификация +
   * предзаполнение. Реальная карточка (Entity) ЕЩЁ НЕ создаётся — только
   * предложение, ожидающее подтверждения пользователем (шаг 6-7).
   */
  async createFromUploadedFile(userId: string, familySpaceId: string, fileId: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'DOCUMENTS', 'CREATE');

    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Файл не найден');
    }

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
      },
    });

    const classification = ocrResult.extractedText
      ? classifyDocumentText(ocrResult.extractedText)
      : null;
    const suggestedAttributes = classification
      ? extractSuggestedAttributes(classification.entityType, ocrResult.extractedText)
      : {};

    const intake = await this.prisma.documentIntake.create({
      data: {
        familySpaceId,
        fileId,
        ocrResultId: savedOcr.id,
        suggestedEntityType: classification?.entityType,
        suggestedAttributes: suggestedAttributes as any,
        suggestedConfidence: classification?.confidence,
        status: 'PENDING',
        createdByUserId: userId,
      },
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'document_intake.create',
      resourceType: 'DocumentIntake',
      resourceId: intake.id,
      metadata: {
        suggestedEntityType: classification?.entityType,
        ocrTextSource: ocrResult.textSource,
        ocrHasError: Boolean(ocrResult.errorMessage),
      },
    });

    return { intake, ocr: savedOcr };
  }

  async get(userId: string, familySpaceId: string, id: string) {
    await this.permissions.getMembership(userId, familySpaceId);
    const intake = await this.prisma.documentIntake.findUnique({ where: { id } });
    if (!intake || intake.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Запись приёмки документа не найдена');
    }
    const ocr = intake.ocrResultId
      ? await this.prisma.fileOcrResult.findUnique({ where: { id: intake.ocrResultId } })
      : null;
    return { intake, ocr };
  }

  async list(userId: string, familySpaceId: string, status?: string) {
    await this.permissions.getMembership(userId, familySpaceId);
    return this.prisma.documentIntake.findMany({
      where: { familySpaceId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Шаг 6-7: пользователь подтверждает (возможно, исправив) предложенные
   * тип и реквизиты — только теперь создаётся настоящая Entity через
   * обычный EntitiesService (со всей версионностью/правами/аудитом).
   */
  async confirm(
    userId: string,
    familySpaceId: string,
    id: string,
    dto: { entityType: string; title: string; attributes: Record<string, unknown>; ownerPersonId?: string },
  ) {
    const intake = await this.prisma.documentIntake.findUnique({ where: { id } });
    if (!intake || intake.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Запись приёмки документа не найдена');
    }
    if (intake.status !== 'PENDING') {
      throw new BadRequestException('Эта запись уже обработана');
    }
    if (!getEntityTypeSchema(dto.entityType)) {
      throw new BadRequestException(`Неизвестный тип документа: ${dto.entityType}`);
    }

    const entity = await this.entities.create(userId, familySpaceId, {
      entityType: dto.entityType,
      title: dto.title,
      attributes: dto.attributes,
      ownerPersonId: dto.ownerPersonId,
      changeSummary: 'Создано подтверждением загруженного документа (OCR-конвейер)',
    });

    // Прикрепляем исходный файл к созданной карточке как "original"/"scan".
    await this.prisma.entityFile.create({
      data: { entityId: entity.id, fileId: intake.fileId, relationRole: 'scan' },
    });

    await this.prisma.documentIntake.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedEntityId: entity.id, resolvedAt: new Date() },
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'document_intake.confirm',
      resourceType: 'DocumentIntake',
      resourceId: id,
      metadata: { entityType: dto.entityType, entityId: entity.id },
    });

    return entity;
  }

  async reject(userId: string, familySpaceId: string, id: string) {
    const intake = await this.prisma.documentIntake.findUnique({ where: { id } });
    if (!intake || intake.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Запись приёмки документа не найдена');
    }
    await this.prisma.documentIntake.update({
      where: { id },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'document_intake.reject',
      resourceType: 'DocumentIntake',
      resourceId: id,
    });
    return { success: true };
  }
}
