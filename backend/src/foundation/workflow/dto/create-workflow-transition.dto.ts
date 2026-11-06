import { IsBoolean, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

// ACC-190 — ADVANCE is held by the stage's mandatory tasks; RETURN (send back)
// and EXIT (end the record) never are. Omitted means ADVANCE (the schema default).
export const WORKFLOW_TRANSITION_KINDS = ['ADVANCE', 'RETURN', 'EXIT'] as const;

// ACC-271 PR 6b — a move names no people (the old permission, trigger, role
// and user fields are gone): whoever works its from-stage
// presses it, and the service writes mover PERSON. The global whitelist refuses
// an old field sent anyway, 400 "property X should not exist".
export class CreateWorkflowTransitionDto {
  @IsString()
  @IsNotEmpty()
  fromStageId!: string;

  @IsString()
  @IsNotEmpty()
  toStageId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  labelEn!: string;

  // ACC-160 — optional, because Arabic fields are never mandatory. An empty
  // value stores NULL rather than '' (see trimToNull). Update DTOs built with
  // PartialType inherit both halves.
  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(trimToNull)
  labelAr?: string | null;

  @IsObject()
  @IsOptional()
  validatorConfig?: Record<string, unknown>;

  @IsIn(WORKFLOW_TRANSITION_KINDS)
  @IsOptional()
  kind?: (typeof WORKFLOW_TRANSITION_KINDS)[number];

  // ACC-271 PR 5b — accepted on create too: the transition panel shows
  // "Approval path" when adding a move, not only once it exists. Omitted means
  // false (the schema default).
  @IsBoolean()
  @IsOptional()
  isApprovalPath?: boolean;
}
