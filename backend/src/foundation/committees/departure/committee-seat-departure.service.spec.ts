import { Logger } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { LookupService } from '../../lookup/lookup.service';
import type { NotificationService } from '../../notification/notification.service';
import { itEnforcesTenantIsolation } from '../../../common/testing/tenant-isolation';
import { CommitteeSeatDepartureService, SEAT_DEPARTURE_POLICY, type PreparedSeatDeparture } from './committee-seat-departure.service';
import { departureNoticeText } from './committee-seat-departure-notice';

// ACC-306 — the seat departure's own rules, with the database mocked. The real
// database proofs (what ends, never blocked, the races, the lock order, the
// rollback) are in committee-seat-departure.db-spec.ts.

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

type Sql = { sql: string; values: unknown[] };

/** A tagged $queryRaw call, rebuilt as the statement Prisma sends (nested fragments flattened). */
function statement(call: unknown[]): Sql {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(strings, ...values) as unknown as Sql;
}

function build() {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    committeeMember: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn(), count: jest.fn() },
    committeeMembershipEvent: { createMany: jest.fn() },
    auditLog: { createMany: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    orgUnitHeadAssignment: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const lookups = { getValues: jest.fn().mockResolvedValue([]) };
  const notifications = { createInAppMany: jest.fn().mockResolvedValue(0) };
  const service = new CommitteeSeatDepartureService(
    prisma as unknown as PrismaService,
    lookups as unknown as LookupService,
    notifications as unknown as NotificationService,
  );
  return { prisma, lookups, notifications, service };
}

const seat = (memberId: string, committeeId: string) => ({
  memberId,
  committeeId,
  roleValueId: 'member',
  committee: { nameEn: `Committee ${committeeId}`, nameAr: null },
  orgUnitId: 'unit-1',
});

/** A membership row as endSeatsInTx() reads it under the locks. */
const row = (id: string, committeeId: string) => ({
  id,
  committeeId,
  roleValueId: 'member',
  committee: { nameEn: `Committee ${committeeId}`, nameAr: null, orgUnitId: 'unit-1' },
});

const prepared = (seats: ReturnType<typeof seat>[], keptCommitteeIds: string[] = []): PreparedSeatDeparture => ({
  organizationId: ORG,
  leaverId: 'leaver',
  actorId: 'admin',
  seats,
  keptCommitteeIds,
  applied: [],
});

