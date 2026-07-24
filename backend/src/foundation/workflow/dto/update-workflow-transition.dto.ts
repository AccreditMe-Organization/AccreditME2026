import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateWorkflowTransitionDto } from './create-workflow-transition.dto';

// A transition's endpoints are structural, not editable after creation —
// delete and recreate instead.
export class UpdateWorkflowTransitionDto extends PartialType(
  OmitType(CreateWorkflowTransitionDto, ['fromStageId', 'toStageId'] as const),
) {}
