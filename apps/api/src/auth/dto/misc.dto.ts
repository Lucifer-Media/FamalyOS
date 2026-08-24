import { IsString } from 'class-validator';

export class RefreshDto {
  @IsString()
  refreshToken: string;
}

export class TwoFactorVerifyDto {
  @IsString()
  code: string;
}

export class UseRecoveryCodeDto {
  @IsString()
  email: string;

  @IsString()
  recoveryCode: string;
}

export class RegenerateRecoveryCodesDto {
  @IsString()
  password: string;
}
