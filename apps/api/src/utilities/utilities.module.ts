import { Module } from '@nestjs/common';
import { UtilitiesController } from './utilities.controller';
import { UtilitiesService } from './utilities.service';
import { EntitiesModule } from '../entities/entities.module';

@Module({
  imports: [EntitiesModule],
  controllers: [UtilitiesController],
  providers: [UtilitiesService],
})
export class UtilitiesModule {}
