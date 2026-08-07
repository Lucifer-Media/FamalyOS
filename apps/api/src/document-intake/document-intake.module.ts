import { Module } from '@nestjs/common';
import { DocumentIntakeService } from './document-intake.service';
import { DocumentIntakeController } from './document-intake.controller';
import { OcrService } from './ocr.service';
import { FilesModule } from '../files/files.module';
import { EntitiesModule } from '../entities/entities.module';

@Module({
  imports: [FilesModule, EntitiesModule],
  providers: [DocumentIntakeService, OcrService],
  controllers: [DocumentIntakeController],
})
export class DocumentIntakeModule {}
