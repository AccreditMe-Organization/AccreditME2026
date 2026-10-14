import { IsNotEmpty, IsString } from 'class-validator';

// ACC-199 — the task's "assigned on an AI suggestion" claim, on Create task and
// Reassign. Only an id: the service checks it against the AI log and against
// who the task really went to; a claim that does not check out is ignored,
// never refused.
//
// ITS OWN FILE, importing no other task DTO. It used to live in
// workload-hint.dto.ts, which imports create-task.dto.ts for its allowed
// values, while create-task.dto.ts imported this class back. Whichever loaded
// first saw the other half-built: the live API answered 400 "sourceType must
// be one of the following values: undefined". dto-load-order.spec.ts pins it.
export class TaskAiWorkloadHintDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}
