import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';
import { StageRules, StageRulesService } from '../workflow/stage-rules.service';
import { CommitteeMembershipsService, MEMBERSHIPS_ROWS } from './committee-memberships.service';

// ACC-295 — one person's committee memberships, for the Transfer wizard. The reads
// are mocked here; the filtering and the stage rules on real rows are
// committee-memberships.db-spec.ts.

const ORG_A = 'org-a';
const VIEWER = { permissions: ['committees:view', 'users:view'] };

const SEATS = [
  { id: 'seat-chair', labelEn: 'Chair', labelAr: 'الرئيس' },
  { id: 'seat-secretary', labelEn: 'Secretary', labelAr: null },
  { id: 'seat-member', labelEn: 'Member', labelAr: 'عضو' },
];

const membership = (n: number, roleValueId: string, joinedAt: string, committeeId = `c-${n}`) => ({
  id: `m-${n}`,
  roleValueId,
  joinedAt: new Date(joinedAt),
  committee: { id: committeeId, nameEn: `Committee ${n}`, nameAr: null, isActive: true },
});

const rules = (over: Partial<StageRules>): StageRules => ({
  stageId: 'stage-1',
  stageNameEn: 'Active',
  stageNameAr: 'نشطة',
  flags: [],
  actions: { remove_member: true },
  ...over,
});

