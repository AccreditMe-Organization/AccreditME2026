import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// ACC-229 — the record Tasks panel's and the All tasks list's query. Everything
// is filtered and sorted on the server, so a list of hundreds stays fast and
// "Load more" adds the next 50 in the same order.
//
// Its own constants, importing no other task DTO (ACC-199's load-order lesson).

/** The statuses a person filters by — as the screen names them. PENDING is "Assigned". */
export const RECORD_LIST_STATUSES = ['UNASSIGNED', 'PENDING', 'IN_PROGRESS', 'ON_HOLD', 'REJECTED', 'COMPLETED', 'CANCELLED'] as const;
export type RecordListStatus = (typeof RECORD_LIST_STATUSES)[number];

export const RECORD_LIST_SORTS = ['due', 'created', 'updated', 'status', 'title'] as const;
export type RecordListSort = (typeof RECORD_LIST_SORTS)[number];

export const RECORD_LIST_DUE = ['THIS_WEEK', 'LATER', 'NONE'] as const;
export const RECORD_LIST_REQUIRED = ['REQUIRED', 'OPTIONAL'] as const;
/** ACC-244 — the organisation-wide saved views (no record named). */
export const RECORD_LIST_VIEWS = ['all', 'unit', 'unassigned'] as const;
export type RecordListView = (typeof RECORD_LIST_VIEWS)[number];
const SOURCE_TYPES = [
  'MEETING',
  'DOCUMENT',
  'AUDIT',
  'CAPA',
  'INCIDENT',
  'CORRECTIVE_ACTION',
  'STANDARD',
  'KPI',
  'GAP',
  'QUALITY_IMPROVEMENT_PLAN',
  'COMMITTEE',
] as const;

const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);
const toList = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Array.isArray(value) ? value : String(value).split(',');

export class RecordPanelQueryDto {
  @IsIn(SOURCE_TYPES)
  sourceType!: (typeof SOURCE_TYPES)[number];

  @IsString()
  @MaxLength(64)
  sourceId!: string;
}

export class RecordListQueryDto {
  /**
   * Both or neither. Neither means an organisation-wide view (`view`, All tasks
   * when omitted); both means that record's tasks, and `view` is refused.
   */
  @IsOptional()
  @IsIn(SOURCE_TYPES)
  sourceType?: (typeof SOURCE_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceId?: string;

  /**
   * ACC-244 — with no record: `all` (View all tasks, the types it is held on),
   * `unit` (unit scope: the records owned by the viewer's unit and below) or
   * `unassigned` (Manage tasks: no actionable owner, the types managed).
   */
  @IsOptional()
  @IsIn(RECORD_LIST_VIEWS)
  view?: RecordListView;

  /** ACC-244 — a record-type filter for the organisation-wide views. */
  @IsOptional()
  @IsIn(SOURCE_TYPES)
  recordType?: (typeof SOURCE_TYPES)[number];

  /** ACC-244 — the unit view's Unit filter: tasks on records owned by this unit (one in scope). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  unit?: string;

  /** Title, Arabic title, or an active assignee's name. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Transform(toList)
  @IsIn(RECORD_LIST_STATUSES, { each: true })
  status?: RecordListStatus[];

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  overdue?: boolean;

  /** A user id: tasks that person is on now. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignee?: string;

  /** A pool: POSITION:{orgUnitId}:{positionId} or COMMITTEE_ROLE:{committeeId}:{roleValueId}. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  pool?: string;

  @IsOptional()
  @IsIn(RECORD_LIST_REQUIRED)
  required?: (typeof RECORD_LIST_REQUIRED)[number];

  @IsOptional()
  @IsIn(RECORD_LIST_DUE)
  due?: (typeof RECORD_LIST_DUE)[number];

  /** Tasks the viewer is on now. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mine?: boolean;

  @IsOptional()
  @IsIn(RECORD_LIST_SORTS)
  sort?: RecordListSort;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  /** A task to find: the response says where it sits under this sort (a deep link). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  around?: string;
}
