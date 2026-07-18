import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePublicHolidayDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value?.trim())
  nameEn!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value?.trim())
  nameAr?: string;

  @IsDateString()
  date!: string;

  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;
}
