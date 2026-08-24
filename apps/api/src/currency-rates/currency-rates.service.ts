import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';

export interface CreateCurrencyRateInput {
  date: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  source?: string;
}

@Injectable()
export class CurrencyRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async getRates(userId: string, familySpaceId: string, fromCurrency?: string, toCurrency?: string) {
    await this.permissions.getMembership(userId, familySpaceId);
    return this.prisma.currencyRate.findMany({
      where: {
        familySpaceId,
        ...(fromCurrency ? { fromCurrency } : {}),
        ...(toCurrency ? { toCurrency } : {}),
      },
      orderBy: { date: 'desc' },
      take: 200,
    });
  }

  /** Ближайший известный курс на дату или раньше — для конвертации сумм прошлых операций. */
  async getRateForDate(userId: string, familySpaceId: string, fromCurrency: string, toCurrency: string, date: string) {
    await this.permissions.getMembership(userId, familySpaceId);
    if (fromCurrency === toCurrency) return { rate: 1, date, source: 'identity' };

    const rate = await this.prisma.currencyRate.findFirst({
      where: { familySpaceId, fromCurrency, toCurrency, date: { lte: new Date(date) } },
      orderBy: { date: 'desc' },
    });
    if (rate) return rate;

    // Пробуем обратный курс, если прямого нет.
    const inverse = await this.prisma.currencyRate.findFirst({
      where: { familySpaceId, fromCurrency: toCurrency, toCurrency: fromCurrency, date: { lte: new Date(date) } },
      orderBy: { date: 'desc' },
    });
    if (inverse) {
      return { ...inverse, rate: 1 / Number(inverse.rate), fromCurrency, toCurrency, source: `inverse:${inverse.source ?? 'manual'}` };
    }
    return null;
  }

  /** Создание/обновление курса на дату — идемпотентно по (дата, пара валют). */
  async createRate(userId: string, familySpaceId: string, dto: CreateCurrencyRateInput) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    if (!(await this.permissions.can(membership, 'FINANCE', 'MANAGE'))) {
      throw new ForbiddenException('Нет прав на управление курсами валют');
    }

    return this.prisma.currencyRate.upsert({
      where: {
        date_fromCurrency_toCurrency: {
          date: new Date(dto.date),
          fromCurrency: dto.fromCurrency,
          toCurrency: dto.toCurrency,
        },
      },
      create: {
        familySpaceId,
        date: new Date(dto.date),
        fromCurrency: dto.fromCurrency,
        toCurrency: dto.toCurrency,
        rate: dto.rate,
        source: dto.source ?? 'manual',
        createdBy: userId,
      },
      update: { rate: dto.rate, source: dto.source ?? 'manual' },
    });
  }

  /**
   * Курсы валют — справочные данные, но проект последовательно придерживается
   * принципа "никогда не удалять физически" (см. все остальные модули).
   * Вместо DELETE — создание корректирующей записи той же датой/парой валют
   * (createRate уже обновляет существующую запись, если она есть).
   * Отдельного метода удаления сознательно нет.
   */
}
