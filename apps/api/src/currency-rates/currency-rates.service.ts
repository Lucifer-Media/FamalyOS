import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { roleAllows } from '../common/permissions';

export interface CreateCurrencyRateDto {
  date: string; // ISO date
  fromCurrency: string; // ISO 4217 code (RUB, USD, EUR...)
  toCurrency: string; // ISO 4217 code
  rate: number; // Exchange rate: 1 fromCurrency = rate toCurrency
  source?: string; // Source: 'CBR', 'ECB', 'manual', etc.
}

@Injectable()
export class CurrencyRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async getRates(
    userId: string,
    familySpaceId: string,
    fromCurrency: string,
    toCurrency: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    if (!await this.permissions.can(membership, 'FINANCE', 'VIEW')) {
      return [];
    }

    const where: any = {
      familySpaceId,
      fromCurrency,
      toCurrency,
    };

    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    return this.prisma.currencyRate.findMany({
      where,
      orderBy: { date: 'desc' },
    });
  }

  async getLatestRate(
    userId: string,
    familySpaceId: string,
    fromCurrency: string,
    toCurrency: string,
    asOfDate?: Date,
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    if (!await this.permissions.can(membership, 'FINANCE', 'VIEW')) {
      return null;
    }

    const where: any = {
      familySpaceId,
      fromCurrency,
      toCurrency,
    };

    if (asOfDate) {
      where.date = { lte: asOfDate };
    }

    return this.prisma.currencyRate.findFirst({
      where,
      orderBy: { date: 'desc' },
    });
  }

  async createRate(
    userId: string,
    familySpaceId: string,
    dto: CreateCurrencyRateDto,
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    if (!await this.permissions.can(membership, 'FINANCE', 'MANAGE')) {
      throw new Error('Нет прав на управление курсами валют');
    }

    // Проверка на дубликат
    const existing = await this.prisma.currencyRate.findUnique({
      where: {
        date_fromCurrency_toCurrency: {
          date: new Date(dto.date),
          fromCurrency: dto.fromCurrency,
          toCurrency: dto.toCurrency,
        },
      },
    });

    if (existing) {
      // Обновляем существующую запись
      return this.prisma.currencyRate.update({
        where: {
          id: existing.id,
        },
        data: {
          rate: dto.rate,
          source: dto.source,
          createdBy: userId,
        },
      });
    }

    return this.prisma.currencyRate.create({
      data: {
        familySpaceId,
        date: new Date(dto.date),
        fromCurrency: dto.fromCurrency,
        toCurrency: dto.toCurrency,
        rate: dto.rate,
        source: dto.source,
        createdBy: userId,
      },
    });
  }

  async deleteRate(
    userId: string,
    familySpaceId: string,
    rateId: string,
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    if (!await this.permissions.can(membership, 'FINANCE', 'MANAGE')) {
      throw new Error('Нет прав на удаление курсов валют');
    }

    const rate = await this.prisma.currencyRate.findUnique({
      where: { id: rateId },
    });

    if (!rate || rate.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Курс валют не найден');
    }

    return this.prisma.currencyRate.delete({
      where: { id: rateId },
    });
  }
}
