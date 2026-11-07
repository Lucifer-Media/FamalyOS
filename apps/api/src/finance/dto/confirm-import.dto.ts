import { IsArray, IsString } from 'class-validator';

export class ConfirmImportDto {
  @IsString()
  accountEntityId: string;

  @IsArray()
  transactions: {
    date: string;
    amount: number;
    currency: string;
    description: string;
    counterparty?: string;
    category?: string;
    categoryId?: string;
    /** Итерация 4: предложено правилами в предпросмотре. */
    scope?: string;
    transactionType?: string;
    externalId: string;
    sourceFormat: string;
  }[];
}
