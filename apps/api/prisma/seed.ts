import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await argon2.hash('DemoPassword123!');

  const familySpace = await prisma.familySpace.create({
    data: { name: 'Демо-семья', baseCurrency: 'RUB' },
  });

  const owner = await prisma.user.create({
    data: { email: 'owner@example.com', passwordHash },
  });

  const ownerPerson = await prisma.person.create({
    data: { familySpaceId: familySpace.id, fullName: 'Максим (владелец)' },
  });

  await prisma.membership.create({
    data: {
      familySpaceId: familySpace.id,
      userId: owner.id,
      personId: ownerPerson.id,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });

  const childPerson = await prisma.person.create({
    data: { familySpaceId: familySpace.id, fullName: 'Ариша (ребёнок)' },
  });

  const article = await prisma.entity.create({
    data: {
      familySpaceId: familySpace.id,
      entityType: 'knowledge_article',
      title: 'Настройка домашнего сервера ThinkPad',
      attributes: {
        content:
          '# Домашний сервер\n\nЗаметка перенесена из проектной документации как демонстрация базы знаний.',
        folder: 'Дом',
        tags: ['сервер', 'домашний'],
      },
      createdByUserId: owner.id,
      updatedByUserId: owner.id,
      searchText: 'Настройка домашнего сервера ThinkPad',
    },
  });

  await prisma.entityVersion.create({
    data: {
      entityId: article.id,
      versionNumber: 1,
      action: 'CREATE',
      snapshot: article as any,
      changeSummary: 'Первая версия (seed)',
      changedByUserId: owner.id,
    },
  });

  console.log('Seed завершён:');
  console.log(`  Family Space: ${familySpace.id}`);
  console.log(`  Owner: owner@example.com / DemoPassword123!`);
  console.log(`  Person (ребёнок, без логина): ${childPerson.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
