import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto, TwoFactorVerifyDto, UseRecoveryCodeDto, RegenerateRecoveryCodesDto } from './dto/misc.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentSessionId } from '../common/decorators/current-user.decorator';
import { clientContext } from './client-context';

// Итерация 4.2: реальный IP клиента (раньше req.ip — адрес контейнера web).
const ctxFrom = (req: Request) => clientContext(req);

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, ctxFrom(req));
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, ctxFrom(req));
  }

  @Post('login/recovery')
  loginWithRecovery(@Body() dto: UseRecoveryCodeDto, @Req() req: Request) {
    return this.auth.loginWithRecoveryCode(dto.email, dto.recoveryCode, ctxFrom(req));
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, ctxFrom(req));
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser() userId: string) {
    return this.auth.setupTwoFactor(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/confirm')
  confirmTwoFactor(@CurrentUser() userId: string, @Body() dto: TwoFactorVerifyDto) {
    return this.auth.confirmTwoFactor(userId, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  disableTwoFactor(@CurrentUser() userId: string, @Body() body: { password: string }) {
    return this.auth.disableTwoFactor(userId, body.password);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/recovery/regenerate')
  regenerateRecoveryCodes(@CurrentUser() userId: string, @Body() dto: RegenerateRecoveryCodesDto) {
    return this.auth.regenerateRecoveryCodes(userId, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('2fa/recovery/status')
  getRecoveryCodesStatus(@CurrentUser() userId: string) {
    return this.auth.getRecoveryCodesStatus(userId);
  }

  // ---------- Итерация 4.2: мой профиль ----------

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() userId: string) {
    return this.auth.me(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('password')
  changePassword(@CurrentUser() userId: string, @CurrentSessionId() sid: string | undefined, @Body() body: { currentPassword: string; newPassword: string }) {
    return this.auth.changePassword(userId, body.currentPassword, body.newPassword, sid);
  }

  @UseGuards(JwtAuthGuard)
  @Post('email')
  changeEmail(@CurrentUser() userId: string, @Body() body: { password: string; email: string }) {
    return this.auth.changeEmail(userId, body.password, body.email);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  sessions(@CurrentUser() userId: string, @CurrentSessionId() sid: string | undefined) {
    return this.auth.listSessions(userId, sid);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/:id/revoke')
  revokeSession(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.auth.revokeSession(userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-others')
  async revokeOtherSessions(@CurrentUser() userId: string, @CurrentSessionId() sid: string | undefined) {
    return { revoked: await this.auth.revokeAllSessions(userId, sid) };
  }

  @UseGuards(JwtAuthGuard)
  @Get('devices')
  devices(@CurrentUser() userId: string) {
    return this.auth.listDevices(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('devices/:id/revoke')
  revokeDevice(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.auth.revokeDevice(userId, id);
  }
}
