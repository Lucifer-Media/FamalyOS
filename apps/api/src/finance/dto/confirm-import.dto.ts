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
    externalId: string;
    sourceFormat: string;
  }[];
}
