import { IsArray, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class ConfirmIntakeDto {
  @IsString()
  entityType: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsObject()
  attributes: Record<string, unknown>;

  @IsOptional()
  @IsString()
  ownerPersonId?: string;

  @IsOptional()
  @IsString()
  parentEntityId?: string; // для дочерних записей составных документов (страница паспорта → регистрация)

  @IsOptional()
  @IsArray()
  additionalPersonIds?: string[];
}
