import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const WORKFLOW_TRIGGER_CONDITIONS = [
  'SPECIFIC_USER',
  'ROLE_BASED',
  'ANY_AUTHENTICATED',
  'SYSTEM_AUTOMATIC',
] as const;

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

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  labelAr!: string;

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
}
