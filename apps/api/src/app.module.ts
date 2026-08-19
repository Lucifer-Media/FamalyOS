import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { FamilySpacesModule } from './family-spaces/family-spaces.module';
import { MembershipsModule } from './memberships/memberships.module';
import { PeopleModule } from './people/people.module';
import { EntitiesModule } from './entities/entities.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { FilesModule } from './files/files.module';
import { SearchModule } from './search/search.module';
import { HealthController } from './health/health.controller';
import { EntityTypesModule } from './entity-types/entity-types.module';
import { DocumentIntakeModule } from './document-intake/document-intake.module';
import { PassportRfModule } from './passport-rf/passport-rf.module';
import { FirstAidKitsModule } from './first-aid-kits/first-aid-kits.module';
import { FinanceModule } from './finance/finance.module';
import { CurrencyRatesModule } from './currency-rates/currency-rates.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    CommonModule,
    AuditModule,
    AuthModule,
    FamilySpacesModule,
    MembershipsModule,
    PeopleModule,
    EntitiesModule,
    KnowledgeBaseModule,
    FilesModule,
    SearchModule,
    EntityTypesModule,
    DocumentIntakeModule,
    PassportRfModule,
    FirstAidKitsModule,
    FinanceModule,
    CurrencyRatesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  controllers: [HealthController],
})
export class AppModule {}
