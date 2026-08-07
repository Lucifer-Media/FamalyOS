import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MembershipsService } from './memberships.service';
import {
  AcceptInvitationNewUserDto,
  ChangeRoleDto,
  CreateInvitationDto,
  SetPermissionOverrideDto,
} from './dto/membership.dto';

@Controller()
export class MembershipsController {
  constructor(private readonly service: MembershipsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('family-spaces/:id/members')
  list(@CurrentUser() userId: string, @Param('id') familySpaceId: string) {
    return this.service.listMembers(userId, familySpaceId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('family-spaces/:id/invitations')
  invite(
    @CurrentUser() userId: string,
    @Param('id') familySpaceId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.service.invite(userId, familySpaceId, dto);
  }

  // Публичный маршрут — новый пользователь ещё не аутентифицирован.
  @Post('invitations/:token/accept-new-user')
  acceptAsNewUser(@Param('token') token: string, @Body() dto: AcceptInvitationNewUserDto) {
    return this.service.acceptInvitationAsNewUser(token, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('family-spaces/:id/members/:membershipId/role')
  changeRole(
    @CurrentUser() userId: string,
    @Param('id') familySpaceId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.service.changeRole(userId, familySpaceId, membershipId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('family-spaces/:id/members/:membershipId/status')
  setStatus(
    @CurrentUser() userId: string,
    @Param('id') familySpaceId: string,
    @Param('membershipId') membershipId: string,
    @Body('status') status: 'ACTIVE' | 'SUSPENDED' | 'LEFT',
  ) {
    return this.service.setStatus(userId, familySpaceId, membershipId, status);
  }

  @UseGuards(JwtAuthGuard)
  @Post('family-spaces/:id/members/:membershipId/permission-overrides')
  setOverride(
    @CurrentUser() userId: string,
    @Param('id') familySpaceId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: SetPermissionOverrideDto,
  ) {
    return this.service.setPermissionOverride(userId, familySpaceId, membershipId, dto);
  }
}
