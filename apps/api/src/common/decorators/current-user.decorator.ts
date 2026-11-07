import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  return request.user?.userId;
});

/** Итерация 4.2: id текущей сессии (из access-токена), чтобы при смене пароля не выкидывать текущее устройство. */
export const CurrentSessionId = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const request = ctx.switchToHttp().getRequest();
  return request.user?.sessionId;
});
