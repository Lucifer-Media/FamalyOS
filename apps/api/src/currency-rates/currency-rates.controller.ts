import { Controller, Get, Post, Delete, Query, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { CurrencyRatesService, CreateCurrencyRateDto } from './currency-rates.service';

@UseGuards(JwtAuthGuard)
@Controller('currency-rates')
export class CurrencyRatesController {
  constructor(private readonly service: CurrencyRatesService) {}

  @Get()
  getRates(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('from') fromCurrency: string,
    @Query('to') toCurrency: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getRates(
      userId,
      familySpaceId,
      fromCurrency,
      toCurrency,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('latest')
  getLatestRate(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('from') fromCurrency: string,
    @Query('to') toCurrency: string,
    @Query('asOf') asOfDate?: string,
  ) {
    return this.service.getLatestRate(
      userId,
      familySpaceId,
      fromCurrency,
      toCurrency,
      asOfDate ? new Date(asOfDate) : undefined,
    );
  }

  @Post()
  createRate(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Body() dto: CreateCurrencyRateDto,
  ) {
    return this.service.createRate(userId, familySpaceId, dto);
  }

  @Delete(':id')
  deleteRate(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteRate(userId, familySpaceId, id);
  }
}
