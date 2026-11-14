import { assertTransitionPreconditions, goesLive, hasTransitionPrecondition, TransitionPreconditionContext } from './transition-preconditions';

// ACC-286 — the COMMITTEE precondition, with the database answers faked by SQL
// shape so each rule is pinned on its own. The real reads, the transaction and
// the races are in committees/committee-going-live.db-spec.ts.

const ORG = 'org-a';
const CHAIRMAN = { id: 'seat-chair', key: 'chairman', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' };
const SECRETARY = { id: 'seat-sec', key: 'secretary', labelEn: 'Secretary', labelAr: 'أمين السر' };

interface World {
  quorumCount: number;
  members: number;
  required: (typeof CHAIRMAN)[];
  filled: string[]; // seat ids an ACTIVE member holds
}

function client(world: World) {
  const $queryRaw = jest.fn((strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('"quorumCount"')) return Promise.resolve([{ quorumCount: world.quorumCount }]);
    if (sql.includes('COUNT(*)')) return Promise.resolve([{ n: world.members }]);
    if (sql.includes('"LookupCategory"')) return Promise.resolve(world.required);
    if (sql.includes('"CommitteeMember"')) return Promise.resolve(world.filled.map((roleValueId, i) => ({ memberId: `m${i}`, userId: `u${i}`, roleValueId })));
    throw new Error(`unexpected query: ${sql}`);
  });
  return { $queryRaw } as unknown as Parameters<typeof assertTransitionPreconditions>[0] & { $queryRaw: jest.Mock };
}

const ctx = (over: Partial<TransitionPreconditionContext> = {}): TransitionPreconditionContext => ({
  objectId: 'committee-1',
  organizationId: ORG,
  fromStageKey: 'terms_review',
  fromStageFlags: [],
  toStageFlags: ['IN_FORCE'],
  kind: 'ADVANCE',
  ...over,
});

const code = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => 'OK',
    (e: { getResponse?: () => unknown }) => e.getResponse?.(),
  );

const FULL: World = { quorumCount: 3, members: 3, required: [CHAIRMAN, SECRETARY], filled: [CHAIRMAN.id, SECRETARY.id] };

describe('transition preconditions (ACC-286)', () => {
  describe('goesLive()', () => {
    it.each([
      [[], ['IN_FORCE'], true],
      [['DISSOLVING'], ['IN_FORCE'], true],
      [['IN_FORCE'], ['IN_FORCE'], false],
      [[], [], false],
      [['IN_FORCE'], [], false],
    ])('from %j to %j → %s', (from, to, expected) => {
      expect(goesLive({ fromStageFlags: from, toStageFlags: to })).toBe(expected);
    });
  });

  it('only COMMITTEE has a precondition', () => {
    expect(hasTransitionPrecondition('COMMITTEE')).toBe(true);
    expect(hasTransitionPrecondition('DOCUMENT')).toBe(false);
  });

  describe('a committee going live', () => {
    it('with fewer members (ACTIVE users) than the quorum: 409 naming both numbers', async () => {
      expect(await code(assertTransitionPreconditions(client({ ...FULL, members: 2 }), 'COMMITTEE', ctx()))).toMatchObject({
        statusCode: 409,
        code: 'COMMITTEE_MEMBERS_BELOW_QUORUM',
        quorum: 3,
        members: 2,
      });
    });

    it('with a required seat empty: 409 naming the empty seats, in seat order', async () => {
      expect(await code(assertTransitionPreconditions(client({ ...FULL, filled: [] }), 'COMMITTEE', ctx()))).toMatchObject({
        statusCode: 409,
        code: 'COMMITTEE_REQUIRED_SEATS_EMPTY',
        seats: [CHAIRMAN, SECRETARY].map(({ id, labelEn, labelAr }) => ({ id, labelEn, labelAr })),
      });
      expect(await code(assertTransitionPreconditions(client({ ...FULL, filled: [CHAIRMAN.id] }), 'COMMITTEE', ctx()))).toMatchObject({
        seats: [{ id: SECRETARY.id }],
      });
    });

    it('the quorum is checked before the seats', async () => {
      expect(await code(assertTransitionPreconditions(client({ ...FULL, members: 0, filled: [] }), 'COMMITTEE', ctx()))).toMatchObject({
        code: 'COMMITTEE_MEMBERS_BELOW_QUORUM',
      });
    });

    it('passes when every seat is filled and the quorum is met', async () => {
      expect(await code(assertTransitionPreconditions(client(FULL), 'COMMITTEE', ctx()))).toBe('OK');
    });

    it('is checked on a move of ANY kind into an in-force stage', async () => {
      for (const kind of ['RETURN', 'EXIT'] as const) {
        expect(await code(assertTransitionPreconditions(client({ ...FULL, filled: [] }), 'COMMITTEE', ctx({ kind })))).toMatchObject({
          code: 'COMMITTEE_REQUIRED_SEATS_EMPTY',
        });
      }
    });

    it('reads the committee FOR SHARE, scoped by organisation', async () => {
      const c = client(FULL);
      await assertTransitionPreconditions(c, 'COMMITTEE', ctx());
      const read = c.$queryRaw.mock.calls.find(([s]) => (s as TemplateStringsArray).join('?').includes('"quorumCount"'))!;
      expect((read[0] as TemplateStringsArray).join('?')).toContain('FOR SHARE');
      expect(read.slice(1)).toEqual(['committee-1', ORG]);
    });
  });

  describe('moves that are not going live', () => {
    it('between two in-force stages (Active ↔ Suspended) read nothing', async () => {
      const c = client({ ...FULL, members: 0, filled: [] });
      expect(await code(assertTransitionPreconditions(c, 'COMMITTEE', ctx({ fromStageKey: 'active', fromStageFlags: ['IN_FORCE'] })))).toBe('OK');
      expect(c.$queryRaw).not.toHaveBeenCalled();
    });

    it('Formation → Terms Review checks only the quorum is set, never members or seats', async () => {
      const formation = ctx({ fromStageKey: 'formation', toStageFlags: [] });
      expect(await code(assertTransitionPreconditions(client({ ...FULL, members: 0, filled: [] }), 'COMMITTEE', formation))).toBe('OK');
      expect(await code(assertTransitionPreconditions(client({ ...FULL, quorumCount: 0 }), 'COMMITTEE', formation))).toMatchObject({
        code: 'COMMITTEE_QUORUM_NOT_SET',
      });
    });
  });
});
