import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkflowStageDto } from './create-workflow-stage.dto';

// `who` (ACC-271 PR 3) has been declared on CreateWorkflowStageDto since PR 5-be,
// and is inherited here: on update it REPLACES the stage's entries and sets how
// they decide; omitted leaves them. Saving it converts a stage that was still on
// the old assignee columns.
export class UpdateWorkflowStageDto extends PartialType(CreateWorkflowStageDto) {}
