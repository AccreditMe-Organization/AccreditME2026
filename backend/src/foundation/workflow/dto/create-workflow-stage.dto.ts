import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const WORKFLOW_APPROVAL_MODES = ['SINGLE', 'SEQUENTIAL', 'PARALLEL', 'COMMITTEE'] as const;
const WORKFLOW_PARALLEL_THRESHOLDS = ['ALL', 'MAJORITY', 'ANY'] as const;
const WORKFLOW_ASSIGNEE_STRATEGIES = [
  'SPECIFIC_USER',
  'ROLE',
  'ORG_UNIT_HEAD',
  'SELF',
  'COMMITTEE',
  'ROUND_ROBIN',
] as const;

export class CreateWorkflowStageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameAr!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsInt()
  @Min(0)
  order!: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  slaWorkingHours?: number;

  @IsString()
  @IsOptional()
  requiredPermission?: string;

  @IsBoolean()
  @IsOptional()
  isInitial?: boolean;

  @IsBoolean()
  @IsOptional()
  isFinal?: boolean;

  @IsIn(WORKFLOW_APPROVAL_MODES)
  approvalMode!: (typeof WORKFLOW_APPROVAL_MODES)[number];

  @IsIn(WORKFLOW_PARALLEL_THRESHOLDS)
  @IsOptional()
  parallelThreshold?: (typeof WORKFLOW_PARALLEL_THRESHOLDS)[number];

  @IsString()
  @IsOptional()
  committeeId?: string;

  @IsIn(WORKFLOW_ASSIGNEE_STRATEGIES)
  assigneeStrategy!: (typeof WORKFLOW_ASSIGNEE_STRATEGIES)[number];

  @IsString()
  @IsOptional()
  assigneeUserId?: string;

  @IsString()
  @IsOptional()
  assigneeRoleId?: string;

  @IsArray()
  @IsOptional()
  escalationConfig?: Record<string, unknown>[];
}
