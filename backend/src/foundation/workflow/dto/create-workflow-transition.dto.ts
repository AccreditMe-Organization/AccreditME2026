import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

const WORKFLOW_TRIGGER_CONDITIONS = [
  'SPECIFIC_USER',
  'ROLE_BASED',
  'ANY_AUTHENTICATED',
  'SYSTEM_AUTOMATIC',
] as const;

// ACC-190 — ADVANCE is held by the stage's mandatory tasks; RETURN (send back)
// and EXIT (end the record) never are. Omitted means ADVANCE (the schema default).
export const WORKFLOW_TRANSITION_KINDS = ['ADVANCE', 'RETURN', 'EXIT'] as const;

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

  // ACC-55 — `| null` is a genuine, distinct value here, not just "absent":
  // null explicitly CLEARS a previously-set permission, which the service
  // distinguishes from "not provided" via its own `!== undefined` check.
  // Same reasoning as assigneeCommitteeRoleValueId on the stage DTOs.
  // @IsOptional() skips validation for null (verified empirically, not
  // assumed), so null passes through while a non-string is still rejected.
  @IsString()
  @IsOptional()
  requiredPermission?: string | null;

  @IsIn(WORKFLOW_TRIGGER_CONDITIONS)
  triggerCondition!: (typeof WORKFLOW_TRIGGER_CONDITIONS)[number];

  @IsString()
  @IsOptional()
  triggerUserId?: string;

  @IsString()
  @IsOptional()
  triggerRoleId?: string;

  @IsObject()
  @IsOptional()
  validatorConfig?: Record<string, unknown>;

  @IsIn(WORKFLOW_TRANSITION_KINDS)
  @IsOptional()
  kind?: (typeof WORKFLOW_TRANSITION_KINDS)[number];
}
