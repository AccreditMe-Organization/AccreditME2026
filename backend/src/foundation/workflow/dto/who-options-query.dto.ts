import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * ACC-271 PR 5a — the stage editor's person and committee pickers: search,
 * one sort (by name), and Load more by 50 — all on the server (am-simple-list's
 * contract). The reader's language decides which name a committee sorts by.
 */
export class WhoOptionsQueryDto {
  /** A name, case-insensitive, anywhere in it. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(['name'])
  sort?: 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsIn(['en', 'ar'])
  lang?: 'en' | 'ar';
}
