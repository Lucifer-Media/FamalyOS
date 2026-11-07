import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { PermissionsService } from '../common/permissions.service';
import { AuditService } from '../audit/audit.service';
import { TelegramBotService } from './telegram-bot.service';

@UseGuards(JwtAuthGuard)
@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  @Get('status')
  async status(@CurrentUser() userId: string, @FamilySpaceId() fs: string) {
    const m = await this.permissions.getMembership(userId, fs);
    await this.permissions.assertCan(m, 'FINANCE', 'VIEW');
    return { ...this.bot.status(), links: await this.bot.listLinksForUser(userId, fs) };
  }

  /** Одноразовый код (10 минут) для команды /link в боте. */
  @Post('link-code')
  async linkCode(@CurrentUser() userId: string, @FamilySpaceId() fs: string) {
    const m = await this.permissions.getMembership(userId, fs);
    await this.permissions.assertCan(m, 'FINANCE', 'CREATE');
    const res = this.bot.createLinkCode(userId, fs);
    await this.audit.log({ familySpaceId: fs, actorUserId: userId, action: 'telegram.link_code_issued', resourceType: 'telegram_link' });
    return res;
  }

  @Post('check-budgets')
  async checkBudgets(@CurrentUser() userId: string, @FamilySpaceId() fs: string) {
    const m = await this.permissions.getMembership(userId, fs);
    await this.permissions.assertCan(m, 'FINANCE', 'VIEW');
    const links = await this.bot.listLinksForUser(userId, fs);
    const first = links[0] as { telegramUserId?: string } | undefined;
    if (!first?.telegramUserId) return { checked: false, reason: 'Нет привязанного Telegram' };
    const link = await this.bot.findLink(first.telegramUserId);
    if (link) await this.bot.checkBudgets(link);
    return { checked: Boolean(link) };
  }
}
