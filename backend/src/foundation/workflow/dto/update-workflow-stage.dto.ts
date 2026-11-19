import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateWorkflowStageDto } from './create-workflow-stage.dto';

// `who` (ACC-271 PR 3) has been declared on CreateWorkflowStageDto since PR 5-be,
// and is inherited here: on update it REPLACES the stage's entries and sets how
// they decide; omitted leaves them.
// ACC-245 — where a review stage is added is a create-only choice: a sent one is
// the global whitelist's 400.
export class UpdateWorkflowStageDto extends PartialType(OmitType(CreateWorkflowStageDto, ['reviewAfterStageId'] as const)) {}
