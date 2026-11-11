import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** ACC-295 — GET /committees/memberships?userId=: whose memberships to read. */
export class CommitteeMembershipsQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  userId!: string;
}
