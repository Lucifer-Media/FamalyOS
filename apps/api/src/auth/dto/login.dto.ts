import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  twoFactorCode?: string;

  /** Итерация 4.2: токен доверенного устройства из браузера (если запомнено). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceToken?: string;

  /** Итерация 4.2: «Запомнить это устройство» при входе с кодом 2FA. */
  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}
