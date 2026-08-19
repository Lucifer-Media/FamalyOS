import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { FamilySpace, Person, Entity } from '@prisma/client';

export interface CreateBankAccountDto {
  familySpaceId: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
  currency: string;
  accountType: string;
  openingDate?: Date;
  closingDate?: Date;
  initialBalance?: number;
  currentBalance?: number;
  interestRate?: number;
  creditLimit?: number;
  linkedCardNumber?: string;
  ownerPersonId?: string;
  notes?: string;
}

export interface CreateFinancialOperationDto {
  familySpaceId: string;
  operationDate: Date;
  operationTime?: string;
  amount: number;
  currency: string;
  originalAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
  operationType: string;
  category?: string;
  subcategory?: string;
  description?: string;
  merchantName?: string;
  merchantInn?: string;
  sourceAccountId?: string;
  targetAccountId?: string;
  budgetId?: string;
  relatedDocumentId?: string;
  isRecurring?: boolean;
  recurringPeriod?: string;
  importSource?: string;
  importUniqueId?: string;
  mcc?: string;
  cashback?: number;
  notes?: string;
}

export interface CreateBudgetDto {
  familySpaceId: string;
  budgetName: string;
  budgetType: string;
  startDate: Date;
  endDate?: Date;
  currency: string;
  plannedIncome?: number;
  plannedExpense?: number;
  categories?: string;
  ownerPersonId?: string;
  notes?: string;
}

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  async validateFamilySpaceAccess(familySpaceId: string, userId: string): Promise<FamilySpace> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        familySpaceId,
        userId,
        status: 'ACTIVE',
      },
    });

    if (!membership) {
      throw new NotFoundException('Доступ к семейному пространству не найден или у вас нет прав');
    }

    return this.prisma.familySpace.findUnique({
      where: { id: familySpaceId },
    });
  }

  async createBankAccount(userId: string, dto: CreateBankAccountDto) {
    await this.validateFamilySpaceAccess(dto.familySpaceId, userId);

    if (dto.ownerPersonId) {
      const person = await this.prisma.person.findUnique({
        where: { id: dto.ownerPersonId },
      });
      if (!person || person.familySpaceId !== dto.familySpaceId) {
        throw new BadRequestException('Указанный человек не принадлежит этому семейному пространству');
      }
    }

    const entity = await this.prisma.entity.create({
      data: {
        familySpaceId: dto.familySpaceId,
        entityType: 'bank_account',
        title: dto.accountName,
        attributes: {
          accountName: dto.accountName,
          bankName: dto.bankName,
          accountNumber: dto.accountNumber,
          currency: dto.currency,
          accountType: dto.accountType,
          openingDate: dto.openingDate,
          closingDate: dto.closingDate,
          initialBalance: dto.initialBalance,
          currentBalance: dto.currentBalance,
          interestRate: dto.interestRate,
          creditLimit: dto.creditLimit,
          linkedCardNumber: dto.linkedCardNumber,
          ownerPersonId: dto.ownerPersonId,
          notes: dto.notes,
        },
        createdByUserId: userId,
        updatedByUserId: userId,
        ownerPersonId: dto.ownerPersonId,
      },
      include: {
        versions: true,
      },
    });

    return entity;
  }

  async getBankAccounts(familySpaceId: string, userId: string) {
    await this.validateFamilySpaceAccess(familySpaceId, userId);

    return this.prisma.entity.findMany({
      where: {
        familySpaceId,
        entityType: 'bank_account',
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBankAccount(id: string, userId: string) {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
    });

    if (!entity || entity.entityType !== 'bank_account') {
      throw new NotFoundException('Банковский счёт не найден');
    }

    await this.validateFamilySpaceAccess(entity.familySpaceId, userId);
    return entity;
  }

  async updateBankAccount(id: string, userId: string, dto: Partial<CreateBankAccountDto>) {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
    });

    if (!entity || entity.entityType !== 'bank_account') {
      throw new NotFoundException('Банковский счёт не найден');
    }

    await this.validateFamilySpaceAccess(entity.familySpaceId, userId);

    const currentAttributes = entity.attributes as any;
    const newAttributes = {
      ...currentAttributes,
      ...dto,
    };

    return this.prisma.entity.update({
      where: { id },
      data: {
        title: dto.accountName || currentAttributes.accountName,
        attributes: newAttributes,
        updatedByUserId: userId,
      },
    });
  }

  async archiveBankAccount(id: string, userId: string) {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
    });

    if (!entity || entity.entityType !== 'bank_account') {
      throw new NotFoundException('Банковский счёт не найден');
    }

    await this.validateFamilySpaceAccess(entity.familySpaceId, userId);

    return this.prisma.entity.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        updatedByUserId: userId,
      },
    });
  }

  async createFinancialOperation(userId: string, dto: CreateFinancialOperationDto) {
    await this.validateFamilySpaceAccess(dto.familySpaceId, userId);

    if (dto.sourceAccountId) {
      const sourceAccount = await this.prisma.entity.findUnique({
        where: { id: dto.sourceAccountId },
      });
      if (!sourceAccount || sourceAccount.entityType !== 'bank_account' || sourceAccount.familySpaceId !== dto.familySpaceId) {
        throw new BadRequestException('Неверный счёт списания');
      }
    }

    if (dto.targetAccountId) {
      const targetAccount = await this.prisma.entity.findUnique({
        where: { id: dto.targetAccountId },
      });
      if (!targetAccount || targetAccount.entityType !== 'bank_account' || targetAccount.familySpaceId !== dto.familySpaceId) {
        throw new BadRequestException('Неверный счёт зачисления');
      }
    }

    if (dto.budgetId) {
      const budget = await this.prisma.entity.findUnique({
        where: { id: dto.budgetId },
      });
      if (!budget || budget.entityType !== 'budget' || budget.familySpaceId !== dto.familySpaceId) {
        throw new BadRequestException('Неверный бюджет');
      }
    }

    if (dto.relatedDocumentId) {
      const doc = await this.prisma.entity.findUnique({
        where: { id: dto.relatedDocumentId },
      });
      if (!doc || doc.entityType !== 'cash_receipt' || doc.familySpaceId !== dto.familySpaceId) {
        throw new BadRequestException('Неверный связанный документ');
      }
    }

    const title = dto.description || `${dto.operationType} ${dto.amount} ${dto.currency}`;

    const entity = await this.prisma.entity.create({
      data: {
        familySpaceId: dto.familySpaceId,
        entityType: 'financial_operation',
        title,
        attributes: {
          operationDate: dto.operationDate,
          operationTime: dto.operationTime,
          amount: dto.amount,
          currency: dto.currency,
          originalAmount: dto.originalAmount,
          originalCurrency: dto.originalCurrency,
          exchangeRate: dto.exchangeRate,
          operationType: dto.operationType,
          category: dto.category,
          subcategory: dto.subcategory,
          description: dto.description,
          merchantName: dto.merchantName,
          merchantInn: dto.merchantInn,
          sourceAccountId: dto.sourceAccountId,
          targetAccountId: dto.targetAccountId,
          budgetId: dto.budgetId,
          relatedDocumentId: dto.relatedDocumentId,
          isRecurring: dto.isRecurring,
          recurringPeriod: dto.recurringPeriod,
          importSource: dto.importSource,
          importUniqueId: dto.importUniqueId,
          mcc: dto.mcc,
          cashback: dto.cashback,
          notes: dto.notes,
        },
        createdByUserId: userId,
        updatedByUserId: userId,
      },
    });

    if (dto.sourceAccountId || dto.targetAccountId) {
      const links: { sourceId: string; targetId: string }[] = [];
      
      if (dto.sourceAccountId) {
        links.push({ sourceId: entity.id, targetId: dto.sourceAccountId });
      }
      if (dto.targetAccountId && dto.targetAccountId !== dto.sourceAccountId) {
        links.push({ sourceId: entity.id, targetId: dto.targetAccountId });
      }

      for (const link of links) {
        await this.prisma.entityLink.create({
          data: {
            sourceEntityId: link.sourceId,
            targetEntityId: link.targetId,
            linkType: 'RELATED_TO',
            createdByUserId: userId,
          },
        });
      }
    }

    return entity;
  }

  async getFinancialOperations(
    familySpaceId: string,
    userId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      category?: string;
      operationType?: string;
      accountId?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    await this.validateFamilySpaceAccess(familySpaceId, userId);

    const where: any = {
      familySpaceId,
      entityType: 'financial_operation',
      status: 'ACTIVE',
    };

    if (options?.startDate || options?.endDate) {
      where.attributes = {
        path: ['operationDate'],
        gte: options?.startDate,
        lte: options?.endDate,
      };
    }

    if (options?.category) {
      where.attributes = {
        ...where.attributes,
        path: ['category'],
        equals: options.category,
      };
    }

    if (options?.operationType) {
      where.attributes = {
        ...where.attributes,
        path: ['operationType'],
        equals: options.operationType,
      };
    }

    return this.prisma.entity.findMany({
      where,
      orderBy: { 
        createdAt: 'desc',
      },
      take: options?.limit,
      skip: options?.offset,
    });
  }

  async getFinancialOperation(id: string, userId: string) {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
    });

    if (!entity || entity.entityType !== 'financial_operation') {
      throw new NotFoundException('Финансовая операция не найдена');
    }

    await this.validateFamilySpaceAccess(entity.familySpaceId, userId);
    return entity;
  }

  async updateFinancialOperation(id: string, userId: string, dto: Partial<CreateFinancialOperationDto>) {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
    });

    if (!entity || entity.entityType !== 'financial_operation') {
      throw new NotFoundException('Финансовая операция не найдена');
    }

    await this.validateFamilySpaceAccess(entity.familySpaceId, userId);

    const currentAttributes = entity.attributes as any;
    const newAttributes = {
      ...currentAttributes,
      ...dto,
    };

    return this.prisma.entity.update({
      where: { id },
      data: {
        title: dto.description || (entity.attributes as any).description || entity.title,
        attributes: newAttributes,
        updatedByUserId: userId,
      },
    });
  }

  async archiveFinancialOperation(id: string, userId: string) {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
    });

    if (!entity || entity.entityType !== 'financial_operation') {
      throw new NotFoundException('Финансовая операция не найдена');
    }

    await this.validateFamilySpaceAccess(entity.familySpaceId, userId);

    return this.prisma.entity.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        updatedByUserId: userId,
      },
    });
  }

  async createBudget(userId: string, dto: CreateBudgetDto) {
    await this.validateFamilySpaceAccess(dto.familySpaceId, userId);

    if (dto.ownerPersonId) {
      const person = await this.prisma.person.findUnique({
        where: { id: dto.ownerPersonId },
      });
      if (!person || person.familySpaceId !== dto.familySpaceId) {
        throw new BadRequestException('Указанный человек не принадлежит этому семейному пространству');
      }
    }

    const entity = await this.prisma.entity.create({
      data: {
        familySpaceId: dto.familySpaceId,
        entityType: 'budget',
        title: dto.budgetName,
        attributes: {
          budgetName: dto.budgetName,
          budgetType: dto.budgetType,
          startDate: dto.startDate,
          endDate: dto.endDate,
          currency: dto.currency,
          plannedIncome: dto.plannedIncome,
          plannedExpense: dto.plannedExpense,
          categories: dto.categories,
          ownerPersonId: dto.ownerPersonId,
          notes: dto.notes,
        },
        createdByUserId: userId,
        updatedByUserId: userId,
        ownerPersonId: dto.ownerPersonId,
      },
    });

    return entity;
  }

  async getBudgets(familySpaceId: string, userId: string) {
    await this.validateFamilySpaceAccess(familySpaceId, userId);

    return this.prisma.entity.findMany({
      where: {
        familySpaceId,
        entityType: 'budget',
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBudget(id: string, userId: string) {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
    });

    if (!entity || entity.entityType !== 'budget') {
      throw new NotFoundException('Бюджет не найден');
    }

    await this.validateFamilySpaceAccess(entity.familySpaceId, userId);
    return entity;
  }

  async updateBudget(id: string, userId: string, dto: Partial<CreateBudgetDto>) {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
    });

    if (!entity || entity.entityType !== 'budget') {
      throw new NotFoundException('Бюджет не найден');
    }

    await this.validateFamilySpaceAccess(entity.familySpaceId, userId);

    const currentAttributes = entity.attributes as any;
    const newAttributes = {
      ...currentAttributes,
      ...dto,
    };

    return this.prisma.entity.update({
      where: { id },
      data: {
        title: dto.budgetName || currentAttributes.budgetName,
        attributes: newAttributes,
        updatedByUserId: userId,
      },
    });
  }

  async archiveBudget(id: string, userId: string) {
    const entity = await this.prisma.entity.findUnique({
      where: { id },
    });

    if (!entity || entity.entityType !== 'budget') {
      throw new NotFoundException('Бюджет не найден');
    }

    await this.validateFamilySpaceAccess(entity.familySpaceId, userId);

    return this.prisma.entity.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        updatedByUserId: userId,
      },
    });
  }

  async getAnalyticsByCategory(
    familySpaceId: string,
    userId: string,
    startDate: Date,
    endDate: Date,
  ) {
    await this.validateFamilySpaceAccess(familySpaceId, userId);

    const operations = await this.prisma.entity.findMany({
      where: {
        familySpaceId,
        entityType: 'financial_operation',
        status: 'ACTIVE',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const analytics: Record<string, { income: number; expense: number }> = {};

    for (const op of operations) {
      const attrs = op.attributes as any;
      const category = attrs.category || 'Без категории';
      const amount = parseFloat(attrs.amount) || 0;
      const operationType = attrs.operationType;

      if (!analytics[category]) {
        analytics[category] = { income: 0, expense: 0 };
      }

      if (operationType === 'INCOME') {
        analytics[category].income += amount;
      } else if (operationType === 'EXPENSE') {
        analytics[category].expense += amount;
      }
    }

    return Object.entries(analytics).map(([category, data]) => ({
      category,
      income: data.income,
      expense: data.expense,
      net: data.income - data.expense,
    }));
  }

  async getAnalyticsByPeriod(
    familySpaceId: string,
    userId: string,
    startDate: Date,
    endDate: Date,
    periodType: 'day' | 'month' | 'year' = 'month',
  ) {
    await this.validateFamilySpaceAccess(familySpaceId, userId);

    const operations = await this.prisma.entity.findMany({
      where: {
        familySpaceId,
        entityType: 'financial_operation',
        status: 'ACTIVE',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const analytics: Record<string, { income: number; expense: number }> = {};

    for (const op of operations) {
      const attrs = op.attributes as any;
      const opDate = new Date(attrs.operationDate);
      let periodKey: string;

      if (periodType === 'day') {
        periodKey = opDate.toISOString().split('T')[0];
      } else if (periodType === 'month') {
        periodKey = `${opDate.getFullYear()}-${String(opDate.getMonth() + 1).padStart(2, '0')}`;
      } else {
        periodKey = `${opDate.getFullYear()}`;
      }

      const amount = parseFloat(attrs.amount) || 0;
      const operationType = attrs.operationType;

      if (!analytics[periodKey]) {
        analytics[periodKey] = { income: 0, expense: 0 };
      }

      if (operationType === 'INCOME') {
        analytics[periodKey].income += amount;
      } else if (operationType === 'EXPENSE') {
        analytics[periodKey].expense += amount;
      }
    }

    return Object.entries(analytics)
      .map(([period, data]) => ({
        period,
        income: data.income,
        expense: data.expense,
        net: data.income - data.expense,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  async checkDuplicateImport(
    familySpaceId: string,
    importSource: string,
    importUniqueId: string,
  ): Promise<Entity | null> {
    return this.prisma.entity.findFirst({
      where: {
        familySpaceId,
        entityType: 'financial_operation',
        status: 'ACTIVE',
        attributes: {
          path: ['importSource'],
          equals: importSource,
        },
      },
    });
  }
}
