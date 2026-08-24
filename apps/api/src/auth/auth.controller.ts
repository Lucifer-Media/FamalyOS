import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto, TwoFactorVerifyDto, UseRecoveryCodeDto, RegenerateRecoveryCodesDto } from './dto/misc.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

function ctxFrom(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

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
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
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
}
