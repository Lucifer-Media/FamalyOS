import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PermissionsService } from './permissions.service';

@Global()
@Module({
  providers: [PrismaService, PermissionsService],
  exports: [PrismaService, PermissionsService],
})
export class CommonModule {}
