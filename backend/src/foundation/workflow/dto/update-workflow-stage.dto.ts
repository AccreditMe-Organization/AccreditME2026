import { PartialType } from '@nestjs/mapped-types';
import { CreateWorkflowStageDto } from './create-workflow-stage.dto';

export class UpdateWorkflowStageDto extends PartialType(CreateWorkflowStageDto) {}
