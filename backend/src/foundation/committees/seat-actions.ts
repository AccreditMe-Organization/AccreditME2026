import { HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SeatValue, seatValues } from './committee-seat-rules';

// ACC-283 — what each committee seat allows ON ITS COMMITTEE. Plan:
// backend/Plans/step-283-change-request-chain.md §2.
//
// THE ACTIONS ARE A FIXED SYSTEM LIST (Ahmad, 7 Nov), stored as text in
// CommitteeSeatAction.actionKey, so a new action needs no enum migration. The
// Meetings ticket adds schedule_meeting and record_minutes here, with seat
// defaults and a backfill (Ahmad, 10 Nov, item 2).
//
// A ROW MEANS THE SEAT ALLOWS THE ACTION on that committee; a seat with no row
// allows nothing. Each organisation's DEFAULTS are booleans on the
// committee_member_role lookup (one attribute per action), merged key by key
// with its override row. They are copied into a committee when it is created;
// changing a default never reaches an existing committee.
//
// This file is the ONE reader of the stored rows (seatActionsFor) and the ONE
// place defaults are worked out. Nothing decides by them yet: the chain of
// authority (PR 2) reads decide_reporting_changes, and seat-granted member
// actions come later in the ticket.

export const SEAT_ACTIONS = {
  ADD_MEMBER: 'add_member',
  REMOVE_MEMBER: 'remove_member',
  CHANGE_MEMBER_SEAT: 'change_member_seat',
  REQUEST_CHANGE: 'request_change',
  DECIDE_REPORTING_CHANGES: 'decide_reporting_changes',
} as const;

export type SeatActionKey = (typeof SEAT_ACTIONS)[keyof typeof SEAT_ACTIONS];

/** In the order a screen lists them. */
export const SEAT_ACTION_KEYS: readonly SeatActionKey[] = [
  SEAT_ACTIONS.ADD_MEMBER,
  SEAT_ACTIONS.REMOVE_MEMBER,
  SEAT_ACTIONS.CHANGE_MEMBER_SEAT,
  SEAT_ACTIONS.REQUEST_CHANGE,
  SEAT_ACTIONS.DECIDE_REPORTING_CHANGES,
];

/** The lookup attribute that holds each action's default (lookup.seed.ts). */
export const SEAT_ACTION_DEFAULT_ATTRIBUTE: Readonly<Record<SeatActionKey, string>> = {
  add_member: 'seatAddsMember',
  remove_member: 'seatRemovesMember',
  change_member_seat: 'seatChangesSeat',
  request_change: 'seatRequestsChange',
  decide_reporting_changes: 'seatDecidesReportingChanges',
};

export function isSeatAction(key: string): key is SeatActionKey {
  return (SEAT_ACTION_KEYS as readonly string[]).includes(key);
}

/** The actions a seat allows by default: each one whose attribute is exactly `true`. */
export function defaultActionsOf(attributes: Record<string, unknown>): SeatActionKey[] {
  return SEAT_ACTION_KEYS.filter((action) => attributes[SEAT_ACTION_DEFAULT_ATTRIBUTE[action]] === true);
}

export interface SeatActionRow {
  committeeId: string;
  roleValueId: string;
  actionKey: string;
}

type SeatActionReader = Pick<PrismaService, 'committeeSeatAction'>;
type SeatActionWriter = Pick<PrismaService, '$queryRaw' | 'committeeSeatAction'>;

/**
 * The stored rows of `committeeIds`, optionally one action only, in ONE query,
 * scoped by organisation. The only reader of CommitteeSeatAction.
 */
export async function seatActionsFor(
  client: SeatActionReader,
  organizationId: string,
  committeeIds: readonly string[],
  actionKey?: SeatActionKey,
): Promise<SeatActionRow[]> {
  if (committeeIds.length === 0) return [];
  return client.committeeSeatAction.findMany({
    where: { organizationId, committeeId: { in: [...committeeIds] }, ...(actionKey && { actionKey }) },
    select: { committeeId: true, roleValueId: true, actionKey: true },
    orderBy: [{ committeeId: 'asc' }, { roleValueId: 'asc' }, { actionKey: 'asc' }],
  });
}

/** The organisation's default rows for one committee, from the seats it sees. */
export function defaultSeatActionRows(seats: readonly SeatValue[]): { roleValueId: string; actionKey: SeatActionKey }[] {
  return seats.flatMap((seat) => defaultActionsOf(seat.attributes).map((actionKey) => ({ roleValueId: seat.id, actionKey })));
}

/**
 * Copies the organisation's defaults into a committee that has none. Called
 * inside createCommittee()'s transaction, and by the ACC-283 backfill (which
 * calls it only for a committee with no rows). Returns the rows it wrote.
 */
export async function copyDefaultSeatActions(
  tx: SeatActionWriter,
  organizationId: string,
  committeeId: string,
): Promise<{ roleValueId: string; actionKey: SeatActionKey }[]> {
  const rows = defaultSeatActionRows(await seatValues(tx, organizationId));
  if (rows.length === 0) return [];
  await tx.committeeSeatAction.createMany({
    data: rows.map((r) => ({ organizationId, committeeId, roleValueId: r.roleValueId, actionKey: r.actionKey })),
  });
  return rows;
}

/** Rows as a map, seat id → its actions in list order; what the audit row records. */
export function seatActionMap(rows: readonly Pick<SeatActionRow, 'roleValueId' | 'actionKey'>[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.roleValueId] ??= []).push(r.actionKey);
  for (const actions of Object.values(out)) {
    actions.sort((a, b) => SEAT_ACTION_KEYS.indexOf(a as SeatActionKey) - SEAT_ACTION_KEYS.indexOf(b as SeatActionKey));
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

// ── Refusals ─────────────────────────────────────────────────────────────────
// The reference refusals' shape ({ statusCode, message, error, code }) plus
// what is wrong, so a screen says each from its code.

export const SEAT_ACTION_REFUSALS = {
  SEAT_ACTION_UNKNOWN: 'This is not a committee seat action.',
  SEAT_ACTION_SEAT_UNKNOWN: 'This is not a seat this organisation uses.',
} as const;

export type SeatActionRefusalCode = keyof typeof SEAT_ACTION_REFUSALS;

export class SeatActionRefusal extends HttpException {
  constructor(
    readonly code: SeatActionRefusalCode,
    details: { actionKey?: string; roleValueId?: string },
  ) {
    super(
      { statusCode: HttpStatus.BAD_REQUEST, message: SEAT_ACTION_REFUSALS[code], error: 'Bad Request', code, ...details },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * The map a save sends, checked and normalised: every action must be on the
 * list (else SEAT_ACTION_UNKNOWN); a seat named twice is the union of both.
 * Whether each seat is the organisation's is checked in the transaction.
 */
export function normaliseSeatActions(seats: readonly { roleValueId: string; actions: readonly string[] }[]): Map<string, Set<SeatActionKey>> {
  const out = new Map<string, Set<SeatActionKey>>();
  for (const seat of seats) {
    const set = out.get(seat.roleValueId) ?? new Set<SeatActionKey>();
    for (const action of seat.actions) {
      if (!isSeatAction(action)) throw new SeatActionRefusal('SEAT_ACTION_UNKNOWN', { actionKey: action });
      set.add(action);
    }
    out.set(seat.roleValueId, set);
  }
  return out;
}
