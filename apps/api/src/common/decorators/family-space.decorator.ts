import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';

/**
 * Активное семейное пространство передаётся клиентом в заголовке
 * X-Family-Space-Id (пользователь может состоять в нескольких пространствах,
 * фронтенд хранит текущее выбранное пространство и передаёт его в каждом запросе).
 */
export const FamilySpaceId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  const id = request.headers['x-family-space-id'];
  if (!id || typeof id !== 'string') {
    throw new BadRequestException('Заголовок X-Family-Space-Id обязателен');
  }
  return id;
});
