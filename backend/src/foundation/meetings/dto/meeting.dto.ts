import { Transform, Type } from 'class-transformer';
import {
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
} from 'class-validator';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

/**
 * ACC-316 PR 3a — the meeting writes' bodies. Shape only: who may, what the
 * stage allows and the cross-field rules (owner, place, quorum) are the
 * service's, refused with codes (meeting-refusal.ts).
 */

const URL_OPTIONS = { protocols: ['https', 'http'], require_protocol: true };

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
}

/** The list's saved views (Design 1), and "Sub-units' meetings" (Ahmad, 18 Nov). */
export const MEETING_LIST_VIEWS = ['mine', 'past', 'minutes', 'all', 'subunits'] as const;
export type MeetingListView = (typeof MEETING_LIST_VIEWS)[number];

export class ListMeetingsDto {
  @IsOptional()
  @IsIn(MEETING_LIST_VIEWS)
  view?: MeetingListView;

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
