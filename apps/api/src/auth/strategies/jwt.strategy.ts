import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  /** Итерация 4.2: id сессии — отзыв сессии/приостановка пользователя действуют сразу. */
  sid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { status: true } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Учётная запись приостановлена');
    if (payload.sid) {
      const session = await this.prisma.session.findUnique({ where: { id: payload.sid }, select: { revokedAt: true, userId: true } });
      if (!session || session.revokedAt || session.userId !== payload.sub) throw new UnauthorizedException('Сессия отозвана — войдите заново');
    }
    return { userId: payload.sub, email: payload.email, sessionId: payload.sid };
  }
}
