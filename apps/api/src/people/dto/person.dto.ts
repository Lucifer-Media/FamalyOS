import { IsDateString, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePersonDto {
  @IsString()
  @MinLength(1)
  fullName: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  citizenship?: string;

  @IsOptional()
  @IsObject()
  contacts?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  addresses?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePersonDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  citizenship?: string;

  @IsOptional()
  @IsObject()
  contacts?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  addresses?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  notes?: string;
}
