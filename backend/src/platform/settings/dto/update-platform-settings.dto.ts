import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdatePlatformSettingsDto {
  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsIn(['info', 'warning'])
  severity!: 'info' | 'warning';

  @IsString()
  @IsOptional()
  activeFrom?: string;

  @IsString()
  @IsOptional()
  activeUntil?: string;
}
