import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// ACC-167 (Q6) — whoever picked a task up from its pool hands it back, with a
// reason: the next person to pick it up reads it in the notification. Same
// rules as a reject's reason, deliberately — but a separate class, because the
// two actions mean different things and may diverge.
export class ReleaseTaskDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
