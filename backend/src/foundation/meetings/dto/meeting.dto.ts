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
  ValidateIf,
  ValidateNested,
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

/** The list's saved views (Design 1), and "Sub-units' meetings" (Ahmad, 18 Nov). */
export const MEETING_LIST_VIEWS = ['mine', 'past', 'minutes', 'all', 'subunits'] as const;
export type MeetingListView = (typeof MEETING_LIST_VIEWS)[number];

export class ListMeetingsDto {
  @IsOptional()
  @IsIn(MEETING_LIST_VIEWS)
  view?: MeetingListView;

  /** ACC-316 PR 5 — one series' meetings (the series view). */
  @IsOptional()
  @IsString()
  seriesId?: string;

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
}

/** The agenda's new order: every item's id, once. */
export class OrderAgendaDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds!: string[];
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

// ── ACC-316 PR 5 — series ─────────────────────────────────────────────────────

export const SERIES_EVERY = ['WEEK_1', 'WEEK_2', 'MONTH_1', 'MONTH_3', 'MONTH_6', 'MONTH_12'] as const;
export const SERIES_ON = ['WEEKDAY', 'DAY_OF_MONTH', 'ORDINAL_WEEKDAY'] as const;
export const SERIES_ORDINAL = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'LAST'] as const;

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
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
