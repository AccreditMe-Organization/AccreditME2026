import { IOrgUnitHeadCover, IOrgUnitHeadHolder, IOrgUnitHeadStatus } from '../../services/org-unit-head.service';

/**
 * ACC-133 — the Headship panel's six states and what each offers.
 *
 * Three independent facts give six reachable states (ACC-133's matrix, verified
 * against every endpoint's own refusals on 25 Sep):
 *
 * | # | state                                | actions                                      |
 * |---|--------------------------------------|----------------------------------------------|
 * | 1 | Vacant                               | Appoint head · Arrange cover (VACANCY)       |
 * | 2 | Vacant · covered                     | Appoint head · End cover                     |
 * | 3 | Held                                 | Appoint successor · Arrange cover · Vacate   |
 * | 4 | Held · covered                       | End cover · Appoint successor · Vacate       |
 * | 5 | Held · successor scheduled           | Start new head today · Withdraw appointment  |
 * | 6 | Held · covered · successor scheduled | Start new head today · Withdraw · End cover  |
 *
 * The first action is the primary one, except in states 5 and 6, which have
 * none: Start today and Withdraw are exceptions to a plan that finishes on its
 * own date (the drawing's matrix marks every cell of both rows "offered").
 *
 * Each action is offered only where its endpoint accepts it. Two facts are read
 * the way the endpoints read them, not the way the matrix's words suggest:
 *
 * - "Covered" is a cover in force OR one scheduled to start (`scheduledCover`).
 *   Arrange cover refuses while either exists, and End cover accepts both.
 * - End cover is offered only while the cached `actingHeadUserId` is set too,
 *   because `clearActingHead()` refuses without it. They agree in every path
 *   the app writes; where they do not, the panel offers less, never something
 *   the server refuses.
 */
export type HeadshipStateNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type HeadshipAction =
  | 'appointHead'
  | 'appointSuccessor'
  | 'startNewHeadToday'
  | 'withdrawAppointment'
  | 'vacate'
  | 'arrangeCover'
  | 'endCover';

export interface HeadshipState {
  state: HeadshipStateNumber;
  /** The substantive head in post (the outgoing one during a handover), or null. */
  head: IOrgUnitHeadHolder | null;
  /** The successor who already has head access, or null. */
  incoming: IOrgUnitHeadHolder | null;
  /** The cover in force, or the one scheduled to start. */
  cover: IOrgUnitHeadCover | null;
  coverIsScheduled: boolean;
  /** In order: the first is the primary, unless `primary` is false. */
  actions: HeadshipAction[];
  primary: boolean;
  /** Which acting reason Arrange cover would record: set by state, never chosen. */
  coverReason: 'VACANCY' | 'ABSENCE';
}

export function deriveHeadshipState(status: IOrgUnitHeadStatus): HeadshipState {
  const pendingId = status.pendingHeadUserId;
  const head = status.holders.find((h) => h.id !== pendingId) ?? null;
  const incoming = pendingId ? (status.holders.find((h) => h.id === pendingId) ?? null) : null;
  const cover = status.cover ?? status.scheduledCover ?? null;
  const covered = cover !== null;
  const successor = pendingId !== null;
  const endCover: HeadshipAction[] = covered && status.actingHeadUserId !== null ? ['endCover'] : [];

  let state: HeadshipStateNumber;
  let actions: HeadshipAction[];
  let primary = true;

  if (successor) {
    // A pending successor is what Start today and Withdraw need; nothing else
    // is accepted while one exists (Appoint, Vacate, Arrange cover all refuse).
    // No primary in 5 or 6 (the drawing's matrix marks every cell "offered").
    state = covered ? 6 : 5;
    actions = ['startNewHeadToday', 'withdrawAppointment', ...endCover];
    primary = false;
  } else if (head) {
    state = covered ? 4 : 3;
    actions = covered
      ? [...endCover, 'appointSuccessor', 'vacate']
      : ['appointSuccessor', 'arrangeCover', 'vacate'];
  } else {
    state = covered ? 2 : 1;
    actions = covered ? ['appointHead', ...endCover] : ['appointHead', 'arrangeCover'];
  }

  return {
    state,
    head,
    incoming,
    cover,
    coverIsScheduled: status.cover === null && status.scheduledCover !== null,
    actions,
    primary,
    coverReason: head ? 'ABSENCE' : 'VACANCY',
  };
}
