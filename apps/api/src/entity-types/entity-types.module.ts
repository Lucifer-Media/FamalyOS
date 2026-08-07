import { Module } from '@nestjs/common';
import { EntityTypesController } from './entity-types.controller';

@Module({
  controllers: [EntityTypesController],
})
export class EntityTypesModule {}
