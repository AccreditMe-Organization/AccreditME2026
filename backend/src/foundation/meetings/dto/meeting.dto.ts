import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

/**
 * ACC-316 PR 3a — the meeting writes' bodies. Shape only: who may, what the
 * stage allows and the cross-field rules (owner, place, quorum) are the
 * service's, refused with codes (meeting-refusal.ts).
 */

export const MEETING_EDIT_SCOPES = ['THIS_ONLY', 'THIS_AND_LATER'] as const;

// ACC-316 PR 3b — https only: the link goes into an outside guest's email (lane B's review, fix 5).
const URL_OPTIONS = { protocols: ['https'], require_protocol: true };

export class ScheduleMeetingDto {
  /** Exactly one of committeeId and orgUnitId (MEETING_OWNER_REQUIRED). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  committeeId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgUnitId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  typeValueId!: string;

  /** The start, an instant (UTC). */
  @IsISO8601({ strict: true })
  scheduledAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes!: number;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsUrl(URL_OPTIONS)
  @MaxLength(2000)
  meetingUrl?: string | null;

  /** A unit meeting's own quorum; refused on a committee meeting (MEETING_QUORUM_UNIT_ONLY). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  unitQuorum?: number | null;
}

export class UpdateMeetingDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  typeValueId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes?: number;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsUrl(URL_OPTIONS)
  @MaxLength(2000)
  meetingUrl?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  unitQuorum?: number | null;

  /** The meeting's updatedAt as loaded: a stale save is 409 MEETING_CHANGED. */
  @IsOptional()
  @IsISO8601({ strict: true })
  expectedUpdatedAt?: string;

  /** ACC-316 PR 5 — a series meeting: this one only (default), or this one and every later one. */
  @IsOptional()
  @IsIn(MEETING_EDIT_SCOPES)
  scope?: (typeof MEETING_EDIT_SCOPES)[number];
}

export class RescheduleMeetingDto {
  @IsISO8601({ strict: true })
  scheduledAt!: string;

  /** Sent to the invitees (required, plan §0). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  expectedUpdatedAt?: string;

  /** ACC-316 PR 5 — a series meeting: this one only (default), or this one and every later one. */
  @IsOptional()
  @IsIn(MEETING_EDIT_SCOPES)
  scope?: (typeof MEETING_EDIT_SCOPES)[number];
}

/**
 * PR 8-be (P236, Q2) — POST /meetings/:id/scope-preview: what "this and all
 * later" WOULD do, for the scope confirm. The same fields as the edit or the
 * reschedule (a reschedule's reason isn't needed: nothing is written or sent).
 */
export const MEETING_SCOPE_CHANGES = ['EDIT', 'RESCHEDULE'] as const;

export class MeetingScopePreviewDto {
  @IsIn(MEETING_SCOPE_CHANGES)
  change!: (typeof MEETING_SCOPE_CHANGES)[number];

  /** The new time, for a reschedule (required then). */
  @ValidateIf((o: MeetingScopePreviewDto) => o.change === 'RESCHEDULE')
  @IsISO8601({ strict: true })
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  typeValueId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes?: number;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsUrl(URL_OPTIONS)
  @MaxLength(2000)
  meetingUrl?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  unitQuorum?: number | null;
}

/** `view=series` names its series: a non-empty seriesId. Any other view asks nothing of it. */
@ValidatorConstraint({ name: 'seriesIdForSeriesView' })
class SeriesIdForSeriesView implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if ((args.object as ListMeetingsDto).view !== 'series') return true;
    return typeof value === 'string' && value.trim().length > 0;
  }

  defaultMessage(): string {
    return 'seriesId is required with view=series';
  }
}

/**
 * The list's saved views (Design 1), and "Sub-units' meetings" (Ahmad, 18 Nov).
 * PR 8b (P240): `series`, one series' meetings (seriesId required), the whole
 * series view.
 */
export const MEETING_LIST_VIEWS = ['mine', 'upcoming', 'past', 'minutes', 'all', 'subunits', 'series'] as const;
export type MeetingListView = (typeof MEETING_LIST_VIEWS)[number];

export class ListMeetingsDto {
  @IsOptional()
  @IsIn(MEETING_LIST_VIEWS)
  view?: MeetingListView;

  /**
   * ACC-316 PR 5 — one series' meetings. Required, and not empty, with
   * `view=series` (PR 8b); with any other view it is optional, and an empty one
   * is ignored as it always was (P243).
   */
  @ValidateIf((o: ListMeetingsDto) => o.view === 'series' || o.seriesId !== undefined)
  @IsString()
  @Validate(SeriesIdForSeriesView)
  seriesId?: string;

