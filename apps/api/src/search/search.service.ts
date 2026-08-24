import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PermissionsService } from '../common/permissions.service';
import { roleAllows } from '../common/permissions';

export interface SearchHit {
  id: string;
  entityType: string;
  title: string;
  snippet: string;
  rank: number;
  updatedAt: Date;
}

const ENTITY_TYPE_RESOURCE: Record<string, any> = {
  knowledge_article: 'KNOWLEDGE_BASE',
};

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async search(
    userId: string,
    familySpaceId: string,
    query: string,
    entityTypes?: string[],
    limit = 50,
  ): Promise<SearchHit[]> {
    const membership = await this.permissions.getMembership(userId, familySpaceId);
    const canConfidential = await this.permissions.can(membership, 'CONFIDENTIAL', 'VIEW');

    // Полнотекстовый поиск через Postgres (to_tsvector/plainto_tsquery, конфигурация 'russian').
    // entityTypes — опциональный фильтр (используется компонентом выбора связи:
    // подсказывать только сущности нужного типа, а не всё подряд).
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `
      SELECT id, "entityType", title,
             ts_headline('russian', coalesce("searchText", ''), plainto_tsquery('russian', $1),
                         'MaxFragments=1, MaxWords=25, MinWords=10') AS snippet,
             ts_rank(to_tsvector('russian', coalesce("searchText", '')), plainto_tsquery('russian', $1)) AS rank,
             "updatedAt"
      FROM entities
      WHERE "familySpaceId" = $2
        AND status <> 'VOID'
        AND to_tsvector('russian', coalesce("searchText", '')) @@ plainto_tsquery('russian', $1)
        ${canConfidential ? '' : `AND "confidentialityLevel" <> 'STRICTLY_CONFIDENTIAL'`}
        ${entityTypes && entityTypes.length > 0 ? `AND "entityType" = ANY($3::text[])` : ''}
      ORDER BY rank DESC
      LIMIT ${Number.isFinite(limit) && limit > 0 && limit <= 200 ? limit : 50}
      `,
      query,
      familySpaceId,
      ...(entityTypes && entityTypes.length > 0 ? [entityTypes] : []),
    );

    const results: SearchHit[] = [];
    for (const row of rows) {
      const resource = ENTITY_TYPE_RESOURCE[row.entityType] ?? 'DOCUMENTS';
      const allowed = await this.permissions.can(membership, resource, 'VIEW');
      if (allowed) results.push(row as SearchHit);
    }
    return results;
  }
}
