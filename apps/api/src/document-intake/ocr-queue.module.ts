import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const OCR_QUEUE_NAME = 'document-ocr-processing';

/**
 * Очередь фоновой обработки OCR на Redis/BullMQ. Решает задачу «100
 * документов подряд без зависания интерфейса» (раздел 22 ТЗ Итерации 2):
 * загрузка документа немедленно возвращает ответ (статус PROCESSING),
 * а само распознавание выполняется отдельным воркер-процессом, читающим
 * задачи из очереди — HTTP-запрос загрузки больше не блокируется на время
 * OCR (которое может занимать секунды на фото и десятки секунд на
 * многостраничный скан).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') ?? 'redis',
          port: parseInt(config.get<string>('REDIS_PORT') ?? '6379', 10),
        },
      }),
    }),
    BullModule.registerQueue({
      name: OCR_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 2, // одна автоматическая повторная попытка при сбое воркера (не OCR-ошибке — та обрабатывается штатно)
        backoff: { type: 'fixed', delay: 5000 },
        removeOnComplete: { age: 3600 }, // не копим завершённые задачи в Redis бесконечно
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  exports: [BullModule],
})
export class OcrQueueModule {}
