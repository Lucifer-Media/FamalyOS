import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { EntitiesService } from '../entities/entities.service';
import { extractMeterReadingCandidates, MeterReadingCandidate } from '../entity-types/document-classifier';

export interface MeterReadingCandidateWithMatch extends MeterReadingCandidate {
  matchedMeterId?: string;
  matchedMeterTitle?: string;
}

@Injectable()
export class UtilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly entities: EntitiesService,
  ) {}

  /**
   * Разбирает поле breakdown квитанции на кандидатов показаний (только
   * надёжный построчный формат — см. extractMeterReadingCandidates) и
   * пытается сопоставить каждого с уже заведённым в системе счётчиком по
   * номеру. Ничего не создаётся автоматически — только предложение для
   * подтверждения пользователем.
   */
  async getMeterReadingCandidates(userId: string, familySpaceId: string, billId: string) {
    await this.permissions.getMembership(userId, familySpaceId);
    const bill = await this.prisma.entity.findUnique({ where: { id: billId } });
    if (!bill || bill.familySpaceId !== familySpaceId || bill.entityType !== 'utility_bill') {
      throw new NotFoundException('Квитанция не найдена');
    }
    const breakdown = (bill.attributes as Record<string, unknown>).breakdown as string | undefined;
    if (!breakdown) return { candidates: [], breakdown: null };

    const rawCandidates = extractMeterReadingCandidates(breakdown);
    const meters = await this.prisma.entity.findMany({
      where: { familySpaceId, entityType: 'utility_meter', status: 'ACTIVE' },
      select: { id: true, title: true, attributes: true },
    });

    const candidates: MeterReadingCandidateWithMatch[] = rawCandidates.map((c) => {
      const matched = meters.find(
        (m: { id: string; title: string; attributes: unknown }) =>
          (m.attributes as Record<string, unknown>).meterNumber === c.meterNumber,
      );
      return { ...c, matchedMeterId: matched?.id, matchedMeterTitle: matched?.title };
    });

    return { candidates, breakdown };
  }

  /**
   * Подтверждение одного кандидата показания: либо привязка к уже
   * существующему счётчику (meterId), либо создание нового счётчика "по
   * ходу" (newMeter) — оба пути в итоге создают meter_reading через
   * EntitiesService (версионирование, аудит, автосвязи — как и везде).
   */
  async confirmMeterReading(
    userId: string,
    familySpaceId: string,
    billId: string,
    input: {
      meterId?: string;
      newMeter?: { locationId?: string; resourceType: string; meterNumber: string };
      value: number;
      date: string;
    },
  ) {
    const bill = await this.prisma.entity.findUnique({ where: { id: billId } });
    if (!bill || bill.familySpaceId !== familySpaceId || bill.entityType !== 'utility_bill') {
      throw new NotFoundException('Квитанция не найдена');
    }

    let meterId = input.meterId;
    if (!meterId) {
      if (!input.newMeter) {
        throw new BadRequestException('Нужно указать существующий счётчик (meterId) или данные нового (newMeter)');
      }
      const meter = await this.entities.create(userId, familySpaceId, {
        entityType: 'utility_meter',
        title: `${input.newMeter.resourceType} — счётчик №${input.newMeter.meterNumber}`,
        attributes: {
          resourceType: input.newMeter.resourceType,
          meterNumber: input.newMeter.meterNumber,
          locationId: input.newMeter.locationId,
        },
        changeSummary: 'Создано при разборе показаний квитанции ЖКХ',
      });
      meterId = meter.id;
    }

    const reading = await this.entities.create(userId, familySpaceId, {
      entityType: 'meter_reading',
      title: `Показание от ${input.date}`,
      attributes: {
        meterId,
        date: input.date,
        value: input.value,
        source: 'OCR',
        sourceDocumentId: billId,
      },
      changeSummary: 'Показание из квитанции ЖКХ (подтверждено пользователем)',
    });

    return reading;
  }
}
