import {
  IsString,
  IsOptional,
  IsBoolean,
  IsDateString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { HOLIDAY_DATE } from './holiday-date';

export class UpdatePublicHolidayDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value?.trim())
  nameEn?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value?.trim())
  nameAr?: string;

  // ACC-318 — a holiday is a calendar day: the date only, never a time or an
  // offset (one would move it to another day). The screen sends YYYY-MM-DD.
  @Matches(HOLIDAY_DATE, { message: 'date must be a calendar date, YYYY-MM-DD' })
  @IsDateString({ strict: true })
  @IsOptional()
  date?: string;

  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;
}
