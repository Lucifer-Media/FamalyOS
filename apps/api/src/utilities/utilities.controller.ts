import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { UtilitiesService } from './utilities.service';

@UseGuards(JwtAuthGuard)
@Controller('utilities')
export class UtilitiesController {
  constructor(private readonly service: UtilitiesService) {}

  @Get('bills/:billId/meter-candidates')
  getMeterReadingCandidates(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('billId') billId: string,
  ) {
    return this.service.getMeterReadingCandidates(userId, familySpaceId, billId);
  }

  @Post('bills/:billId/meter-readings')
  confirmMeterReading(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('billId') billId: string,
    @Body()
    body: {
      meterId?: string;
      newMeter?: { locationId?: string; resourceType: string; meterNumber: string };
      value: number;
      date: string;
    },
  ) {
    return this.service.confirmMeterReading(userId, familySpaceId, billId, body);
  }
}
