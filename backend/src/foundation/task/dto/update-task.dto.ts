import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateTaskDto } from './create-task.dto';

// sourceType/sourceId are structural — not editable after creation, same
// precedent as WorkflowTransition's fromStageId/toStageId in Step 6.
export class UpdateTaskDto extends PartialType(
  OmitType(CreateTaskDto, ['sourceType', 'sourceId', 'assigneeUserIds']),
) {}
