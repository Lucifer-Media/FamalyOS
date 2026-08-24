import { Controller, Get, Post, Query, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { CurrencyRatesService, CreateCurrencyRateInput } from './currency-rates.service';

@UseGuards(JwtAuthGuard)
@Controller('currency-rates')
export class CurrencyRatesController {
  constructor(private readonly service: CurrencyRatesService) {}

  @Get()
  getRates(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getRates(userId, familySpaceId, from, to);
  }

  @Get('for-date')
  getRateForDate(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string,
  ) {
    return this.service.getRateForDate(userId, familySpaceId, from, to, date);
  }

  @Post()
  createRate(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Body() dto: CreateCurrencyRateInput,
  ) {
    return this.service.createRate(userId, familySpaceId, dto);
  }
}
