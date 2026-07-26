import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, Min } from 'class-validator';

const WORKFLOW_ACTION_TYPES = [
  'CREATE_TASK',
  'SEND_NOTIFICATION',
  'GENERATE_PDF',
  'LOCK_DOCUMENT',
  'LOG_AUDIT',
  'WEBHOOK',
] as const;

export class CreateWorkflowTransitionActionDto {
  @IsIn(WORKFLOW_ACTION_TYPES)
  actionType!: (typeof WORKFLOW_ACTION_TYPES)[number];

  @IsInt()
  @Min(0)
  order!: number;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsObject()
  @IsOptional()
  configJson?: Record<string, unknown>;
}
