import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AssignTargetDto } from './assign-target.dto';

// Every reassignment requires a documented reason — Absence and Departure
// Management Pattern 2's audit-trail requirement.
//
// ACC-167 — EXACTLY ONE of the two ways to say who it goes to: `assignTo` (the
// picker: unit, position, optional person — or a committee role) or the
// legacy `newAssigneeUserIds`. The service refuses both or neither (400).
export class ReassignTaskDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  newAssigneeUserIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AssignTargetDto)
  assignTo?: AssignTargetDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