  /** ACC-316 PR 6 — the list's search: the title contains it (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Narrow to one owner (the committee or unit panel's "All 14 meetings"). */
  @IsOptional()
  @IsString()
  committeeId?: string;

  @IsOptional()
  @IsString()
  orgUnitId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}

/**
 * ACC-316 PR 3b — add a guest: an organisation person (userId), OR an outside
 * guest (name and email required; organisation and role optional). Exactly one
 * of the two shapes (MEETING_GUEST_REQUIRED).
 */
export class AddMeetingGuestDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  userId?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  outsideName?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsEmail()
  @MaxLength(320)
  outsideEmail?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  outsideOrganisation?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  outsideRole?: string | null;
}

export const MEETING_ANSWERS = ['ATTENDING', 'CANT_ATTEND'] as const;

/** Answer the invitation (a user invitee, until the start). */
/** ACC-316 PR 6 — Add a guest's person search. */
export class GuestCandidatesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}

/** PR 8a (Q5) — a standing item's presenter search, for a series not yet made: its owner, then a name. */
export class PresenterCandidatesQueryDto extends GuestCandidatesQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  committeeId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgUnitId?: string;
}

/** ACC-316 PR 6 — may this person schedule for this committee or unit. */
export class MayScheduleQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  committeeId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgUnitId?: string;
}

export class AnswerMeetingDto {
  @IsIn(MEETING_ANSWERS)
  answer!: (typeof MEETING_ANSWERS)[number];

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/**
 * An agenda item's presenter: an invitee (attendeeId), or an organisation
 * person (userId), added as a guest if not invited. One of the two is
 * required: `{}` is a 400 (each is validated while the other is absent).
 */
export class AgendaPresenterDto {
  @ValidateIf((o: AgendaPresenterDto) => !o.userId)
  @IsString()
  @IsNotEmpty()
  attendeeId?: string;

  @ValidateIf((o: AgendaPresenterDto) => !o.attendeeId)
  @IsString()
  @IsNotEmpty()
  userId?: string;
}

export class CreateAgendaItemDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgendaPresenterDto)
  presenter?: AgendaPresenterDto | null;

  @IsOptional()
  @IsBoolean()
  standing?: boolean;
}

/**
 * ACC-323 — what the editor saw, for the fields it changes: each one's value as
 * the dialog loaded it. A field here whose stored value differs now is a stale
 * save, refused MEETING_AGENDA_CHANGED with nothing written. Values as stored:
 * the presenter by its attendee id (guests are attendees too; null is none),
 * the duration as a number, the description null and empty alike (trimmed).
 */
export class AgendaItemExpectedDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationMinutes?: number | null;

  @IsOptional()
  @IsString()
  presenterAttendeeId?: string | null;

  @IsOptional()
  @IsBoolean()
  standing?: boolean;
}

/** Every field optional; `presenter: null` clears the presenter. */
export class UpdateAgendaItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  durationMinutes?: number | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => AgendaPresenterDto)
  presenter?: AgendaPresenterDto | null;

  @IsOptional()
  @IsBoolean()
  standing?: boolean;

  /**
   * ACC-323 — optional: with none sent, the save behaves as before (so either
   * side may deploy first). A field absent from it is not compared.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => AgendaItemExpectedDto)
  expected?: AgendaItemExpectedDto;
}

/** The agenda's new order: every item's id, once. */
export class OrderAgendaDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds!: string[];

  /**
   * The order the person reordered FROM (P198). When it is not the agenda's
   * current order, the reorder is refused (MEETING_AGENDA_CHANGED) and nothing
   * moves, so a second reorder never silently undoes a first.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  expectedItemIds?: string[];
}

/** One time to check: a start (an instant) and how long. */
export class ClashTimeDto {
  @IsISO8601({ strict: true })
  startsAt!: string;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes!: number;
}

/**
 * ACC-316 PR 3b — the clash check (plan §3.10): the owner (a committee or a
 * unit, for a new meeting) or the meeting (whose own time is left out), an
 * optional list of people (else the owner's invitees), and up to 52 times (a
 * series' cap).
 */
export class CheckMeetingClashesDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  meetingId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  committeeId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgUnitId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  userIds?: string[];

  /** A series' cap (CLASH_TIMES_CAP). */
  @IsArray()
  @ArrayMaxSize(53)
  @ValidateNested({ each: true })
  @Type(() => ClashTimeDto)
  times!: ClashTimeDto[];
}

