import { Module } from '@nestjs/common';
import { CurrencyRatesService } from './currency-rates.service';
import { CurrencyRatesController } from './currency-rates.controller';
import { PrismaModule } from '../common/prisma.module';
import { PermissionsModule } from '../common/permissions.module';

@Module({
  imports: [PrismaModule, PermissionsModule],
  providers: [CurrencyRatesService],
  controllers: [CurrencyRatesController],
  exports: [CurrencyRatesService],
})
export class CurrencyRatesModule {}
