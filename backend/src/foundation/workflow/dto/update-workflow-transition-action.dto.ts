import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkflowTransitionActionDto } from './create-workflow-transition-action.dto';

export class UpdateWorkflowTransitionActionDto extends PartialType(
  CreateWorkflowTransitionActionDto,
) {}
