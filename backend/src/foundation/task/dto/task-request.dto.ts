import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

// ACC-173 — the person doing a task asks its creator for more time
// (EXTENSION, with the new due date) or to put it ON_HOLD until a date.
//
// Dates are instants (ISO 8601). The client builds them with New task's
// convention (ACC-96 Part A): a picked day and time as a wall-clock time in the
// reader's browser zone. A hold date is the START of working hours on the chosen
// day. The service checks each date against the task and the clock; this DTO
// only checks the shape.
export const TASK_REQUEST_TYPES = ['EXTENSION', 'ON_HOLD'] as const;

export class CreateTaskRequestDto {
  @IsIn(TASK_REQUEST_TYPES)
  type!: (typeof TASK_REQUEST_TYPES)[number];

  @ValidateIf((o: CreateTaskRequestDto) => o.type === 'EXTENSION')
  @IsISO8601({ strict: true })
  requestedDueAt?: string;

  @ValidateIf((o: CreateTaskRequestDto) => o.type === 'ON_HOLD')
  @IsISO8601({ strict: true })
  holdUntil?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

// Approve means approve AS ASKED — there is no counter-proposal. A decider who
// wants a different date declines with a note, and the assignee asks again.
export class ApproveTaskRequestDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string;
}

// A decline says why: the person who asked reads it.
export class DeclineTaskRequestDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note!: string;
}
