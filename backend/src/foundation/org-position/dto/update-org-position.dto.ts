import { PartialType } from '@nestjs/mapped-types';
import { CreateOrgPositionDto } from './create-org-position.dto';

export class UpdateOrgPositionDto extends PartialType(CreateOrgPositionDto) {}
