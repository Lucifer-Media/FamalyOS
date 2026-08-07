import { Controller, Get, ForbiddenException, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { PermissionsService } from '../common/permissions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('audit-log')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
  ) {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    // Просмотр журнала аудита — чувствительная операция, доступна владельцу и партнёру.
    if (!['OWNER', 'PARTNER'].includes(membership.role)) {
      throw new ForbiddenException('Журнал аудита доступен только владельцу/партнёру пространства');
    }
    return this.audit.listForFamilySpace(familySpaceId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      action,
    });
  }
}