// ── ACC-316 PR 4 — attendance, minutes and review ────────────────────────────

export const MEETING_ATTENDANCE = ['PRESENT', 'APOLOGIES', 'ABSENT'] as const;

export class AttendanceRowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  attendeeId!: string;

  /** Null clears it. */
  @IsOptional()
  @IsIn(MEETING_ATTENDANCE)
  attendance!: (typeof MEETING_ATTENDANCE)[number] | null;
}

/** One row (saved on tap) or several at once. */
export class RecordAttendanceDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttendanceRowDto)
  rows!: AttendanceRowDto[];
}

/** An agenda item's discussion, replaced whole (an AI draft's Accept is one such write, ACC-322). Empty clears it. */
export class ItemMinutesDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(20000)
  discussion!: string | null;
}

export class DecisionDto {
  // Refused by code when empty (meeting-refusal.ts), never a bare 400.
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(4000)
  text!: string | null;

  /** All three, or none. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  votesFor?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  votesAgainst?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  votesAbstain?: number | null;
}

export class CreateActionItemDto {
  // Refused by code when empty (meeting-refusal.ts), never a bare 400.
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  title!: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  ownerUserId!: string;

  @IsISO8601({ strict: true })
  dueAt!: string;
}

/** In Minutes Draft any field; in Minutes Review only the due date. */
export class UpdateActionItemDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  title?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  ownerUserId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dueAt?: string;
}

/** A note on an open action from the last meeting. Empty removes it. */
export class OpenActionNoteDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  note!: string | null;
}

export class DistributeMinutesDto {
  /** yyyy-MM-dd, after today; 5 working days ahead when absent. */
  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(10)
  reviewBy?: string;
}

export class ReturnMinutesDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  reason?: string | null;
}

export class SuggestCorrectionDto {
  /** Null for the minutes as a whole. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  agendaItemId?: string | null;

  // Refused by code when empty (meeting-refusal.ts), never a bare 400.
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(4000)
  text!: string | null;
}

export class DecideSuggestionDto {
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  reply?: string | null;
}

// ── ACC-316 PR 5 — series ─────────────────────────────────────────────────────

export const SERIES_EVERY = ['WEEK_1', 'WEEK_2', 'MONTH_1', 'MONTH_3', 'MONTH_6', 'MONTH_12'] as const;
export const SERIES_ON = ['WEEKDAY', 'DAY_OF_MONTH', 'ORDINAL_WEEKDAY'] as const;
export const SERIES_ORDINAL = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'LAST'] as const;
/** PR 8a (Q5) — a series' most standing agenda items. */
export const MEETING_STANDING_AGENDA_MAX = 10;

export class StandingAgendaItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title!: string;

  /** An organisation person; not yet an invitee, they become an organisation guest of each meeting. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  presenterUserId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  durationMinutes?: number | null;
}

/** A series: the meeting's fields, the repeat and its end. Shape only; the rules are the service's, refused by code. */
export class CreateMeetingSeriesDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  committeeId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgUnitId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  typeValueId!: string;

  /** HH:mm in the organisation's zone. */
  @IsString()
  @MaxLength(5)
  startTime!: string;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes!: number;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsUrl(URL_OPTIONS)
  @MaxLength(2000)
  meetingUrl?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  unitQuorum?: number | null;

  @IsIn(SERIES_EVERY)
  every!: (typeof SERIES_EVERY)[number];

  @IsIn(SERIES_ON)
  onKind!: (typeof SERIES_ON)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  weekday?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number | null;

  @IsOptional()
  @IsIn(SERIES_ORDINAL)
  ordinal?: (typeof SERIES_ORDINAL)[number] | null;

  /** yyyy-MM-dd. */
  @IsISO8601({ strict: true })
  @MaxLength(10)
  firstDate!: string;

  /** yyyy-MM-dd; exactly one of endsOn and count. */
  @IsOptional()
  @IsISO8601({ strict: true })
  @MaxLength(10)
  endsOn?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(53)
  count?: number | null;

  /** At most ten items (Ahmad, 20 Nov, PR 8 Q5): what step 2's editor offers. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MEETING_STANDING_AGENDA_MAX)
  @ValidateNested({ each: true })
  @Type(() => StandingAgendaItemDto)
  standingAgenda?: StandingAgendaItemDto[];
}

export class EndMeetingSeriesDto {
  /** Sent to everyone invited to each meeting cancelled. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
