import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * ACC-281 — GET /workflows/awaiting-me?skip=&take=. Both optional: with neither,
 * the answer is exactly what Home has always read (the oldest five, the total and
 * oldestSince). take is 1 to 50; anything else, a non-integer included, is a 400.
 * skip alone pages by AWAITING_ME_ROWS (5).
 */
export class AwaitingMeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}
