import { IOrgUnitHeadCover, IOrgUnitHeadStatus } from '../../services/org-unit-head.service';
import { HeadshipAction, HeadshipStateNumber, deriveHeadshipState } from './headship-state';

// ACC-133 — the six states and EXACTLY the matrix's actions, and a second,
// independent check: no state offers an action its endpoint would refuse.
//
// The refusal model below is transcribed from the endpoints themselves
// (backend/src/foundation/organization/org-unit-head.service.ts), not from the
// matrix, so the two checks cannot agree by copying each other.

const HEAD = { id: 'fahad', name: 'Dr. Fahad', positionId: 'pos-dir', positionNameEn: 'Director', positionNameAr: null, headSince: null };
const INCOMING = { id: 'huda', name: 'Dr. Huda', positionId: 'pos-dir', positionNameEn: 'Director', positionNameAr: null, headSince: null };
const COVER: IOrgUnitHeadCover = { userId: 'tariq', name: 'Dr. Tariq', reason: 'ABSENCE', validFrom: '2026-10-01T00:00:00.000Z', validTo: null };

function status(over: Partial<IOrgUnitHeadStatus> = {}): IOrgUnitHeadStatus {
  return {
    holders: [],
    pendingHeadUserId: null,
    headHandoverEffectiveDate: null,
    actingHeadUserId: null,
    lastVacancy: null,
    pendingHeadAccessSince: null,
    cover: null,
    scheduledCover: null,
    recentlyEndedCovers: [],
    ...over,
  };
}

const held = { holders: [HEAD] };
const covered = (reason: 'VACANCY' | 'ABSENCE') => ({ cover: { ...COVER, reason }, actingHeadUserId: COVER.userId });
const successor = {
  holders: [HEAD, INCOMING],
  pendingHeadUserId: INCOMING.id,
  headHandoverEffectiveDate: '2026-11-01T00:00:00.000Z',
};

/** What each endpoint refuses, as the service code reads the unit. */
function refuses(action: HeadshipAction, s: IOrgUnitHeadStatus): boolean {
  const pending = s.pendingHeadUserId !== null;
  // The outgoing (or only) holder: every holder who is not the pending successor.
  const substantive = s.holders.some((h) => h.id !== s.pendingHeadUserId);
  // assignActingHead()'s overlap read: any un-ended cover reaching past now.
  const openCover = s.cover !== null || s.scheduledCover !== null;
  switch (action) {
    case 'appointHead': // assignHead(): pending refused; validatePositionAssignment() refuses a second head
      return pending || substantive;
    case 'vacate': // vacateHead(): pending refused; no holder refused
      return pending || !substantive;
    case 'appointSuccessor': // declareHandover(): pending refused; no outgoing holder refused
      return pending || !substantive;
    case 'startNewHeadToday': // completeHandoverNow(): needs a pending successor
    case 'withdrawAppointment': // cancelHandover(): needs a pending successor
      return !pending;
    case 'arrangeCover': // assignActingHead(): pending refused; an open cover refused
      return pending || openCover;
    case 'endCover': // clearActingHead(): refuses when the cached actingHeadUserId is null
      return s.actingHeadUserId === null;
  }
}

describe('deriveHeadshipState — the six states (ACC-133)', () => {
  const cases: { name: string; s: IOrgUnitHeadStatus; state: HeadshipStateNumber; actions: HeadshipAction[]; primary: boolean }[] = [
    { name: '1 · Vacant', s: status(), state: 1, actions: ['appointHead', 'arrangeCover'], primary: true },
    { name: '2 · Vacant · covered', s: status(covered('VACANCY')), state: 2, actions: ['appointHead', 'endCover'], primary: true },
    { name: '3 · Held', s: status(held), state: 3, actions: ['appointSuccessor', 'arrangeCover', 'vacate'], primary: true },
    { name: '4 · Held · covered', s: status({ ...held, ...covered('ABSENCE') }), state: 4, actions: ['endCover', 'appointSuccessor', 'vacate'], primary: true },
    { name: '5 · Held · successor scheduled', s: status(successor), state: 5, actions: ['startNewHeadToday', 'withdrawAppointment'], primary: false },
    {
      name: '6 · Held · covered · successor scheduled',
      s: status({ ...successor, ...covered('ABSENCE') }),
      state: 6,
      actions: ['startNewHeadToday', 'withdrawAppointment', 'endCover'],
      primary: false,
    },
  ];

  for (const c of cases) {
    it(`${c.name}: exactly the matrix's actions, in order`, () => {
      const v = deriveHeadshipState(c.s);
      expect(v.state).toBe(c.state);
      expect(v.actions).toEqual(c.actions);
      expect(v.primary).toBe(c.primary);
    });

    it(`${c.name}: offers no action its endpoint would refuse`, () => {
      for (const action of deriveHeadshipState(c.s).actions) {
        expect(refuses(action, c.s)).withContext(`${c.name} offers ${action}`).toBeFalse();
      }
    });
  }

  it('state 5 has no primary button (both its actions are exceptions)', () => {
    expect(deriveHeadshipState(status(successor)).primary).toBeFalse();
  });

  it('the cover reason is set by whether a head is in post, never chosen', () => {
    expect(deriveHeadshipState(status()).coverReason).toBe('VACANCY');
    expect(deriveHeadshipState(status(held)).coverReason).toBe('ABSENCE');
  });

  it('a cover scheduled to start later counts as covered: Arrange cover is not offered', () => {
    const scheduled = status({ scheduledCover: { ...COVER, validFrom: '2026-12-01T00:00:00.000Z' }, actingHeadUserId: COVER.userId });
    const v = deriveHeadshipState(scheduled);
    expect(v.state).toBe(2);
    expect(v.coverIsScheduled).toBeTrue();
    expect(v.actions).not.toContain('arrangeCover');
    expect(v.actions).toContain('endCover');
  });

  it('End cover is not offered when the cached column the endpoint reads is empty', () => {
    const v = deriveHeadshipState(status({ ...held, cover: COVER, actingHeadUserId: null }));
    expect(v.actions).not.toContain('endCover');
    expect(v.actions).not.toContain('arrangeCover'); // the open period still refuses a new one
  });

  it('the running cover is read from `cover`, never from the cached column alone', () => {
    // The cache says someone covers; no period is in force (it lapsed on its date).
    const v = deriveHeadshipState(status({ ...held, actingHeadUserId: 'tariq' }));
    expect(v.state).toBe(3);
    expect(v.cover).toBeNull();
  });

  it('across every combination of the three facts, nothing offered is refused', () => {
    for (const isHeld of [false, true]) {
      for (const cover of ['none', 'running', 'scheduled'] as const) {
        for (const pending of [false, true]) {
          for (const cache of [false, true]) {
            if (pending && !isHeld) continue; // declareHandover() needs a head
            const s = status({
              holders: pending ? [HEAD, INCOMING] : isHeld ? [HEAD] : [],
              pendingHeadUserId: pending ? INCOMING.id : null,
              cover: cover === 'running' ? COVER : null,
              scheduledCover: cover === 'scheduled' ? COVER : null,
              actingHeadUserId: cache ? COVER.userId : null,
            });
            for (const action of deriveHeadshipState(s).actions) {
              expect(refuses(action, s)).withContext(`held=${isHeld} cover=${cover} pending=${pending} cache=${cache}: ${action}`).toBeFalse();
            }
          }
        }
      }
    }
  });
});
