import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

// ACC-167 (Q5) — who a task goes to, chosen the way the organisation is
// shaped: an org unit, then a position in it, then optionally one of the
// people holding that position there. Or, on a committee's own task, a
// committee member role, optionally narrowed to one member.
//
// ROLE is never an option (Q5): it resolved to every holder anywhere in the
// tenant, with no connection to the work.
//
// The three outcomes are decided by the service, not here:
//   userId given            → straight to that person
//   single-holder position  → straight to its holder (UNASSIGNED if none)
//   otherwise               → a POOL task that a member picks up
// A committee role always pools unless a member is chosen — roles have no
// single-holder flag.
export const ASSIGN_TARGET_KINDS = ['POSITION', 'COMMITTEE_ROLE'] as const;

export class AssignTargetDto {
  @IsIn(ASSIGN_TARGET_KINDS)
  kind!: (typeof ASSIGN_TARGET_KINDS)[number];

  @ValidateIf((o: AssignTargetDto) => o.kind === 'POSITION')
  @IsString()
  @IsNotEmpty()
  orgUnitId?: string;

  @ValidateIf((o: AssignTargetDto) => o.kind === 'POSITION')
  @IsString()
  @IsNotEmpty()
  positionId?: string;

  @ValidateIf((o: AssignTargetDto) => o.kind === 'COMMITTEE_ROLE')
  @IsString()
  @IsNotEmpty()
  committeeId?: string;

  @ValidateIf((o: AssignTargetDto) => o.kind === 'COMMITTEE_ROLE')
  @IsString()
  @IsNotEmpty()
  roleValueId?: string;

  // Narrows the pool to one person. Must be a current member of it.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  userId?: string;
}
