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
  'POSITION_FIXED',
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

  // ACC-28 — narrows assigneeStrategy: COMMITTEE to members holding this
  // committee_member_role lookup value (e.g. "chairman"). Only meaningful
  // when assigneeStrategy === COMMITTEE; validated against LookupValue in
  // WorkflowTemplateService (see validateCommitteeRoleValueId()).
  @IsString()
  @IsOptional()
  assigneeCommitteeRoleValueId?: string;

  // ACC-54 — the POSITION_FIXED pair: resolves to whoever holds this
  // position in this specific unit. Both @IsOptional(), matching every other
  // strategy-specific field on this DTO (assigneeUserId, assigneeRoleId,
  // committeeId, assigneeCommitteeRoleValueId are all optional too) — this
  // DTO deliberately does not enforce which fields a given strategy needs.
  // See WorkflowTemplateService for why that stays soft rather than becoming
  // a hard pairing rule here; each id IS tenant-validated there when present.
  @IsString()
  @IsOptional()
  assigneePositionId?: string;

  @IsString()
  @IsOptional()
  assigneeOrgUnitId?: string;

  @IsArray()
  @IsOptional()
  escalationConfig?: Record<string, unknown>[];
}
