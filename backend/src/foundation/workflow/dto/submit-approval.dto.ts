import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const WORKFLOW_APPROVAL_DECISIONS = [
  'APPROVED',
  'APPROVED_WITH_COMMENTS',
  'RETURNED',
  'ABSTAINED',
] as const;

export class SubmitApprovalDto {
  @IsIn(WORKFLOW_APPROVAL_DECISIONS)
  decision!: (typeof WORKFLOW_APPROVAL_DECISIONS)[number];

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  comment?: string;
}
