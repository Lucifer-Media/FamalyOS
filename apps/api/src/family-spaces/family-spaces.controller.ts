import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpacesService } from './family-spaces.service';

@UseGuards(JwtAuthGuard)
@Controller('family-spaces')
export class FamilySpacesController {
  constructor(private readonly service: FamilySpacesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.service.listForUser(userId);
  }

  @Get(':id')
  getOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.getOne(userId, id);
  }

  @Patch(':id/base-currency')
  updateBaseCurrency(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body('baseCurrency') baseCurrency: string,
  ) {
    return this.service.updateBaseCurrency(userId, id, baseCurrency);
  }
}
