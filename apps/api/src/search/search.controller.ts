import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FamilySpaceId } from '../common/decorators/family-space.decorator';
import { SearchService } from './search.service';

@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  search(@CurrentUser() userId: string, @FamilySpaceId() familySpaceId: string, @Query('q') q: string) {
    if (!q || q.trim().length === 0) return [];
    return this.service.search(userId, familySpaceId, q.trim());
  }
}
