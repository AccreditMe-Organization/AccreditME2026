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

  @IsString()
  @IsOptional()
  requiredPermission?: string;

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
