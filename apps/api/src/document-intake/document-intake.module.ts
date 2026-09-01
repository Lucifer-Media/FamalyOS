import { Module } from '@nestjs/common';
import { DocumentIntakeService } from './document-intake.service';
import { DocumentIntakeController } from './document-intake.controller';
import { OcrService } from './ocr.service';
import { OcrProcessor } from './ocr.processor';
import { OcrQueueModule } from './ocr-queue.module';
import { FilesModule } from '../files/files.module';
import { EntitiesModule } from '../entities/entities.module';
import { AiAssistantModule } from '../ai-assistant/ai-assistant.module';

@Module({
  imports: [FilesModule, EntitiesModule, OcrQueueModule, AiAssistantModule],
  providers: [DocumentIntakeService, OcrService, OcrProcessor],
  controllers: [DocumentIntakeController],
})
export class DocumentIntakeModule {}
