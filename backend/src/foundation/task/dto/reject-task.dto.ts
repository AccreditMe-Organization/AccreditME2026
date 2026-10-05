import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// ACC-163 — an assignee hands a task back with a reason. The reason is what
// the creator acts on when they reassign it (Q4), so it is required, and
// whitespace alone does not count as one.
export class RejectTaskDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
