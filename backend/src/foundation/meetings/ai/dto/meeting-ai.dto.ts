import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimToNull } from '../../../../common/utils/trim-to-null.transform';
import { NOTES_MAX } from '../minutes-draft-answer';

/**
 * ACC-322 — the Meetings AI bodies. Shape only: who may, the stage and the
 * caps are the service's, refused with codes (meeting-refusal.ts).
 */

export const MEETING_AI_LANGUAGES = ['en', 'ar'] as const;

/** The rough notes, saved as they are typed. Empty removes them. */
export class MeetingAiNotesDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(NOTES_MAX)
  text!: string | null;
}

/** Draft minutes: the presser's interface language, which the minutes are written in. */
export class DraftMinutesAiDto {
  @IsIn(MEETING_AI_LANGUAGES)
  language!: (typeof MEETING_AI_LANGUAGES)[number];
}

/**
 * Accept: a minutes suggestion takes no body. An action suggestion may carry
 * the values its inline Edit row chose (what, owner, due date); anything not
 * sent keeps the suggestion's own value.
 */
export class AcceptMeetingAiDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  ownerUserId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dueAt?: string;
}
