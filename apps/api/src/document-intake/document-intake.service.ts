import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { classifyDocumentText, extractSuggestedAttributes } from '../entity-types/document-classifier';
import { getEntityTypeSchema } from '../entity-types/entity-type-registry';
import { extractMedicalPartyGuesses, findBestNameMatch } from '../entity-types/document-classifier';
import { EntitiesService } from '../entities/entities.service';
import { computeFieldConflicts, FieldConflict } from './field-conflicts';
import { OCR_QUEUE_NAME } from './ocr-queue.module';

/** Типы документов личности, которые имеет смысл автоматически связывать
 * друг с другом, если они принадлежат одному человеку (раздел 14 ТЗ). */
const IDENTITY_DOCUMENT_TYPES = new Set([
  'passport_rf',
  'snils',
  'inn',
  'foreign_passport',
  'residence_permit',
  'permanent_residence',
  'driver_license',
]);

/** Медицинские типы, для которых пытаемся автосвязать врача/организацию по тексту документа. */
const MEDICAL_LINKABLE_TYPES = new Set(['medical_visit', 'medical_conclusion', 'prescription', 'vaccination']);

export interface OcrJobData {
  intakeId: string;
  userId: string;
  familySpaceId: string;
  fileId: string;
  targetEntityId?: string;
}

@Injectable()
export class DocumentIntakeService {
  private readonly logger = new Logger(DocumentIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
    @InjectQueue(OCR_QUEUE_NAME) private readonly ocrQueue: Queue<OcrJobData>,
  ) {}

