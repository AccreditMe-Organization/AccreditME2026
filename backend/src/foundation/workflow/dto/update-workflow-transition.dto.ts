import { IsBoolean, IsOptional } from 'class-validator';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateWorkflowTransitionDto } from './create-workflow-transition.dto';

// A transition's endpoints are structural, not editable after creation —
// delete and recreate instead.
export class UpdateWorkflowTransitionDto extends PartialType(
  OmitType(CreateWorkflowTransitionDto, ['fromStageId', 'toStageId'] as const),
) {
  // Not on CreateWorkflowTransitionDto — the builder sets this as a follow-up
  // edit once a transition exists, not at creation time.
  @IsBoolean()
  @IsOptional()
  isApprovalPath?: boolean;
}
