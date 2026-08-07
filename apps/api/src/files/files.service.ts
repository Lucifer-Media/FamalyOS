import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfidentialityLevel } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { LocalStorageService } from './local-storage.service';

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalStorageService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async upload(
    userId: string,
    familySpaceId: string,
    file: Express.Multer.File,
    opts: { confidentialityLevel?: ConfidentialityLevel; entityId?: string; relationRole?: string },
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FILES', 'CREATE');

    const saved = await this.storage.save(familySpaceId, file.buffer, file.originalname);

    const fileObject = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.fileObject.create({
        data: {
          familySpaceId,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: saved.sizeBytes,
          checksumSha256: saved.checksumSha256,
          storageBackend: 'LOCAL',
          storageKey: saved.storageKey,
          confidentialityLevel: opts.confidentialityLevel ?? 'STANDARD',
          currentVersion: 1,
          createdByUserId: userId,
        },
      });
      await tx.fileVersion.create({
        data: {
          fileId: created.id,
          versionNumber: 1,
          storageKey: saved.storageKey,
          sizeBytes: saved.sizeBytes,
          checksumSha256: saved.checksumSha256,
          createdByUserId: userId,
          changeNote: 'Первая загрузка',
        },
      });
      if (opts.entityId) {
        await tx.entityFile.create({
          data: {
            entityId: opts.entityId,
            fileId: created.id,
            relationRole: opts.relationRole ?? 'attachment',
          },
        });
      }
      return created;
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'file.upload',
      resourceType: 'FileObject',
      resourceId: fileObject.id,
      metadata: { originalName: file.originalname, sizeBytes: saved.sizeBytes },
    });

    return fileObject;
  }

  async addVersion(userId: string, familySpaceId: string, fileId: string, file: Express.Multer.File, changeNote?: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FILES', 'EDIT');

    const existing = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!existing || existing.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Файл не найден');
    }
    const saved = await this.storage.save(familySpaceId, file.buffer, file.originalname);
    const nextVersion = existing.currentVersion + 1;

    const updated = await this.prisma.$transaction(async (tx: any) => {
      const saved2 = await tx.fileObject.update({
        where: { id: fileId },
        data: {
          storageKey: saved.storageKey,
          sizeBytes: saved.sizeBytes,
          checksumSha256: saved.checksumSha256,
          currentVersion: nextVersion,
        },
      });
      await tx.fileVersion.create({
        data: {
          fileId,
          versionNumber: nextVersion,
          storageKey: saved.storageKey,
          sizeBytes: saved.sizeBytes,
          checksumSha256: saved.checksumSha256,
          createdByUserId: userId,
          changeNote,
        },
      });
      return saved2;
    });

    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'file.new_version',
      resourceType: 'FileObject',
      resourceId: fileId,
      metadata: { version: nextVersion },
    });

    return updated;
  }

  async get(userId: string, familySpaceId: string, fileId: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FILES', 'VIEW');
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.familySpaceId !== familySpaceId) {
      throw new NotFoundException('Файл не найден');
    }
    await this.permissions.assertConfidentialityAccess(membership, file.confidentialityLevel);
    return file;
  }

  async listVersions(userId: string, familySpaceId: string, fileId: string) {
    await this.get(userId, familySpaceId, fileId);
    return this.prisma.fileVersion.findMany({ where: { fileId }, orderBy: { versionNumber: 'desc' } });
  }

  async listForFamilySpace(userId: string, familySpaceId: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FILES', 'VIEW');
    const canConfidential = await this.permissions.can(membership, 'CONFIDENTIAL', 'VIEW');
    return this.prisma.fileObject.findMany({
      where: {
        familySpaceId,
        status: { not: 'VOID' },
        ...(canConfidential ? {} : { confidentialityLevel: { not: 'STRICTLY_CONFIDENTIAL' } }),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async readBuffer(userId: string, familySpaceId: string, fileId: string) {
    const file = await this.get(userId, familySpaceId, fileId);
    const buffer = await this.storage.read(file.storageKey);
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'file.download',
      resourceType: 'FileObject',
      resourceId: fileId,
    });
    return { buffer, file };
  }

  async archive(userId: string, familySpaceId: string, fileId: string) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    await this.permissions.assertCan(membership, 'FILES', 'ARCHIVE');
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!file || file.familySpaceId !== familySpaceId) throw new NotFoundException('Файл не найден');
    const updated = await this.prisma.fileObject.update({
      where: { id: fileId },
      data: { status: 'ARCHIVED' },
    });
    await this.audit.log({
      familySpaceId,
      actorUserId: userId,
      action: 'file.archive',
      resourceType: 'FileObject',
      resourceId: fileId,
    });
    return updated;
  }
}
