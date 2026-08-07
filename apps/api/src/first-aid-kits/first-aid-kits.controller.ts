import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { FirstAidKitsService } from './first-aid-kits.service';

@UseGuards(JwtAuthGuard)
@Controller('first-aid-kits')
export class FirstAidKitsController {
  constructor(private readonly service: FirstAidKitsService) {}

  @Get('expiring')
  expiring(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('days') days?: string,
  ) {
    return this.service.getExpiringItems(userId, familySpaceId, days ? parseInt(days, 10) : 30);
  }
}