describe('CommitteeSeatDepartureService (ACC-306)', () => {
  it('starts from the plan’s recommendations: end the seats, keep Dissolved rosters, tell the officers', () => {
    expect(SEAT_DEPARTURE_POLICY).toEqual({ endSeats: true, keepDissolvedRosters: true, tellOfficers: true });
  });

  describe('prepare()', () => {
    it('reads the leaver’s seats in ONE query, and keeps a Dissolved roster apart', async () => {
      const { prisma, service } = build();
      prisma.$queryRaw.mockResolvedValue([
        { ...seat('m1', 'c1'), dissolved: false },
        { ...seat('m2', 'c-dissolved'), dissolved: true },
      ]);
      const p = await service.prepare(ORG, 'leaver', 'admin');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(p.seats).toEqual([seat('m1', 'c1')]);
      expect(p.keptCommitteeIds).toEqual(['c-dissolved']);
      expect(p.applied).toEqual([]);
    });

    itEnforcesTenantIsolation('ACC-306 — prepare() reads only the leaver’s seats in their own organisation', async () => {
      const { prisma, service } = build();
      await service.prepare(ORG, 'leaver', 'admin');
      const query = statement(prisma.$queryRaw.mock.calls[0]!);
      expect(query.values).toEqual(expect.arrayContaining([ORG, 'leaver']));
      expect(query.values).not.toContain(OTHER_ORG);
      // Every organisation reference in the query is bound to the caller's organisation.
      expect(query.values.filter((v) => v === ORG).length).toBeGreaterThanOrEqual(3);
    });

    it('reads nothing when the policy does not end seats', async () => {
      const { prisma, service } = build();
      service.policy = { ...SEAT_DEPARTURE_POLICY, endSeats: false };
      expect((await service.prepare(ORG, 'leaver', 'admin')).seats).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('keeps no roster when the policy says so: a Dissolved committee’s seat ends too', async () => {
      const { prisma, service } = build();
      service.policy = { ...SEAT_DEPARTURE_POLICY, keepDissolvedRosters: false };
      prisma.$queryRaw.mockResolvedValue([{ ...seat('m2', 'c-dissolved'), dissolved: true }]);
      const p = await service.prepare(ORG, 'leaver', 'admin');
      expect(p.seats).toEqual([seat('m2', 'c-dissolved')]);
      expect(p.keptCommitteeIds).toEqual([]);
    });
  });

  describe('endSeatsInTx()', () => {
    it('re-reads the leaver’s seats on active committees, scoped by organisation, and locks nothing when there are none', async () => {
      const { prisma, service } = build();
      await service.endSeatsInTx(prisma as never, prepared([]));
      expect(prisma.committeeMember.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG, userId: 'leaver', isActive: true, committee: { organizationId: ORG, isActive: true } },
        select: { committeeId: true },
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.committeeMember.updateMany).not.toHaveBeenCalled();
    });

    it('locks every committee involved — prepared, or added since — in ONE sorted statement, before reading the seats to end', async () => {
      const { prisma, service } = build();
      const order: string[] = [];
      prisma.committeeMember.findMany
        .mockImplementationOnce(async () => (order.push('current'), [{ committeeId: 'c-new' }, { committeeId: 'c-b' }]))
        .mockImplementationOnce(async () => (order.push('under the lock'), []));
      prisma.$queryRaw.mockImplementation(async () => (order.push('lock'), []));
      await service.endSeatsInTx(prisma as never, prepared([seat('m2', 'c-b'), seat('m1', 'c-a')]));
      expect(order).toEqual(['current', 'lock']);
      const lock = statement(prisma.$queryRaw.mock.calls[0]!);
      expect(lock.sql).toContain('FOR UPDATE');
      expect(lock.values).toEqual(['c-a', 'c-b', 'c-new', ORG]);
    });

    it('never locks or ends a kept (Dissolved) roster, even for a seat added since prepare()', async () => {
      const { prisma, service } = build();
      prisma.committeeMember.findMany.mockResolvedValueOnce([{ committeeId: 'c-dissolved' }]);
      await service.endSeatsInTx(prisma as never, prepared([], ['c-dissolved']));
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.committeeMember.updateMany).not.toHaveBeenCalled();
    });

    it('skips a committee that is inactive under the lock', async () => {
      const { prisma, service } = build();
      prisma.committeeMember.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([row('m2', 'c-live')]);
      prisma.$queryRaw.mockResolvedValue([
        { id: 'c-closed', isActive: false },
        { id: 'c-live', isActive: true },
      ]);
      await service.endSeatsInTx(prisma as never, prepared([seat('m1', 'c-closed'), seat('m2', 'c-live')]));
      expect(prisma.committeeMember.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { organizationId: ORG, userId: 'leaver', isActive: true, committeeId: { in: ['c-live'] } } }),
      );
    });

    it('ends the seats read under the locks: one LEFT event and one audit row each, batched', async () => {
      const { prisma, service } = build();
      prisma.committeeMember.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([row('m2', 'c2')]);
      prisma.$queryRaw.mockResolvedValue([{ id: 'c2', isActive: true }]);
      const p = prepared([seat('m2', 'c2')]);
      await service.endSeatsInTx(prisma as never, p);

      const [update] = prisma.committeeMember.updateMany.mock.calls[0] as [{ where: unknown; data: { leftAt: Date; isActive: boolean } }];
      expect(update.where).toEqual({ id: { in: ['m2'] }, organizationId: ORG, isActive: true });
      expect(update.data.isActive).toBe(false);
      const [events] = prisma.committeeMembershipEvent.createMany.mock.calls[0] as [{ data: Record<string, unknown>[] }];
      expect(events.data).toEqual([
        expect.objectContaining({
          organizationId: ORG,
          committeeId: 'c2',
          userId: 'leaver',
          action: 'LEFT',
          cause: 'DEACTIVATION',
          reason: null,
          approvedBy: 'admin',
          effectiveDate: update.data.leftAt,
        }),
      ]);
      const [audits] = prisma.auditLog.createMany.mock.calls[0] as [{ data: Record<string, unknown>[] }];
      expect(audits.data).toEqual([
        {
          organizationId: ORG,
          actorId: 'admin',
          action: 'UPDATE',
          objectType: 'CommitteeMember',
          objectId: 'm2',
          before: { isActive: true, leftAt: null },
          after: { isActive: false, leftAt: update.data.leftAt.toISOString() },
          metadata: { cause: 'DEACTIVATION', userId: 'leaver', committeeId: 'c2' },
        },
      ]);
      expect(p.applied.map((s) => [s.memberId, s.committee.nameEn, s.orgUnitId])).toEqual([['m2', 'Committee c2', 'unit-1']]);
    });

    it('writes nothing when every seat was removed meanwhile', async () => {
      const { prisma, service } = build();
      prisma.$queryRaw.mockResolvedValue([{ id: 'c1', isActive: true }]);
      await service.endSeatsInTx(prisma as never, prepared([seat('m1', 'c1')]));
      expect(prisma.committeeMember.updateMany).not.toHaveBeenCalled();
      expect(prisma.committeeMembershipEvent.createMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.createMany).not.toHaveBeenCalled();
    });

    it('does nothing at all when the policy does not end seats', async () => {
      const { prisma, service } = build();
      service.policy = { ...SEAT_DEPARTURE_POLICY, endSeats: false };
      await service.endSeatsInTx(prisma as never, prepared([seat('m1', 'c1')]));
      expect(prisma.committeeMember.findMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('finish()', () => {
    const applied = (): PreparedSeatDeparture => ({ ...prepared([seat('m1', 'c1')]), applied: [{ ...seat('m1', 'c1'), leftAt: new Date() }] });

    it('writes no audit row: those are written inside the transaction', async () => {
      const { prisma, service } = build();
      await service.finish(applied());
      expect(prisma.auditLog.createMany).not.toHaveBeenCalled();
    });

    it('never throws, and logs the failure by kind with ids only', async () => {
      const { lookups, service } = build();
      lookups.getValues.mockRejectedValue(new Error('secret detail from the database'));
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      await expect(service.finish(applied())).resolves.toBeUndefined();
      const logged = String(error.mock.calls[0]?.[0]);
      expect(logged).toContain(ORG);
      expect(logged).toContain('leaver');
      expect(logged).not.toContain('secret detail');
      error.mockRestore();
    });

    it('tells nobody when the policy says so, and does nothing when no seat ended', async () => {
      const { notifications, lookups, service } = build();
      service.policy = { ...SEAT_DEPARTURE_POLICY, tellOfficers: false };
      await service.finish(applied());
      expect(lookups.getValues).not.toHaveBeenCalled();
      expect(notifications.createInAppMany).not.toHaveBeenCalled();
      service.policy = { ...SEAT_DEPARTURE_POLICY };
      await service.finish(prepared([seat('m1', 'c1')]));
      expect(notifications.createInAppMany).not.toHaveBeenCalled();
    });
  });
});

describe('departureNoticeText (ACC-306)', () => {
  const committee = { nameEn: 'Quality Council', nameAr: 'مجلس الجودة' };
  const chair = { nameEn: 'Chairman', nameAr: 'رئيس اللجنة' };

  it('names the person, each committee and seat, in both languages; the title is the whole notice', () => {
    const t = departureNoticeText({ personName: 'Nora', lines: [{ committee, seat: chair }] });
    expect(t.titleEn).toBe(
      "Nora's account was deactivated, so their committee seats ended. Quality Council: the Chairman seat ended. " +
        'Anyone with "Add members to a committee" can fill a seat.',
    );
    expect(t.titleAr).toBe(
      'أُلغي تفعيل حساب «Nora»، فانتهت العضوية في اللجان. «مجلس الجودة»: انتهت العضوية بصفة «رئيس اللجنة». ' +
        'تتيح صلاحية «إضافة أعضاء إلى اللجنة» شغل المقعد.',
    );
    expect([t.bodyEn, t.bodyAr]).toEqual([t.titleEn, t.titleAr]);
  });

  it('says "a committee" to a reader who may not open it, and "a seat" when the seat is unknown', () => {
    const t = departureNoticeText({ personName: 'Nora', lines: [{ committee: null, seat: null }] });
    expect(t.titleEn).toContain('A committee: a seat ended.');
    expect(t.titleAr).toContain('لجنة: انتهت العضوية بصفة مقعد.');
    expect(t.titleEn).not.toContain('Quality Council');
  });
});
