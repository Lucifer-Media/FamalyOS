import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { PeopleService } from './people.service';
import { CreatePersonDto, UpdatePersonDto } from './dto/person.dto';

@UseGuards(JwtAuthGuard)
@Controller('people')
export class PeopleController {
  constructor(private readonly service: PeopleService) {}

  @Get()
  list(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string) {
    return this.service.list(userId, familySpaceId);
  }

  @Post()
  create(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Body() dto: CreatePersonDto) {
    return this.service.create(userId, familySpaceId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePersonDto,
  ) {
    return this.service.update(userId, familySpaceId, id, dto);
  }

  @Patch(':id/archive')
  archive(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Param('id') id: string) {
    return this.service.archive(userId, familySpaceId, id);
  }
}
