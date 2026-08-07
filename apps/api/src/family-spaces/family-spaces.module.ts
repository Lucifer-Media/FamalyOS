import { Module } from '@nestjs/common';
import { FamilySpacesService } from './family-spaces.service';
import { FamilySpacesController } from './family-spaces.controller';

@Module({
  providers: [FamilySpacesService],
  controllers: [FamilySpacesController],
  exports: [FamilySpacesService],
})
export class FamilySpacesModule {}
