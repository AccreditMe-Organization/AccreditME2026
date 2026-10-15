import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// ACC-230 — the Members and Sub-committees "See all" lists: search, one sort,
// and Load more by 50. A committee's members and children are few, so the
// service reads them once (scoped by organisation) and searches, sorts and
// pages them itself — on the server, never in the browser.

export const MEMBER_SORTS = ['seat', 'name', 'since'] as const;
export const SUB_COMMITTEE_SORTS = ['name', 'status', 'members'] as const;

class CommitteeListQueryDto {
  /** A name, case-insensitive, anywhere in it. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

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

  /** The reader's language, so a name sorts by the name they see. */
  @IsOptional()
  @IsIn(['en', 'ar'])
  lang?: 'en' | 'ar';
}

export class CommitteeMembersPageQueryDto extends CommitteeListQueryDto {
  @IsOptional()
  @IsIn(MEMBER_SORTS)
  sort?: (typeof MEMBER_SORTS)[number];
}

export class SubCommitteesQueryDto extends CommitteeListQueryDto {
  @IsOptional()
  @IsIn(SUB_COMMITTEE_SORTS)
  sort?: (typeof SUB_COMMITTEE_SORTS)[number];
}
