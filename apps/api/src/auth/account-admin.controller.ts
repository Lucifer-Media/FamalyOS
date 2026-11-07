import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccountAdminService } from './account-admin.service';

/** Карточка участника для владельца (Итерация 4.2). */
@UseGuards(JwtAuthGuard)
@Controller('family-spaces/:id/members/:membershipId/account')
export class AccountAdminController {
  constructor(private readonly service: AccountAdminService) {}

  @Get()
  get(@CurrentUser() u: string, @Param('id') fs: string, @Param('membershipId') mid: string) {
    return this.service.getAccount(u, fs, mid);
  }

  @Patch()
  update(@CurrentUser() u: string, @Param('id') fs: string, @Param('membershipId') mid: string, @Body() dto: { fullName?: string; email?: string }) {
    return this.service.updateProfile(u, fs, mid, dto);
  }

  @Post('password')
  resetPassword(@CurrentUser() u: string, @Param('id') fs: string, @Param('membershipId') mid: string, @Body() dto: { newPassword: string }) {
    return this.service.resetPassword(u, fs, mid, dto.newPassword);
  }

  @Post('2fa/disable')
  disable2fa(@CurrentUser() u: string, @Param('id') fs: string, @Param('membershipId') mid: string) {
    return this.service.disableTwoFactor(u, fs, mid);
  }

  @Post('2fa/setup')
  setup2fa(@CurrentUser() u: string, @Param('id') fs: string, @Param('membershipId') mid: string) {
    return this.service.setupTwoFactor(u, fs, mid);
  }

  @Post('2fa/confirm')
  confirm2fa(@CurrentUser() u: string, @Param('id') fs: string, @Param('membershipId') mid: string, @Body() dto: { code: string }) {
    return this.service.confirmTwoFactor(u, fs, mid, dto.code);
  }

  @Post('sessions/revoke')
  revokeSessions(@CurrentUser() u: string, @Param('id') fs: string, @Param('membershipId') mid: string) {
    return this.service.revokeSessions(u, fs, mid);
  }

  @Post('devices/:deviceId/revoke')
  revokeDevice(@CurrentUser() u: string, @Param('id') fs: string, @Param('membershipId') mid: string, @Param('deviceId') deviceId: string) {
    return this.service.revokeDevice(u, fs, mid, deviceId);
  }
}
