import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceImportService } from './finance-import.service';
import { EntitiesModule } from '../entities/entities.module';

@Module({
  imports: [EntitiesModule],
  controllers: [FinanceController],
  providers: [FinanceImportService],
})
export class FinanceModule {}