describe('CommitteeMembershipsService.forUser (ACC-295)', () => {
  let prisma: { committeeMember: { findMany: jest.Mock; count: jest.Mock } };
  let lookups: { getValues: jest.Mock };
  let stageRules: { stageRulesFor: jest.Mock };
  let service: CommitteeMembershipsService;

  beforeEach(() => {
    prisma = { committeeMember: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } };
    lookups = { getValues: jest.fn().mockResolvedValue(SEATS) };
    stageRules = { stageRulesFor: jest.fn().mockResolvedValue(new Map()) };
    service = new CommitteeMembershipsService(
      prisma as unknown as PrismaService,
      lookups as unknown as LookupService,
      stageRules as unknown as StageRulesService,
    );
  });

  const noRead = () => {
    expect(prisma.committeeMember.findMany).not.toHaveBeenCalled();
    expect(prisma.committeeMember.count).not.toHaveBeenCalled();
    expect(lookups.getValues).not.toHaveBeenCalled();
    expect(stageRules.stageRulesFor).not.toHaveBeenCalled();
  };

  // ACC-295 follow-up (Ahmad, 11 Nov): whoever holds Transfer users sees everything in
  // the transfer — users:transfer opens the read on its own; otherwise committees:view
  // AND users:view. A refusal names users:transfer, the one key that opens it alone.
  describe('who may ask (ACC-101 clause a: refused before any read)', () => {
    const REFUSAL = 'Required permission: users:transfer';
    const refusal = async (permissions: string[]) => {
      const error = await service.forUser(ORG_A, { permissions }, 'user-9').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      return (error as ForbiddenException).message;
    };

    it('users:transfer alone is admitted, and reads', async () => {
      prisma.committeeMember.findMany.mockResolvedValue([membership(1, 'seat-chair', '2026-01-01T00:00:00Z')]);
      prisma.committeeMember.count.mockResolvedValue(1);
      const result = await service.forUser(ORG_A, { permissions: ['users:transfer'] }, 'user-9');
      expect(result.total).toBe(1);
      expect(result.rows.length).toBe(1);
      expect(prisma.committeeMember.findMany).toHaveBeenCalledTimes(1);
    });

    it('committees:view and users:view, without users:transfer, are still admitted', async () => {
      await expect(service.forUser(ORG_A, { permissions: ['committees:view', 'users:view'] }, 'user-9')).resolves.toEqual({
        total: 0,
        rows: [],
      });
      expect(prisma.committeeMember.findMany).toHaveBeenCalledTimes(1);
    });

    it('committees:view alone: refused naming users:transfer, and no query', async () => {
      expect(await refusal(['committees:view'])).toBe(REFUSAL);
      noRead();
    });

    it('users:view alone: refused naming users:transfer, and no query', async () => {
      expect(await refusal(['users:view'])).toBe(REFUSAL);
      noRead();
    });

    it('no permission at all: refused, and no query', async () => {
      expect(await refusal([])).toBe(REFUSAL);
      noRead();
    });
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // Every read is scoped by the CALLER's organisation, on the membership AND its
    // committee; another organisation's user simply has none: an empty answer, never a 404.
    const result = await service.forUser(ORG_A, VIEWER, 'user-of-org-b');
    expect(result).toEqual({ total: 0, rows: [] });
    const where = { organizationId: ORG_A, userId: 'user-of-org-b', isActive: true, committee: { organizationId: ORG_A, isActive: true } };
    expect(prisma.committeeMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(prisma.committeeMember.count).toHaveBeenCalledWith({ where });
    expect(lookups.getValues).toHaveBeenCalledWith('committee_member_role', ORG_A);
    expect(stageRules.stageRulesFor).not.toHaveBeenCalled();
  });

  it('leaves out inactive memberships and inactive committees: both are in the read itself', async () => {
    await service.forUser(ORG_A, VIEWER, 'user-1');
    const calls = prisma.committeeMember.findMany.mock.calls as unknown as [{ where: Record<string, unknown> }][];
    const { where } = calls[0]![0];
    expect(where['isActive']).toBe(true);
    expect(where['committee']).toEqual({ organizationId: ORG_A, isActive: true });
  });

  it('orders by seat (the tenant’s order), then longest-served, then the committee id; names each seat', async () => {
    prisma.committeeMember.findMany.mockResolvedValue([
      membership(1, 'seat-member', '2026-01-01T00:00:00Z'),
      membership(2, 'seat-chair', '2026-05-01T00:00:00Z'),
      membership(3, 'seat-secretary', '2026-02-01T00:00:00Z'),
      membership(4, 'seat-chair', '2026-03-01T00:00:00Z'),
      membership(5, 'seat-unknown', '2025-01-01T00:00:00Z'),
    ]);
    prisma.committeeMember.count.mockResolvedValue(5);

    const result = await service.forUser(ORG_A, VIEWER, 'user-1');
    expect(result.rows.map((r) => r.memberId)).toEqual(['m-4', 'm-2', 'm-3', 'm-1', 'm-5']);
    expect(result.rows[0]).toMatchObject({
      memberId: 'm-4',
      committeeId: 'c-4',
      nameEn: 'Committee 4',
      seat: { id: 'seat-chair', labelEn: 'Chair', labelAr: 'الرئيس' },
      joinedAt: new Date('2026-03-01T00:00:00Z'),
    });
    // A seat the tenant no longer has keeps its id, with null labels, and sorts last.
    expect(result.rows[4]!.seat).toEqual({ id: 'seat-unknown', labelEn: null, labelAr: null });
  });

  it('answers at most 100 rows, and total is the true count', async () => {
    prisma.committeeMember.findMany.mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => membership(i, 'seat-member', `2026-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`)),
    );
    prisma.committeeMember.count.mockResolvedValue(237);

    const result = await service.forUser(ORG_A, VIEWER, 'user-1');
    expect(result.rows.length).toBe(MEMBERSHIPS_ROWS);
    expect(MEMBERSHIPS_ROWS).toBe(100);
    expect(result.total).toBe(237);
    // The stage rules are read for the shown rows only, in ONE call.
    expect(stageRules.stageRulesFor).toHaveBeenCalledTimes(1);
    const ruleCalls = stageRules.stageRulesFor.mock.calls as unknown as [string, string, string[]][];
    expect(ruleCalls[0]![2].length).toBe(100);
  });

  it('stage and mayRemove come from ONE stageRulesFor call: false where REMOVE_MEMBER is not allowed, or with no stage', async () => {
    prisma.committeeMember.findMany.mockResolvedValue([
      membership(1, 'seat-chair', '2026-01-01T00:00:00Z', 'c-active'),
      membership(2, 'seat-chair', '2026-02-01T00:00:00Z', 'c-dissolved'),
      membership(3, 'seat-chair', '2026-03-01T00:00:00Z', 'c-no-stage'),
    ]);
    prisma.committeeMember.count.mockResolvedValue(3);
    stageRules.stageRulesFor.mockResolvedValue(
      new Map<string, StageRules>([
        ['c-active', rules({})],
        ['c-dissolved', rules({ stageNameEn: 'Dissolved', stageNameAr: 'منحلة', actions: { remove_member: false } })],
        ['c-no-stage', rules({ stageId: null, stageNameEn: null, stageNameAr: null, actions: { remove_member: false } })],
      ]),
    );

    const result = await service.forUser(ORG_A, VIEWER, 'user-1');
    expect(stageRules.stageRulesFor).toHaveBeenCalledTimes(1);
    expect(stageRules.stageRulesFor).toHaveBeenCalledWith(ORG_A, 'COMMITTEE', ['c-active', 'c-dissolved', 'c-no-stage']);
    expect(result.rows.map((r) => [r.committeeId, r.stage, r.mayRemove])).toEqual([
      ['c-active', { nameEn: 'Active', nameAr: 'نشطة' }, true],
      ['c-dissolved', { nameEn: 'Dissolved', nameAr: 'منحلة' }, false],
      ['c-no-stage', { nameEn: null, nameAr: null }, false],
    ]);
  });

  it('a committee missing from the rules map reads as no stage, and may not be removed from', async () => {
    prisma.committeeMember.findMany.mockResolvedValue([membership(1, 'seat-chair', '2026-01-01T00:00:00Z')]);
    prisma.committeeMember.count.mockResolvedValue(1);
    const result = await service.forUser(ORG_A, VIEWER, 'user-1');
    expect(result.rows[0]).toMatchObject({ stage: { nameEn: null, nameAr: null }, mayRemove: false });
  });

  it('reads in a fixed number of queries: one memberships read, one count, one seats read, one stage-rules call', async () => {
    prisma.committeeMember.findMany.mockResolvedValue([membership(1, 'seat-chair', '2026-01-01T00:00:00Z')]);
    prisma.committeeMember.count.mockResolvedValue(1);
    await service.forUser(ORG_A, VIEWER, 'user-1');
    expect(prisma.committeeMember.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.committeeMember.count).toHaveBeenCalledTimes(1);
    expect(lookups.getValues).toHaveBeenCalledTimes(1);
    expect(stageRules.stageRulesFor).toHaveBeenCalledTimes(1);
  });
});
