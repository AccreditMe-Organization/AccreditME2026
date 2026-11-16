import { ChainFacts, ChainRequest, walkChain } from './change-request-chain';

// ACC-283 PR 2 — the chain's walk, one rule per test, over hand-made facts. The
// loader is proved on real rows in change-request-chain.db-spec.ts.
//
//   ROOT ── DEPT ── WARD          committee C owned by WARD, reporting to P
//        └─ SIB

type Over = Partial<{
  heads: Record<string, string[]>;
  members: string[];
  inForce: boolean;
  seatHolders: string[];
  reportsTo: string | null;
  owner: string;
  inactive: string[];
}>;

function facts(over: Over = {}): ChainFacts {
  const inactive = new Set(over.inactive ?? []);
  const unit = (parentId: string | null, id: string) => ({ parentId, isActive: !inactive.has(id) });
  return {
    committees: new Map([['C', { orgUnitId: over.owner ?? 'WARD', reportingToCommitteeId: over.reportsTo === undefined ? 'P' : over.reportsTo }]]),
    members: new Map([['C', new Set(over.members ?? [])]]),
    inForce: new Set(over.inForce === false ? [] : ['P']),
    decidingSeats: new Map([['P', ['seat-chair']]]),
    seatHolders: new Map([['P', over.seatHolders ?? []]]),
    units: new Map([
      ['ROOT', unit(null, 'ROOT')],
      ['DEPT', unit('ROOT', 'DEPT')],
      ['WARD', unit('DEPT', 'WARD')],
      ['SIB', unit('ROOT', 'SIB')],
    ]),
    heads: new Map(Object.entries(over.heads ?? { ROOT: ['rootHead'], DEPT: ['deptHead'], WARD: ['wardHead'] })),
  };
}

const request = (requesterId = 'R'): ChainRequest => ({ id: 'cr-1', committeeId: 'C', requesterId });

describe('the chain of authority — the walk (ACC-283 PR 2)', () => {
  it("the Reports-to committee's deciding seat decides first", () => {
    const r = walkChain(request(), facts({ seatHolders: ['chair'] }));
    expect(r.step).toEqual({ kind: 'REPORTS_TO_SEAT', committeeId: 'P', seatIds: ['seat-chair'] });
    expect(r.deciderIds).toEqual(['chair']);
  });

  it('the seat vacant: the owning unit decides', () => {
    const r = walkChain(request(), facts({ seatHolders: [] }));
    expect(r.step).toEqual({ kind: 'UNIT_HEAD', unitId: 'WARD', isRoot: false });
    expect(r.deciderIds).toEqual(['wardHead']);
  });

  it('no Reports-to: the owning unit decides', () => {
    expect(walkChain(request(), facts({ reportsTo: null, seatHolders: ['chair'] })).deciderIds).toEqual(['wardHead']);
  });

  it('a Reports-to committee NOT in force is skipped, even with a seat holder', () => {
    const r = walkChain(request(), facts({ inForce: false, seatHolders: ['chair'] }));
    expect(r.step).toEqual({ kind: 'UNIT_HEAD', unitId: 'WARD', isRoot: false });
  });

  it('the owning unit vacant: its parent decides', () => {
    const r = walkChain(request(), facts({ heads: { ROOT: ['rootHead'], DEPT: ['deptHead'] } }));
    expect(r.step).toEqual({ kind: 'UNIT_HEAD', unitId: 'DEPT', isRoot: false });
  });

  it('an inactive unit is skipped like a vacant one', () => {
    expect(walkChain(request(), facts({ inactive: ['WARD'] })).deciderIds).toEqual(['deptHead']);
  });

  it('a cover in force counts as the head (the facts carry it beside the holders)', () => {
    expect(walkChain(request(), facts({ heads: { ROOT: ['rootHead'], WARD: ['cover'] } })).deciderIds).toEqual(['cover']);
  });

  it('the requester is skipped at every step', () => {
    expect(walkChain(request('chair'), facts({ seatHolders: ['chair'] })).deciderIds).toEqual(['wardHead']);
    expect(walkChain(request('wardHead'), facts()).deciderIds).toEqual(['deptHead']);
  });

  it('a member of the committee is skipped below the root, at the seat and at a unit', () => {
    const r = walkChain(request(), facts({ seatHolders: ['chair'], members: ['chair', 'wardHead', 'deptHead'] }));
    expect(r.step).toEqual({ kind: 'UNIT_HEAD', unitId: 'ROOT', isRoot: true });
    expect(r.deciderIds).toEqual(['rootHead']);
  });

  it('...but NOT at the root: a member who heads the root still decides', () => {
    const r = walkChain(request(), facts({ heads: { ROOT: ['rootHead'] }, members: ['rootHead'] }));
    expect(r.step).toEqual({ kind: 'UNIT_HEAD', unitId: 'ROOT', isRoot: true });
    expect(r.deciderIds).toEqual(['rootHead']);
  });

  it('the root head alone: nobody but them, NONE, and requesterHeadsRoot (Approve now only)', () => {
    const r = walkChain(request('rootHead'), facts({ heads: { ROOT: ['rootHead'] } }));
    expect(r).toEqual({ step: { kind: 'NONE' }, deciderIds: [], requesterHeadsRoot: true });
  });

  it('the root head with a second root head: the second decides, and requesterHeadsRoot still says so', () => {
    const r = walkChain(request('rootHead'), facts({ heads: { ROOT: ['rootHead', 'successor'] } }));
    expect(r.deciderIds).toEqual(['successor']);
    expect(r.requesterHeadsRoot).toBe(true);
  });

  it("the root head's request on a sub-unit's committee: the sub-unit's head decides (the chain as written, Q4)", () => {
    expect(walkChain(request('rootHead'), facts()).deciderIds).toEqual(['wardHead']);
  });

  it('a root that is already headless: NONE, and the requester does not head it', () => {
    expect(walkChain(request(), facts({ heads: {} }))).toEqual({ step: { kind: 'NONE' }, deciderIds: [], requesterHeadsRoot: false });
  });

  it('a committee that was not found: NONE', () => {
    expect(walkChain({ id: 'cr-1', committeeId: 'missing', requesterId: 'R' }, facts()).step).toEqual({ kind: 'NONE' });
  });

  it('a loop in the unit data ends the walk', () => {
    const f = facts({ heads: {} });
    f.units.set('ROOT', { parentId: 'WARD', isActive: true });
    expect(walkChain(request(), f)).toEqual({ step: { kind: 'NONE' }, deciderIds: [], requesterHeadsRoot: false });
  });
});
