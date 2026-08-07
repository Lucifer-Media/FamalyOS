import { IsString } from 'class-validator';

export class RefreshDto {
  @IsString()
  refreshToken: string;
}

export class TwoFactorVerifyDto {
  @IsString()
  code: string;
}
