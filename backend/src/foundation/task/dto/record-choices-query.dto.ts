import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * ACC-280 — GET /tasks/record-choices: New task's record picker. One record type, a
 * search, and Load more by at most 50, all on the server (am-simple-list's contract).
 * The reader's language decides which name the records sort by.
 */
export class RecordChoicesQueryDto {
  /** A task source type, e.g. COMMITTEE. One the caller may not create on has no choices. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  type!: string;

  /** A name, case-insensitive, anywhere in it. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

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
