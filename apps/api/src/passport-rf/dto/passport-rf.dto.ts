import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePassportRfDto {
  @IsObject()
  attributes: Record<string, unknown>; // см. entity-type-registry.ts → passport_rf.fields

  @IsOptional()
  @IsString()
  ownerPersonId?: string;
}

export class CreatePassportChildRecordDto {
  @IsString()
  childType: 'passport_registration' | 'passport_marriage' | 'passport_child_record';

  @IsObject()
  attributes: Record<string, unknown>;
}

export class UpdatePassportRfDto {
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  changeSummary?: string;
}
