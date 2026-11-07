import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { PortfolioController } from './portfolio.controller';
import { FinanceAutomationController } from './finance-automation.controller';
import { FinanceImportService } from './finance-import.service';
import { FinanceAnalyticsService } from './finance-analytics.service';
import { FinanceDashboardService } from './finance-dashboard.service';
import { PortfolioService } from './portfolio.service';
import { FinanceAutomationService } from './finance-automation.service';
import { FinanceAiService } from './finance-ai.service';
import { EntitiesModule } from '../entities/entities.module';
import { AiAssistantModule } from '../ai-assistant/ai-assistant.module';

@Module({
  imports: [EntitiesModule, AiAssistantModule],
  controllers: [FinanceController, PortfolioController, FinanceAutomationController],
  providers: [
    FinanceImportService,
    FinanceAnalyticsService,
    FinanceDashboardService,
    PortfolioService,
    FinanceAutomationService,
    FinanceAiService,
  ],
})
export class FinanceModule {}
