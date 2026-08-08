/**
 * Одноразовый скрипт: пересчитывает searchText для всех уже существующих
 * Entity после фикса buildSearchText (раньше индексировалось только
 * attributes.content, теперь — все поля). Ничего не удаляет и не создаёт
 * новых версий — это техническое обслуживание индекса поиска, а не
 * пользовательское изменение данных.
 *
 * Запуск: npx ts-node scripts/backfill-search-text.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function buildSearchText(title: string, attributes: Record<string, unknown>): string {
  const flatValues: string[] = [];
  const collect = (value: unknown) => {
    if (value == null) return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      flatValues.push(String(value));
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(collect);
    }
  };
  collect(attributes);
  return [title, ...flatValues].filter(Boolean).join('\n').slice(0, 100_000);
}

async function main() {
  const entities = await prisma.entity.findMany();
  let updated = 0;
  for (const entity of entities) {
    const newSearchText = buildSearchText(entity.title, entity.attributes as Record<string, unknown>);
    if (newSearchText !== entity.searchText) {
      await prisma.entity.update({ where: { id: entity.id }, data: { searchText: newSearchText } });
      updated++;
    }
  }
  console.log(`Пересчитан searchText для ${updated} из ${entities.length} записей.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
