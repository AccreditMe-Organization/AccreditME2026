import { Logger } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuditLogService } from '../../../common/services/audit-log.service';
import type { LookupService } from '../../lookup/lookup.service';
import type { NotificationService } from '../../notification/notification.service';
import { itEnforcesTenantIsolation } from '../../../common/testing/tenant-isolation';
import { CommitteeSeatDepartureService, SEAT_DEPARTURE_POLICY, type PreparedSeatDeparture } from './committee-seat-departure.service';
import { departureNoticeText } from './committee-seat-departure-notice';

// ACC-306 — the seat departure's own rules, with the database mocked. The real
// database proofs (what ends, never blocked, the race, the lock order) are in
// committee-seat-departure.db-spec.ts.

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
    user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
    orgUnitHeadAssignment: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const lookups = { getValues: jest.fn().mockResolvedValue([]) };
  const notifications = { createInAppMany: jest.fn().mockResolvedValue(0) };
  const service = new CommitteeSeatDepartureService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogService,
    lookups as unknown as LookupService,
    notifications as unknown as NotificationService,
  );
  return { prisma, audit, lookups, notifications, service };
}

const seat = (memberId: string, committeeId: string) => ({
  memberId,
  committeeId,
  roleValueId: 'member',
  committee: { nameEn: `Committee ${committeeId}`, nameAr: null },
  orgUnitId: 'unit-1',
});

const prepared = (seats: ReturnType<typeof seat>[]): PreparedSeatDeparture => ({
  organizationId: ORG,
  leaverId: 'leaver',
  actorId: 'admin',
  seats,
  applied: [],
});

describe('CommitteeSeatDepartureService (ACC-306)', () => {
  it('starts from the plan’s recommendations: end the seats, keep Dissolved rosters, tell the officers', () => {
    expect(SEAT_DEPARTURE_POLICY).toEqual({ endSeats: true, keepDissolvedRosters: true, tellOfficers: true });
  });

  describe('prepare()', () => {
    it('reads the leaver’s seats in ONE query', async () => {
      const { prisma, service } = build();
      prisma.$queryRaw.mockResolvedValue([seat('m1', 'c1')]);
      const p = await service.prepare(ORG, 'leaver', 'admin');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(p.seats).toEqual([seat('m1', 'c1')]);
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

    it('keeps Dissolved rosters only while the policy says so', async () => {
      const { prisma, service } = build();
      await service.prepare(ORG, 'leaver', 'admin');
      expect(statement(prisma.$queryRaw.mock.calls[0]!).sql).toContain('AND NOT (COALESCE(st."isFinal"');
      prisma.$queryRaw.mockClear();
      service.policy = { ...SEAT_DEPARTURE_POLICY, keepDissolvedRosters: false };
      await service.prepare(ORG, 'leaver', 'admin');
      expect(statement(prisma.$queryRaw.mock.calls[0]!).sql).not.toContain('AND NOT (COALESCE(st."isFinal"');
    });
  });

  describe('endSeatsInTx()', () => {
    it('does nothing for a leaver with no seat', async () => {
      const { prisma, service } = build();
      await service.endSeatsInTx(prisma as never, prepared([]));
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.committeeMember.updateMany).not.toHaveBeenCalled();
    });

    it('locks the committees’ rows in ONE statement, in id order, before reading the seats again', async () => {
      const { prisma, service } = build();
      const order: string[] = [];
      prisma.$queryRaw.mockImplementation(async () => (order.push('lock'), []));
      prisma.committeeMember.findMany.mockImplementation(async () => (order.push('re-read'), [{ id: 'm2' }]));
      await service.endSeatsInTx(prisma as never, prepared([seat('m2', 'c-b'), seat('m1', 'c-a'), seat('m3', 'c-b')]));
      expect(order.slice(0, 2)).toEqual(['lock', 're-read']);
      const lock = statement(prisma.$queryRaw.mock.calls[0]!);
      expect(lock.sql).toContain('FOR UPDATE');
      expect(lock.values).toEqual(['c-a', 'c-b', ORG]);
    });

    it('ends only the seats still active, with one LEFT event each, cause DEACTIVATION', async () => {
      const { prisma, service } = build();
      // m1 was removed by hand between prepare() and the lock.
      prisma.committeeMember.findMany.mockResolvedValue([{ id: 'm2' }]);
      const p = prepared([seat('m1', 'c1'), seat('m2', 'c2')]);
      await service.endSeatsInTx(prisma as never, p);

      expect(prisma.committeeMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['m1', 'm2'] }, organizationId: ORG, userId: 'leaver', isActive: true } }),
      );
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
      expect(p.applied.map((s) => s.memberId)).toEqual(['m2']);
    });

    it('writes nothing when every seat was removed meanwhile', async () => {
      const { prisma, service } = build();
      prisma.committeeMember.findMany.mockResolvedValue([]);
      await service.endSeatsInTx(prisma as never, prepared([seat('m1', 'c1')]));
      expect(prisma.committeeMember.updateMany).not.toHaveBeenCalled();
      expect(prisma.committeeMembershipEvent.createMany).not.toHaveBeenCalled();
    });
  });

  describe('finish()', () => {
    const applied = (): PreparedSeatDeparture => ({ ...prepared([seat('m1', 'c1')]), applied: [{ ...seat('m1', 'c1'), leftAt: new Date() }] });

    it('writes an audit row per ended seat', async () => {
      const { audit, service } = build();
      service.policy = { ...SEAT_DEPARTURE_POLICY, tellOfficers: false };
      await service.finish(applied());
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: ORG,
          actorId: 'admin',
          objectType: 'CommitteeMember',
          objectId: 'm1',
          metadata: { cause: 'DEACTIVATION', userId: 'leaver', committeeId: 'c1' },
        }),
      );
    });

    it('never throws, and logs the failure by kind with ids only', async () => {
      const { audit, service } = build();
      audit.log.mockRejectedValue(new Error('secret detail from the database'));
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
