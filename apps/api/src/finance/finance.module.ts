import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceImportService } from './finance-import.service';
import { FinanceAnalyticsService } from './finance-analytics.service';
import { EntitiesModule } from '../entities/entities.module';

@Module({
  imports: [EntitiesModule],
  controllers: [FinanceController],
  providers: [FinanceImportService, FinanceAnalyticsService],
})
export class FinanceModule {}
