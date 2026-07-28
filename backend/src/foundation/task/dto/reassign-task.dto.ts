import { ArrayMinSize, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Every reassignment requires a documented reason — Absence and Departure
// Management Pattern 2's audit-trail requirement.
export class ReassignTaskDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  newAssigneeUserIds!: string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
