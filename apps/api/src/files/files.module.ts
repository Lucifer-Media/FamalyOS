import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { LocalStorageService } from './local-storage.service';

@Module({
  providers: [FilesService, LocalStorageService],
  controllers: [FilesController],
  exports: [FilesService],
})
export class FilesModule {}
