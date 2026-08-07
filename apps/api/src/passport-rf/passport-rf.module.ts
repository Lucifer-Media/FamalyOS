import { Module } from '@nestjs/common';
import { PassportRfController } from './passport-rf.controller';
import { EntitiesModule } from '../entities/entities.module';

@Module({
  imports: [EntitiesModule],
  controllers: [PassportRfController],
})
export class PassportRfModule {}
