import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TASK_SOURCE_TYPES } from './create-task.dto';

// ACC-197 — "Draft with AI" on New task. The note is the Description field's
// own text, so it carries that field's limit; a note too SHORT is not a
// validation error but a refusal the dialog words (DRAFT_NOTE_TOO_SHORT), so
// no minimum is set here.
export class DraftTaskDto {
  @IsString()
  @MaxLength(2000)
  note!: string;

  // The reader's interface language: the draft is written in it, whatever
  // language the note is in.
  @IsIn(['en', 'ar'])
  language!: 'en' | 'ar';

  // The Title field, if anything is typed.
  @IsString()
  @IsOptional()
  @MaxLength(255)
  title?: string;

  // The record the task is about, when the dialog was opened from one. Both or
  // neither: the service refuses one without the other.
  @IsIn(TASK_SOURCE_TYPES)
  @IsOptional()
  sourceType?: (typeof TASK_SOURCE_TYPES)[number];

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  sourceId?: string;
}
