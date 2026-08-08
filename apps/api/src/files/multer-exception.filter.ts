import { ArgumentsHost, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import { MulterError } from 'multer';
import { Response } from 'express';

/**
 * Без этого фильтра превышение лимита размера файла (см. MAX_UPLOAD_SIZE_BYTES
 * в files.controller.ts) роняет запрос с неинформативной 500-й ошибкой —
 * пользователь не понимает, что произошло. Раздел 22/23 ТЗ Итерации 2 явно
 * требует понятной обработки "слишком большой файл".
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception.code === 'LIMIT_FILE_SIZE') {
      response.status(413).json({
        statusCode: 413,
        message: 'Файл слишком большой. Максимальный размер — 100 МБ.',
      });
      return;
    }

    response.status(400).json({ statusCode: 400, message: 'Ошибка загрузки файла: ' + exception.message });
  }
}
