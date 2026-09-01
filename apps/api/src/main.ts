import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { MulterExceptionFilter } from './files/multer-exception.filter';
import { PayloadTooLargeFilter } from './common/payload-too-large.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Дефолтный лимит Express на JSON-тело запроса — около 100 КБ. Реальный
  // случай: подтверждение импорта банковской выписки на несколько лет
  // (~7000 операций) отправляет JSON размером 1-2 МБ и падало с голой
  // 500-й (PayloadTooLargeError) ещё до того, как запрос доходил до
  // контроллера — отсюда и непонятная ошибка без объяснения.
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new MulterExceptionFilter(), new PayloadTooLargeFilter());

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Family OS API запущен на порту ${port}`);
}
bootstrap();
