import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMITTEES_PERMISSIONS } from '../../common/constants/permissions';
import { CommitteeViewer, activeSeatOf, seesEveryCommittee } from '../../common/services/committee-membership';
import { COMMITTEE_ACTIONS } from '../workflow/record-registry';
import { SEAT_ACTIONS, SeatActionKey, seatActionsFor } from './seat-actions';

// ACC-283 PR 6 — on their own committee, a member may add a member, remove a
// member, change a seat and request a change where their SEAT allows it OR their
// role's permission does (Ahmad, 10 Nov, item 1). It replaces ACC-281's interim
// write rule for these four actions. Plan: backend/Plans/step-283-change-request-
// chain.md §17.
//
// THIS FILE IS THE RULE. Every write path and every offer asks memberActionsFor()
// or assertMemberAction(); never re-derive it. The seat only ever ADDS (§0):
// nobody loses an action their role gives them today.
//
// Not here, on purpose: Edit details and the seat-actions editor (not seat
// actions; ACC-281's rule, unchanged), withdraw (the requester only), and
// deciding (the chain, change-request-chain.ts, which reads
// decide_reporting_changes itself). Oversight never counts: a head who is not a
// member holds no seat.

/** Each action's three names: the seat key, the stage key and the permission. The one map. */
export const MEMBER_ACTIONS = {
  add_member: {
    seat: SEAT_ACTIONS.ADD_MEMBER,
    stage: COMMITTEE_ACTIONS.ADD_MEMBER,
    permission: COMMITTEES_PERMISSIONS.ADD_MEMBER,
  },
  remove_member: {
    seat: SEAT_ACTIONS.REMOVE_MEMBER,
    stage: COMMITTEE_ACTIONS.REMOVE_MEMBER,
    permission: COMMITTEES_PERMISSIONS.REMOVE_MEMBER,
  },
  change_member_seat: {
    seat: SEAT_ACTIONS.CHANGE_MEMBER_SEAT,
    stage: COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE,
    permission: COMMITTEES_PERMISSIONS.CHANGE_MEMBER_ROLE,
  },
  request_change: {
    seat: SEAT_ACTIONS.REQUEST_CHANGE,
    stage: COMMITTEE_ACTIONS.REQUEST_CHANGE,
    permission: COMMITTEES_PERMISSIONS.EDIT_DETAILS,
  },
} as const satisfies Record<string, { seat: SeatActionKey; stage: string; permission: string }>;

export type MemberAction = keyof typeof MEMBER_ACTIONS;
export type MemberActions = Record<MemberAction, boolean>;

/** In the order a screen lists them. */
export const MEMBER_ACTION_KEYS: readonly MemberAction[] = ['add_member', 'remove_member', 'change_member_seat', 'request_change'];

/**
 * Q-A (lane B, 17 Nov) — a SEAT never grants this on the actor's own membership
 * row: a Secretary must not move themselves into the Chairman seat. Their role
 * still may. Removing oneself is not here: leaving is not an escalation.
 */
export const SEAT_NEVER_ON_OWN_ROW: readonly MemberAction[] = ['change_member_seat'];

type Client = Pick<PrismaService, 'committeeMember' | 'committeeSeatAction'>;

interface Verdict {
  actions: MemberActions;
  /** Which actions the SEAT granted (the role did not): Q-A asks. */
  bySeat: Set<MemberAction>;
  /** The viewer's active seat, null for none, undefined when it never had to be read. */
  seat: string | null | undefined;
}

/**
 * THE RULE, for one viewer on one committee:
 *
 *   allowed = (the permission AND (committees:view OR an active seat))   — the role
 *          OR (an active seat AND that seat allows the action HERE)      — the seat
 *
 * Reads, in order, only while something is undecided:
 *   - committees:view plus every asked permission: no query;
 *   - the viewer's seat: one query (the membership read; pass `seat` when the
 *     caller has just read it, e.g. committeeAccess(), and it costs none);
 *   - the committee's seat actions: one more, only for a member lacking a key,
 *     whatever the number of actions asked.
 */
