import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MEMBER_ACTIONS, MEMBER_ACTION_KEYS, assertMemberAction, memberActionsFor } from './member-actions';

/**
 * ACC-283 PR 6 — the rule's truth table, and what each answer costs in queries
 * (plan §17.2, §17.6). The client is a stub: the membership read answers the
 * viewer's seat, and the seat-action read answers the committee's rows.
 */
const ORG = 'org-1';
const COMMITTEE = 'c-1';
const VIEW = 'committees:view';
const KEYS = MEMBER_ACTION_KEYS.map((a) => MEMBER_ACTIONS[a].permission);

function client(seat: string | null, rows: { roleValueId: string; actionKey: string; committeeId?: string }[] = [], target?: { userId: string }) {
  const prisma = {
    committeeMember: {
      findFirst: jest.fn((args: { select: Record<string, true> }) =>
        Promise.resolve('userId' in args.select ? (target ?? null) : seat === null ? null : { roleValueId: seat }),
      ),
    },
    committeeSeatAction: {
      findMany: jest.fn(() => Promise.resolve(rows.map((r) => ({ committeeId: r.committeeId ?? COMMITTEE, ...r })))),
    },
  };
  return { prisma, typed: prisma as unknown as PrismaService };
}

const all = (value: boolean) => Object.fromEntries(MEMBER_ACTION_KEYS.map((a) => [a, value]));
const membershipReads = (p: ReturnType<typeof client>['prisma']) => p.committeeMember.findFirst.mock.calls.length;
const seatReads = (p: ReturnType<typeof client>['prisma']) => p.committeeSeatAction.findMany.mock.calls.length;

describe('memberActionsFor — the rule (ACC-283 PR 6)', () => {
  it('maps each action to its seat key, stage key and permission: the one map', () => {
    expect(MEMBER_ACTIONS.change_member_seat).toEqual({ seat: 'change_member_seat', stage: 'change_member_role', permission: 'committees:change_member_role' });
    expect(MEMBER_ACTIONS.request_change).toEqual({ seat: 'request_change', stage: 'request_change', permission: 'committees:edit_details' });
    expect(MEMBER_ACTION_KEYS).toEqual(['add_member', 'remove_member', 'change_member_seat', 'request_change']);
  });

  it('a committees:view holder with every key: all true, and NO query', async () => {
    const { prisma, typed } = client('secretary');
    expect(await memberActionsFor(typed, ORG, COMMITTEE, { id: 'u', permissions: [VIEW, ...KEYS] })).toEqual(all(true));
    expect([membershipReads(prisma), seatReads(prisma)]).toEqual([0, 0]);
  });

  it('a committees:view holder without the keys who is not a member: all false, after the one membership read', async () => {
    const { prisma, typed } = client(null);
    expect(await memberActionsFor(typed, ORG, COMMITTEE, { id: 'u', permissions: [VIEW] })).toEqual(all(false));
    expect([membershipReads(prisma), seatReads(prisma)]).toEqual([1, 0]);
  });

  it('a member holding the keys whose seat allows nothing: all true — the seat never takes away', async () => {
    const { prisma, typed } = client('member', []);
    expect(await memberActionsFor(typed, ORG, COMMITTEE, { id: 'u', permissions: KEYS })).toEqual(all(true));
    expect([membershipReads(prisma), seatReads(prisma)]).toEqual([1, 0]);
  });

  it('a member without the keys: exactly what their seat allows here, the four actions in ONE seat read', async () => {
    const { prisma, typed } = client('secretary', [
      { roleValueId: 'secretary', actionKey: 'add_member' },
      { roleValueId: 'secretary', actionKey: 'request_change' },
      { roleValueId: 'chairman', actionKey: 'remove_member' },
      { roleValueId: 'secretary', actionKey: 'decide_reporting_changes' },
    ]);
    expect(await memberActionsFor(typed, ORG, COMMITTEE, { id: 'u', permissions: [] })).toEqual({
      add_member: true,
      remove_member: false, // another seat's row
      change_member_seat: false,
      request_change: true,
    });
    expect([membershipReads(prisma), seatReads(prisma)]).toEqual([1, 1]);
    expect(prisma.committeeSeatAction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: ORG, committeeId: { in: [COMMITTEE] } } }));
  });

  it("a seat row for ANOTHER committee does not count", async () => {
    const { typed } = client('secretary', [{ roleValueId: 'secretary', actionKey: 'add_member', committeeId: 'c-other' }]);
    expect((await memberActionsFor(typed, ORG, COMMITTEE, { id: 'u', permissions: [] })).add_member).toBe(false);
  });

  it('a non-member holding the keys, without committees:view: all false (the write precondition), with no seat read', async () => {
    const { prisma, typed } = client(null);
    expect(await memberActionsFor(typed, ORG, COMMITTEE, { id: 'u', permissions: KEYS })).toEqual(all(false));
    expect([membershipReads(prisma), seatReads(prisma)]).toEqual([1, 0]);
  });

  it("a seat the caller already read is used: no membership query", async () => {
    const { prisma, typed } = client('ignored', [{ roleValueId: 'secretary', actionKey: 'add_member' }]);
    const got = await memberActionsFor(typed, ORG, COMMITTEE, { id: 'u', permissions: [] }, { actions: ['add_member'], seat: 'secretary' });
    expect(got.add_member).toBe(true);
    expect(membershipReads(prisma)).toBe(0);
  });

  it('only the asked actions are decided', async () => {
    const { typed } = client('secretary', [{ roleValueId: 'secretary', actionKey: 'add_member' }]);
    expect(await memberActionsFor(typed, ORG, COMMITTEE, { id: 'u', permissions: [] }, { actions: ['request_change'] })).toEqual(all(false));
  });
});

