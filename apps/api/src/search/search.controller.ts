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
  search(
    @CurrentUser() userId: string,
    @FamilySpaceId() familySpaceId: string,
    @Query('q') q: string,
    @Query('types') types?: string,
    @Query('limit') limit?: string,
  ) {
    if (!q || q.trim().length === 0) return [];
    const entityTypes = types ? types.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.service.search(userId, familySpaceId, q.trim(), entityTypes, limitNum);
  }
}
