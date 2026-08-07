import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { FamilyRole, PermissionAction, PermissionResource } from '@prisma/client';

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsEnum(FamilyRole)
  role: FamilyRole;
}

export class AcceptInvitationNewUserDto {
  @IsString()
  @MinLength(10)
  password: string;

  @IsString()
  fullName: string;
}

export class ChangeRoleDto {
  @IsEnum(FamilyRole)
  role: FamilyRole;
}

export class SetPermissionOverrideDto {
  @IsEnum(PermissionResource)
  resource: PermissionResource;

  @IsEnum(PermissionAction)
  action: PermissionAction;

  allowed: boolean;
}