async function decide(
  client: Client,
  organizationId: string,
  committeeId: string,
  viewer: CommitteeViewer,
  asked: readonly MemberAction[],
  knownSeat: string | null | undefined,
): Promise<Verdict> {
  const actions: MemberActions = { add_member: false, remove_member: false, change_member_seat: false, request_change: false };
  const bySeat = new Set<MemberAction>();
  const holds = (a: MemberAction) => viewer.permissions.includes(MEMBER_ACTIONS[a].permission);
  const seesAll = seesEveryCommittee(viewer.permissions);

  if (seesAll) for (const a of asked) actions[a] = holds(a);
  let undecided = asked.filter((a) => !actions[a]);
  if (undecided.length === 0) return { actions, bySeat, seat: knownSeat };

  const seat = knownSeat !== undefined ? knownSeat : await activeSeatOf(client, committeeId, viewer.id, organizationId);
  if (seat === null) return { actions, bySeat, seat };

  for (const a of undecided) actions[a] = holds(a);
  undecided = undecided.filter((a) => !actions[a]);
  if (undecided.length === 0) return { actions, bySeat, seat };

  const rows = await seatActionsFor(client, organizationId, [committeeId]);
  const allows = new Set(rows.filter((r) => r.committeeId === committeeId && r.roleValueId === seat).map((r) => r.actionKey));
  for (const a of undecided) {
    if (allows.has(MEMBER_ACTIONS[a].seat)) {
      actions[a] = true;
      bySeat.add(a);
    }
  }
  return { actions, bySeat, seat };
}

/**
 * What this viewer may do on this committee, by the one rule. `seat` is the
 * viewer's seat when the caller has already read it (CommitteeAccess.seat).
 */
export async function memberActionsFor(
  client: Client,
  organizationId: string,
  committeeId: string,
  viewer: CommitteeViewer,
  options: { actions?: readonly MemberAction[]; seat?: string | null } = {},
): Promise<MemberActions> {
  return (await decide(client, organizationId, committeeId, viewer, options.actions ?? MEMBER_ACTION_KEYS, options.seat)).actions;
}

/** The refusal a path gives, so each keeps today's wording (§17.5, Q-B). */
export interface MemberActionRefusals {
  /** Neither the role nor the seat allows it. Default: 403 "Required permission: {key}". */
  notAllowed?: (permission: string) => Error;
  /** The committee's 404 message, for a key holder who may not write here. Default "Committee not found". */
  notFoundMessage?: string;
  /**
   * After the record was read (a change request by id): every non-member without
   * committees:view gets the 404, key or not, so the answer never says whether
   * the id exists (ACC-101).
   */
  afterRecordRead?: boolean;
}

/**
 * The write's check, before its transaction (Q-C). Refusals, by who is asking:
 *   - a member or a committees:view holder whom neither the role nor the seat
 *     allows: `notAllowed` (today's 403 naming the key);
 *   - anyone else holding the key: the 404 a missing committee gets (ACC-281's
 *     precondition); without the key: `notAllowed`, which the route's gate gave
 *     first until now. Both are existence-neutral: the membership read answers
 *     the same for an invented id;
 *   - `afterRecordRead`: the 404 for anyone who is neither.
 * `targetMemberId` is the membership row the write acts on (change a seat), for
 * Q-A: a seat-only grant on the actor's own row is refused like any other.
 */
export async function assertMemberAction(
  client: Client,
  organizationId: string,
  committeeId: string,
  viewer: CommitteeViewer,
  action: MemberAction,
  options: MemberActionRefusals & { targetMemberId?: string } = {},
): Promise<void> {
  const permission = MEMBER_ACTIONS[action].permission;
  const notAllowed = () => (options.notAllowed ?? ((key: string) => new ForbiddenException(`Required permission: ${key}`)))(permission);
  const verdict = await decide(client, organizationId, committeeId, viewer, [action], undefined);

  if (verdict.actions[action]) {
    if (!(verdict.bySeat.has(action) && SEAT_NEVER_ON_OWN_ROW.includes(action) && options.targetMemberId)) return;
    const target = await client.committeeMember.findFirst({
      where: { id: options.targetMemberId, committeeId, organizationId },
      select: { userId: true },
    });
    // A missing row is the write's own 404, inside its transaction; only the actor's own row is refused here.
    if (target?.userId !== viewer.id) return;
    throw notAllowed();
  }

  const writer = seesEveryCommittee(viewer.permissions) || (verdict.seat !== undefined && verdict.seat !== null);
  if (writer) throw notAllowed();
  if (options.afterRecordRead || viewer.permissions.includes(permission)) {
    throw new NotFoundException(options.notFoundMessage ?? 'Committee not found');
  }
  throw notAllowed();
}
