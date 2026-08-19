import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FinanceService, CreateBankAccountDto, CreateFinancialOperationDto, CreateBudgetDto } from './finance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface RequestWithUser {
  user: { sub: string };
}

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  @Post('bank-accounts')
  createBankAccount(@Req() req: RequestWithUser, @Body() dto: CreateBankAccountDto) {
    return this.financeService.createBankAccount(req.user.sub, dto);
  }

  @Get('bank-accounts')
  getBankAccounts(@Req() req: RequestWithUser, @Query('familySpaceId') familySpaceId: string) {
    return this.financeService.getBankAccounts(familySpaceId, req.user.sub);
  }

  @Get('bank-accounts/:id')
  getBankAccount(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.financeService.getBankAccount(id, req.user.sub);
  }

  @Put('bank-accounts/:id')
  updateBankAccount(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: Partial<CreateBankAccountDto>,
  ) {
    return this.financeService.updateBankAccount(id, req.user.sub, dto);
  }

  @Delete('bank-accounts/:id')
  archiveBankAccount(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.financeService.archiveBankAccount(id, req.user.sub);
  }

  @Post('operations')
  createFinancialOperation(@Req() req: RequestWithUser, @Body() dto: CreateFinancialOperationDto) {
    return this.financeService.createFinancialOperation(req.user.sub, dto);
  }

  @Get('operations')
  getFinancialOperations(
    @Req() req: RequestWithUser,
    @Query('familySpaceId') familySpaceId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('category') category?: string,
    @Query('operationType') operationType?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.financeService.getFinancialOperations(familySpaceId, req.user.sub, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      category,
      operationType,
      limit: limit ? parseInt(limit.toString(), 10) : undefined,
      offset: offset ? parseInt(offset.toString(), 10) : undefined,
    });
  }

  @Get('operations/:id')
  getFinancialOperation(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.financeService.getFinancialOperation(id, req.user.sub);
  }

  @Put('operations/:id')
  updateFinancialOperation(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: Partial<CreateFinancialOperationDto>,
  ) {
    return this.financeService.updateFinancialOperation(id, req.user.sub, dto);
  }

  @Delete('operations/:id')
  archiveFinancialOperation(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.financeService.archiveFinancialOperation(id, req.user.sub);
  }

  @Post('budgets')
  createBudget(@Req() req: RequestWithUser, @Body() dto: CreateBudgetDto) {
    return this.financeService.createBudget(req.user.sub, dto);
  }

  @Get('budgets')
  getBudgets(@Req() req: RequestWithUser, @Query('familySpaceId') familySpaceId: string) {
    return this.financeService.getBudgets(familySpaceId, req.user.sub);
  }

  @Get('budgets/:id')
  getBudget(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.financeService.getBudget(id, req.user.sub);
  }

  @Put('budgets/:id')
  updateBudget(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: Partial<CreateBudgetDto>,
  ) {
    return this.financeService.updateBudget(id, req.user.sub, dto);
  }

  @Delete('budgets/:id')
  archiveBudget(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.financeService.archiveBudget(id, req.user.sub);
  }

  @Get('analytics/by-category')
  getAnalyticsByCategory(
    @Req() req: RequestWithUser,
    @Query('familySpaceId') familySpaceId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.financeService.getAnalyticsByCategory(
      familySpaceId,
      req.user.sub,
      new Date(startDate),
      new Date(endDate),
    );
  }

  @Get('analytics/categories')
  getCategoriesAnalytics(
    @Req() req: RequestWithUser,
    @Query('familySpaceId') familySpaceId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const end = endDate ? new Date(endDate) : new Date();
    return this.financeService.getAnalyticsByCategory(familySpaceId, req.user.sub, start, end);
  }

  @Post('import/preview')
  async previewImport(
    @Req() req: RequestWithUser,
    @Body() body: { file?: any; bankFormat?: string },
  ) {
    // Заглушка для превью импорта - реальная реализация требует обработки файлов
    return { operations: [], message: 'Функционал превью импорта в разработке' };
  }

  @Post('import')
  async importBankStatement(
    @Req() req: RequestWithUser,
    @Body() body: { file?: any; bankFormat?: string; familySpaceId?: string },
  ) {
    // Заглушка для импорта выписки - реальная реализация требует обработки файлов
    return { imported: 0, skipped: 0, message: 'Функционал импорта выписок в разработке' };
  }
}
