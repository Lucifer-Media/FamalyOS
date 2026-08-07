import { IsEnum, IsIn, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { ConfidentialityLevel } from '@prisma/client';

export class CreateEntityDto {
  @IsString()
  entityType: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  ownerPersonId?: string;

  @IsOptional()
  @IsString()
  parentEntityId?: string;

  @IsOptional()
  @IsEnum(ConfidentialityLevel)
  confidentialityLevel?: ConfidentialityLevel;

  @IsObject()
  attributes: Record<string, unknown>;

  @IsOptional()
  @IsString()
  changeSummary?: string;
}

export class UpdateEntityDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  ownerPersonId?: string;

  @IsOptional()
  @IsEnum(ConfidentialityLevel)
  confidentialityLevel?: ConfidentialityLevel;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  changeSummary?: string;
}

export class RevertEntityDto {
  versionNumber: number;

  @IsOptional()
  @IsString()
  changeSummary?: string;
}

export class CreateEntityLinkDto {
  @IsString()
  targetEntityId: string;

  @IsString()
  linkType: string;

  @IsOptional()
  @IsString()
  note?: string;
}
