import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Локальный бэкенд файлового хранилища. Реализует минимальный контракт,
 * за которым в будущем может встать S3-совместимое хранилище — весь
 * остальной код (FilesService) от конкретного бэкенда не зависит.
 * Путь хранения настраивается через FILE_STORAGE_ROOT (задел под
 * «пользователь может настроить хранилище из интерфейса» — сейчас это
 * переменная окружения уровня пространства/сервера, техдолг — вынести per-space).
 */
@Injectable()
export class LocalStorageService {
  private root: string;

  constructor(private readonly config: ConfigService) {
    this.root = path.resolve(this.config.get<string>('FILE_STORAGE_ROOT') ?? './uploads');
    fs.mkdirSync(this.root, { recursive: true });
  }

  async save(familySpaceId: string, buffer: Buffer, suggestedName: string): Promise<{
    storageKey: string;
    sizeBytes: number;
    checksumSha256: string;
  }> {
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const safeName = suggestedName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = path.posix.join(
      familySpaceId,
      `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`,
    );
    const fullPath = path.join(this.root, key);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, buffer);
    return { storageKey: key, sizeBytes: buffer.length, checksumSha256: checksum };
  }

  async read(storageKey: string): Promise<Buffer> {
    return fsp.readFile(path.join(this.root, storageKey));
  }

  resolvePath(storageKey: string): string {
    return path.join(this.root, storageKey);
  }
}
