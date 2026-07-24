import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const WORKFLOW_APPROVAL_DECISIONS = ['APPROVED', 'REJECTED'] as const;

export class SubmitApprovalDto {
  @IsIn(WORKFLOW_APPROVAL_DECISIONS)
  decision!: (typeof WORKFLOW_APPROVAL_DECISIONS)[number];

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  comment?: string;
}