describe('assertMemberAction — the refusals (ACC-283 PR 6, §17.5)', () => {
  const run = (c: ReturnType<typeof client>, permissions: string[], action: Parameters<typeof assertMemberAction>[4], extra = {}) =>
    assertMemberAction(c.typed, ORG, COMMITTEE, { id: 'actor', permissions }, action, extra).then(
      () => 'OK',
      (e: unknown) => {
        if (e instanceof ForbiddenException || e instanceof NotFoundException) return `${e.getStatus()} ${e.message}`;
        throw e;
      },
    );

  it('allowed by the role or by the seat', async () => {
    expect(await run(client(null), [VIEW, 'committees:add_member'], 'add_member')).toBe('OK');
    expect(await run(client('secretary', [{ roleValueId: 'secretary', actionKey: 'add_member' }]), [], 'add_member')).toBe('OK');
  });

  it("a member or holder whom neither allows: today's 403 naming the key", async () => {
    expect(await run(client('member'), [], 'add_member')).toBe('403 Required permission: committees:add_member');
    expect(await run(client(null), [VIEW], 'remove_member')).toBe('403 Required permission: committees:remove_member');
  });

  it("a non-member: without the key today's 403, with it the committee's 404; after a record read, the 404 either way", async () => {
    expect(await run(client(null), [], 'add_member')).toBe('403 Required permission: committees:add_member');
    expect(await run(client(null), ['committees:add_member'], 'add_member')).toBe('404 Committee not found');
    expect(await run(client(null), [], 'request_change', { afterRecordRead: true, notFoundMessage: 'Change request not found' })).toBe(
      '404 Change request not found',
    );
  });

  it("a path's own refusal is used for 'not allowed'", async () => {
    const notAllowed = (key: string) => new ForbiddenException(`custom ${key}`);
    expect(await run(client('member'), [], 'request_change', { notAllowed })).toBe('403 custom committees:edit_details');
  });

  describe("Q-A — a seat never changes the actor's OWN seat", () => {
    const secretary = (targetUserId: string) => client('secretary', [{ roleValueId: 'secretary', actionKey: 'change_member_seat' }], { userId: targetUserId });

    it("a seat-only grant on the actor's own row is refused with today's 403", async () => {
      expect(await run(secretary('actor'), [], 'change_member_seat', { targetMemberId: 'm-own' })).toBe(
        '403 Required permission: committees:change_member_role',
      );
    });

    it("the same seat on someone else's row is allowed", async () => {
      expect(await run(secretary('someone-else'), [], 'change_member_seat', { targetMemberId: 'm-other' })).toBe('OK');
    });

    it("the ROLE still changes the actor's own seat, without reading the row", async () => {
      const c = secretary('actor');
      expect(await run(c, ['committees:change_member_role'], 'change_member_seat', { targetMemberId: 'm-own' })).toBe('OK');
      expect(c.prisma.committeeMember.findFirst.mock.calls.filter((call) => 'userId' in call[0].select)).toHaveLength(0);
    });

    it("removing oneself by the seat is allowed (leaving is not an escalation)", async () => {
      const c = client('secretary', [{ roleValueId: 'secretary', actionKey: 'remove_member' }], { userId: 'actor' });
      expect(await run(c, [], 'remove_member', { targetMemberId: 'm-own' })).toBe('OK');
    });
  });
});
