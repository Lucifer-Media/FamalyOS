import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { PortfolioController } from './portfolio.controller';
import { FinanceImportService } from './finance-import.service';
import { FinanceAnalyticsService } from './finance-analytics.service';
import { FinanceDashboardService } from './finance-dashboard.service';
import { PortfolioService } from './portfolio.service';
import { EntitiesModule } from '../entities/entities.module';

@Module({
  imports: [EntitiesModule],
  controllers: [FinanceController, PortfolioController],
  providers: [FinanceImportService, FinanceAnalyticsService, FinanceDashboardService, PortfolioService],
})
export class FinanceModule {}
