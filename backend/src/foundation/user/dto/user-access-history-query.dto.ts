import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** ACC-216 part 2 — `GET /users/:userId/access-history`. */
export class UserAccessHistoryQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  skip?: number;

  /** 1 to 50; 5 when left out (the panel's first read). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  take?: number;
}
