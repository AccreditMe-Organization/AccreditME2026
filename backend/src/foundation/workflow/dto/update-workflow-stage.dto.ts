import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkflowStageDto } from './create-workflow-stage.dto';
import { StageWhoDto } from './stage-who.dto';

export class UpdateWorkflowStageDto extends PartialType(CreateWorkflowStageDto) {
  // ACC-271 PR 3 — who works the stage. REPLACES the stage's entries and sets
  // how they decide; omitted leaves them. Saving it converts a stage that was
  // still on the old assignee columns.
  @IsOptional()
  @ValidateNested()
  @Type(() => StageWhoDto)
  who?: StageWhoDto;
}
