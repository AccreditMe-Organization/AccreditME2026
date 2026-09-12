import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// ACC-78 — the query half of the list contract. Extended per-endpoint for
// endpoint-specific filters; the four fields here mean the same thing
// everywhere so a shared frontend component can drive any list.
//
// Every field is optional: a caller that passes nothing gets page 1 at the
// default size, unsorted, unfiltered — i.e. the old bare-array behaviour, just
// wrapped. That is what makes migrating ~18 endpoints tractable.
export class PaginationQueryDto {
  // 1-based, to match IPaginatedResponse.page. @Type coerces the query string;
  // without it class-validator sees "2" and @IsInt fails.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  // Capped at 200. An uncapped pageSize is a denial-of-service vector on a
  // large tenant — one request asking for everything defeats the point of
  // paginating, and at ~110ms per round trip (SYSTEM-REFERENCE §8) the
  // database is not the only thing that suffers.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize?: number;

  // Free-text search. Which columns it searches is the endpoint's business,
  // not the caller's — see SortWhitelist's note on why the same is true of
  // sorting. Length-capped so a pathological term cannot be used to probe
  // query performance.
  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;

  // The COLUMN NAME, validated per-endpoint against a whitelist — never
  // passed to Prisma's orderBy as received. See SortWhitelist.
  @IsString()
  @MaxLength(64)
  @IsOptional()
  sortBy?: string;

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortDir?: 'asc' | 'desc';
}
