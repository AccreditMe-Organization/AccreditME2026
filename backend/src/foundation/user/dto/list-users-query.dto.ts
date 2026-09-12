import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// ACC-78 — this endpoint's own filters, declared on ONE DTO together with the
// shared list contract it extends.
//
// THE BUG THIS FIXES, because it is not obvious and it shipped once:
//
// The first attempt kept these as separate `@Query('status')` parameters
// alongside `@Query() pagination: PaginationQueryDto`. That reads as though
// each parameter is validated on its own. It is not. A bare `@Query()` binds
// the WHOLE query object, so the global ValidationPipe — configured with
// `forbidNonWhitelisted: true` in main.ts — validated every query parameter
// against PaginationQueryDto, which declares none of these. The result was a
// 400 on any request carrying a filter:
//
//   {"message":["property status should not exist"],
//    "error":"Bad Request","statusCode":400}
//
// Clicking a status chip returned 400. So did any caller passing orgUnitId.
// Nothing in the unit suite could see it: a controller spec calls the method
// directly with arguments already built, so the pipe never runs. The fix is
// not to relax the pipe — `forbidNonWhitelisted` is what makes a typo'd
// parameter an error instead of a silently ignored filter — but to declare
// what the endpoint actually accepts. See user.contract.spec.ts, which
// exercises the real pipe.
export class ListUsersQueryDto extends PaginationQueryDto {
  // Deliberately NOT bound to the Prisma enum type: an unknown status should be
  // a 400 naming the allowed values, not a runtime cast that reaches the query.
  @IsIn(['ACTIVE', 'INVITED', 'INACTIVE', 'SUSPENDED'])
  @IsOptional()
  status?: string;

  // @IsString, NOT @IsUUID. This schema generates ids with cuid(), not uuid()
  // — @IsUUID rejected every real id with a 400, which passed every unit test
  // because the fixtures were UUIDs. Found in a browser, not in the suite.
  //
  // A stale or malformed id is better answered with an empty list than a
  // validation error: an id from a bookmarked URL is a normal thing to meet.
  @IsString()
  @MaxLength(64)
  @IsOptional()
  orgUnitId?: string;

  // ACC-78 — new. The design reference's filter bar is status + org unit +
  // position; the first two existed and this one did not, so the filter bar
  // could not be built as designed without it.
  @IsString()
  @MaxLength(64)
  @IsOptional()
  positionId?: string;
}
