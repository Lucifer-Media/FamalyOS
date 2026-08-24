import { Module } from '@nestjs/common';
import { CurrencyRatesService } from './currency-rates.service';
import { CurrencyRatesController } from './currency-rates.controller';

// CommonModule (PrismaService, PermissionsService) — @Global(), уже
// зарегистрирован в app.module.ts, явный импорт здесь не нужен.
@Module({
  providers: [CurrencyRatesService],
  controllers: [CurrencyRatesController],
  exports: [CurrencyRatesService],
})
export class CurrencyRatesModule {}
