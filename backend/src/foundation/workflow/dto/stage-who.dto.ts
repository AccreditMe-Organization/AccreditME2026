import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { STAGE_ASSIGNEE_KINDS_ALL, STAGE_WHO_MODES } from '../stage-who';

/**
 * ACC-271 PR 3 — one assignee entry of a stage save. The shape is checked here;
 * what a kind needs and uses, duplicates, the Committee vote rule and the tenant
 * checks are the service's (stage-who.ts, WorkflowTemplateService), each with its
 * own refusal code. `null` means "not set": the record's unit or committee for
 * an Org unit head or Committee entry.
 */
export class StageWhoEntryDto {
  @IsIn(STAGE_ASSIGNEE_KINDS_ALL)
  kind!: (typeof STAGE_ASSIGNEE_KINDS_ALL)[number];

  @IsString()
  @IsOptional()
  userId?: string | null;

  @IsString()
  @IsOptional()
  positionId?: string | null;

  @IsString()
  @IsOptional()
  orgUnitId?: string | null;

  @IsString()
  @IsOptional()
  committeeId?: string | null;

  @IsString()
  @IsOptional()
  committeeRoleValueId?: string | null;
}

/** ACC-271 PR 3 — who works a stage: how they decide, and the entries joined by "or". */
export class StageWhoDto {
  @IsIn(STAGE_WHO_MODES)
  mode!: (typeof STAGE_WHO_MODES)[number];

  // At least one is the service's rule (WHO_ENTRIES_REQUIRED, a sentence the
  // screen can say); 20 is a cap on what a request may carry.
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => StageWhoEntryDto)
  entries!: StageWhoEntryDto[];
}