  /**
   * Шаг 1 конвейера: загрузка уже произошла (используется существующий
   * FilesService.upload). Здесь мы НЕ выполняем OCR синхронно — создаём
   * запись со статусом PROCESSING и ставим задачу в очередь Redis/BullMQ,
   * после чего немедленно возвращаем ответ. Это позволяет грузить десятки
   * документов подряд, не блокируя интерфейс на время распознавания
   * (раздел 22 ТЗ Итерации 2).
   */
  async createFromUploadedFile(
    userId: string,
    familySpaceId: string,
    fileId: string,
    targetEntityId?: string,
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'DOCUMENTS', 'CREATE');

    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Файл не найден');
    }

    if (targetEntityId) {
      const found = await this.prisma.entity.findUnique({ where: { id: targetEntityId } });
      if (!found || found.familySpaceId !== familySpaceId) {
        throw new BadRequestException('Сущность для переобработки не найдена в этом пространстве');
      }
    }

    // Обнаружение возможного дубликата — дешёвый запрос по контрольной сумме,
    // делаем сразу, не дожидаясь очереди, чтобы предупреждение появилось мгновенно.
    const possibleDuplicateOfEntityId = await this.findPossibleDuplicate(familySpaceId, fileId, file.checksumSha256);

    const intake = await this.prisma.documentIntake.create({
      data: {
        familySpaceId,
        fileId,
        targetEntityId: targetEntityId ?? undefined,
        possibleDuplicateOfEntityId,
        status: 'PROCESSING',
        createdByUserId: userId,
      },
    });

    await this.ocrQueue.add('process-document', {
      intakeId: intake.id,
      userId,
      familySpaceId,
      fileId,
      targetEntityId,
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'document_intake.queued',
      resourceType: 'DocumentIntake',
      resourceId: intake.id,
      metadata: { targetEntityId, possibleDuplicateOfEntityId },
    });

    return { intake };
  }

  private async findPossibleDuplicate(
    familySpaceId: string,
    fileId: string,
    checksumSha256: string,
  ): Promise<string | undefined> {
    const duplicateFile = await this.prisma.fileObject.findFirst({
      where: { familySpaceId, checksumSha256, id: { not: fileId } },
    });
    if (!duplicateFile) return undefined;
    const priorIntake = await this.prisma.documentIntake.findFirst({
      where: { fileId: duplicateFile.id, status: 'CONFIRMED', confirmedEntityId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    return priorIntake?.confirmedEntityId ?? undefined;
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

    let fieldConflicts: FieldConflict[] | undefined;
    if (intake.targetEntityId && intake.suggestedAttributes) {
      const targetEntity = await this.prisma.entity.findUnique({ where: { id: intake.targetEntityId } });
      if (targetEntity) {
        fieldConflicts = computeFieldConflicts(
          (targetEntity.attributes ?? {}) as Record<string, unknown>,
          intake.suggestedAttributes as Record<string, unknown>,
          (intake.suggestedFieldConfidence ?? {}) as Record<string, number>,
        );
      }
    }

    return { intake, ocr, fieldConflicts };
  }

  /** Повторная постановка в очередь — для FAILED (сбой воркера) или PENDING с ошибкой OCR. */
  async retry(userId: string, familySpaceId: string, id: string) {
    const intake = await this.prisma.documentIntake.findUnique({ where: { id } });
    if (!intake || intake.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Запись приёмки документа не найдена');
    }
    if (intake.status !== 'PENDING' && intake.status !== 'FAILED') {
      throw new BadRequestException('Повторная обработка возможна только для необработанных или сбойных записей');
    }

    await this.prisma.documentIntake.update({
      where: { id },
      data: { status: 'PROCESSING', processingError: null },
    });
    await this.ocrQueue.add('process-document', {
      intakeId: intake.id,
      userId,
      familySpaceId,
      fileId: intake.fileId,
      targetEntityId: intake.targetEntityId ?? undefined,
    });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'document_intake.retry',
      resourceType: 'DocumentIntake',
      resourceId: id,
    });
    return this.get(userId, familySpaceId, id);
  }

  async list(userId: string, familySpaceId: string, status?: string, confirmedEntityId?: string) {
    await this.permissions.getMembership(userId, familySpaceId);
    return this.prisma.documentIntake.findMany({
      where: {
        familySpaceId,
        ...(status ? { status: status as any } : {}),
        ...(confirmedEntityId ? { confirmedEntityId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Постраничная разметка составных документов (раздел 20 ТЗ Итерации 2):
   * многостраничный скан паспорта содержит основной разворот, страницу
   * регистрации, семейного положения, детей и т.д. — каждая страница имеет
   * собственный OCR-результат, и пользователь может разметить их по
   * отдельности, а не одним слитным текстом.
   */
  async listPages(userId: string, familySpaceId: string, id: string) {
    await this.permissions.getMembership(userId, familySpaceId);
    const intake = await this.prisma.documentIntake.findUnique({ where: { id } });
    if (!intake || intake.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Запись приёмки документа не найдена');
    }
    if (!intake.ocrResultId) return [];
    const ocr = await this.prisma.fileOcrResult.findUnique({ where: { id: intake.ocrResultId } });
    const rawBlocks = ocr?.rawBlocks as { pages?: { pageNumber: number; text: string; confidence: number | null }[] } | null;
    return rawBlocks?.pages ?? [];
  }

  /**
   * Создаёт отдельную запись приёмки документа НА ОСНОВЕ ОДНОЙ СТРАНИЦЫ уже
   * распознанного многостраничного скана — без повторного OCR (текст уже
   * есть). Используется для разметки составных документов: "эта страница —
   * регистрация", "эта — сведения о детях" и т.д. Родительскую сущность
   * (сам паспорт) пользователь связывает как parentEntityId при подтверждении.
   */
  async createIntakeFromPage(
    userId: string,
    familySpaceId: string,
    parentIntakeId: string,
    pageNumber: number,
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'DOCUMENTS', 'CREATE');

    const parentIntake = await this.prisma.documentIntake.findUnique({ where: { id: parentIntakeId } });
    if (!parentIntake || parentIntake.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Родительская запись приёмки не найдена');
    }
    const pages = await this.listPages(userId, familySpaceId, parentIntakeId);
    const page = pages.find((p) => p.pageNumber === pageNumber);
    if (!page) {
      throw new BadRequestException(`Страница ${pageNumber} не найдена в этом документе`);
    }

    const classification = page.text ? classifyDocumentText(page.text) : null;
    const extraction =
      classification && page.text ? extractSuggestedAttributes(classification.entityType, page.text) : { attributes: {}, fieldConfidence: {} };

    // Отдельный FileOcrResult для этой "виртуальной страницы" — чтобы у неё
    // была своя запись с текстом именно этой страницы, а не всего документа.
    const pageOcr = await this.prisma.fileOcrResult.create({
      data: {
        fileId: parentIntake.fileId,
        fileVersion: 1,
        engine: 'TESSERACT',
        language: 'rus',
        textSource: 'ocr',
        extractedText: page.text,
        confidence: page.confidence,
      },
    });

    const intake = await this.prisma.documentIntake.create({
      data: {
        familySpaceId,
        fileId: parentIntake.fileId,
        ocrResultId: pageOcr.id,
        suggestedEntityType: classification?.entityType,
        suggestedAttributes: extraction.attributes as any,
        suggestedFieldConfidence: extraction.fieldConfidence as any,
        suggestedConfidence: classification?.confidence,
        status: 'PENDING',
        createdByUserId: userId,
      },
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'document_intake.page_split',
      resourceType: 'DocumentIntake',
      resourceId: intake.id,
      metadata: { parentIntakeId, pageNumber, suggestedEntityType: classification?.entityType },
    });

    return { intake, ocr: pageOcr };
  }

  /**
   * Шаг 6-7: пользователь подтверждает (возможно, исправив) предложенные
   * тип и реквизиты. Если intake.targetEntityId задан — это переобработка,
   * и мы ОБНОВЛЯЕМ существующую сущность (новая версия, история не
   * теряется) вместо создания новой. Иначе — создаётся новая Entity.
   */
  async confirm(
    userId: string,
    familySpaceId: string,
    id: string,
    dto: {
      entityType: string;
      title: string;
      attributes: Record<string, unknown>;
      ownerPersonId?: string;
      parentEntityId?: string;
      additionalPersonIds?: string[]; // для сценария "документ ребёнка виден и у родителя"
    },
  ) {
    const intake = await this.prisma.documentIntake.findUnique({ where: { id } });
    if (!intake || intake.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Запись приёмки документа не найдена');
    }
    if (intake.status === 'PROCESSING') {
      throw new BadRequestException('Документ ещё обрабатывается — подождите завершения OCR');
    }
    if (intake.status !== 'PENDING') {
      throw new BadRequestException('Эта запись уже обработана');
    }
    if (!getEntityTypeSchema(dto.entityType)) {
      throw new BadRequestException(`Неизвестный тип документа: ${dto.entityType}`);
    }

    let entity: { id: string; entityType: string };

    if (intake.targetEntityId) {
      entity = await this.entities.update(userId, familySpaceId, intake.targetEntityId, {
        title: dto.title,
        attributes: dto.attributes,
        changeSummary: 'Обновлено переобработкой документа через OCR-конвейер (с подтверждением пользователя)',
      });
      await this.prisma.entityFile.create({
        data: { entityId: entity.id, fileId: intake.fileId, relationRole: 'scan' },
      });
    } else {
      entity = await this.entities.create(userId, familySpaceId, {
        entityType: dto.entityType,
        title: dto.title,
        attributes: dto.attributes,
        ownerPersonId: dto.ownerPersonId,
        parentEntityId: dto.parentEntityId,
        changeSummary: 'Создано подтверждением загруженного документа (OCR-конвейер)',
      });
      await this.prisma.entityFile.create({
        data: { entityId: entity.id, fileId: intake.fileId, relationRole: 'scan' },
      });

      for (const personId of dto.additionalPersonIds ?? []) {
        await this.prisma.entityPersonLink
          .create({
            data: { entityId: entity.id, personId, relationRole: 'guardian_view', createdByUserId: userId },
          })
          .catch(() => undefined);
      }

      if (dto.ownerPersonId && IDENTITY_DOCUMENT_TYPES.has(dto.entityType)) {
        const siblingDocs = await this.prisma.entity.findMany({
          where: {
            familySpaceId,
            ownerPersonId: dto.ownerPersonId,
            entityType: { in: [...IDENTITY_DOCUMENT_TYPES] },
            status: 'ACTIVE',
            id: { not: entity.id },
          },
          take: 10,
        });
        for (const sibling of siblingDocs) {
          await this.prisma.entityLink
            .create({
              data: {
                sourceEntityId: entity.id,
                targetEntityId: sibling.id,
                linkType: 'identity_document_of_same_person',
                createdByUserId: userId,
              },
            })
            .catch(() => undefined);
        }
      }

      // Автосвязь врача/медицинской организации по тексту документа (эвристика
      // по подписанным меткам, не NLP) — раздел 6 ТЗ Итерации 2: "OCR должен
      // уметь связать рецепт → врач → медицинская организация".
      if (MEDICAL_LINKABLE_TYPES.has(dto.entityType) && intake.ocrResultId) {
        await this.autoLinkMedicalParties(userId, familySpaceId, entity.id, dto.entityType, intake.ocrResultId);
      }
    }

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
      metadata: { entityType: dto.entityType, entityId: entity.id, wasReprocessing: Boolean(intake.targetEntityId) },
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

  private async autoLinkMedicalParties(
    userId: string,
    familySpaceId: string,
    entityId: string,
    entityType: string,
    ocrResultId: string,
  ): Promise<void> {
    const ocr = await this.prisma.fileOcrResult.findUnique({ where: { id: ocrResultId } });
    if (!ocr?.extractedText) return;

    const guesses = extractMedicalPartyGuesses(entityType, ocr.extractedText);
    if (!guesses.doctorFullName && !guesses.organizationName) return;

    const [doctors, organizations] = await Promise.all([
      this.prisma.entity.findMany({
        where: { familySpaceId, entityType: 'doctor', status: 'ACTIVE' },
        select: { id: true, title: true },
      }),
      this.prisma.entity.findMany({
        where: { familySpaceId, entityType: 'medical_organization', status: 'ACTIVE' },
        select: { id: true, title: true },
      }),
    ]);

    const doctorMatchId = findBestNameMatch(guesses.doctorFullName, doctors);
    const orgMatchId = findBestNameMatch(guesses.organizationName, organizations);

    for (const [targetId, linkType] of [
      [doctorMatchId, 'performed_by_doctor'],
      [orgMatchId, 'at_medical_organization'],
    ] as const) {
      if (!targetId) continue;
      await this.prisma.entityLink
        .create({
          data: { sourceEntityId: entityId, targetEntityId: targetId, linkType, createdByUserId: userId },
        })
        .catch(() => undefined); // уже связано или другое ограничение — не критично
    }
  }
}
