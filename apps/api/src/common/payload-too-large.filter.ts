import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

/**
 * Без этого фильтра превышение лимита размера JSON-тела запроса (см.
 * app.use(json({ limit: ... })) в main.ts) роняет запрос с неинформативной
 * 500-й ещё до того, как он доходит до контроллера — именно так выглядела
 * реальная ошибка при подтверждении импорта банковской выписки на ~7000
 * операций. С поднятым лимитом (20 МБ) это должно происходить крайне редко,
 * но если всё же произойдёт — пользователь должен увидеть понятное
 * сообщение, а не голую 500-ю.
 *
 * @Catch() без аргументов перехватывает всё подряд — но в отличие от
 * MulterExceptionFilter (который ловит только свой конкретный класс
 * ошибки), у ошибки превышения лимита тела запроса от body-parser нет
 * экспортируемого класса, поэтому здесь используем узкую проверку по полю
 * error.type. Для остальных исключений — НИКОГДА не re-throw изнутри
 * фильтра (может зависнуть запрос), вместо этого вручную повторяем
 * стандартное поведение NestJS: HttpException — как есть, иначе 500.
 */
@Catch()
export class PayloadTooLargeFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception?.type === 'entity.too.large' || exception?.status === 413 || exception?.statusCode === 413) {
      response.status(413).json({
        statusCode: 413,
        message: 'Слишком большой запрос. Попробуйте разбить операцию на несколько частей.',
      });
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Внутренняя ошибка сервера',
    });
  }
}
