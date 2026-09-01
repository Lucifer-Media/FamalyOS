import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { PortfolioService } from './portfolio.service';

@UseGuards(JwtAuthGuard)
@Controller('finance/portfolio')
export class PortfolioController {
  constructor(private readonly service: PortfolioService) {}

  @Get('net-worth')
  getNetWorth(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string) {
    return this.service.getNetWorth(userId, familySpaceId);
  }

  @Get('loans/:loanId/schedule')
  getSchedule(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('loanId') loanId: string) {
    return this.service.getSchedule(userId, familySpaceId, loanId);
  }

  @Post('loans/:loanId/simulate-early-repayment')
  simulateEarlyRepayment(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('loanId') loanId: string,
    @Body() dto: { extraPayment: number; fromPaymentNumber: number; mode: 'REDUCE_TERM' | 'REDUCE_PAYMENT' },
  ) {
    return this.service.simulateEarlyRepayment(userId, familySpaceId, loanId, dto);
  }

  @Post('loans/:loanId/compare-refinance')
  compareRefinance(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('loanId') loanId: string,
    @Body() dto: { annualRatePercent: number; termMonths: number; feesFlat?: number },
  ) {
    return this.service.compareRefinance(userId, familySpaceId, loanId, dto);
  }
}
