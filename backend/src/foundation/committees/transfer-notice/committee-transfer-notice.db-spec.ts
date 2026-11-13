/**
 * ACC-297 — the notice after a transfer, against a REAL Postgres (npm run test:db),
 * run in-process: never through the shared Redis queue.
 *
 * One organisation with two committees on two units: the person still holds a
 * seat on Quality, and their Secretary seat on Safety was removed after the
 * transfer by the transfer's admin. Safety's unit has an acting cover in force.
 * A second organisation has its own committee, chair and head, and a LEFT row
 * naming the person (a row no real write could make, here only to prove it is
 * never read).
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { NotificationService } from '../../notification/notification.service';
import type { LookupService } from '../../lookup/lookup.service';
import { CommitteeTransferNoticeService } from './committee-transfer-notice.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const SEATS = [
  { id: 'acc297-seat-chair', key: 'chairman', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
  { id: 'acc297-seat-sec', key: 'secretary', labelEn: 'Secretary', labelAr: 'أمين السر' },
  { id: 'acc297-seat-member', key: 'member', labelEn: 'Member', labelAr: 'عضو' },
];

describe('The committee notice after a transfer, against a real database (ACC-297)', () => {
  const prisma = new PrismaService();
  const lookups = { getValues: () => Promise.resolve(SEATS) } as unknown as LookupService;
  const notifications = new NotificationService(prisma, new AuditLogService(prisma), {} as Queue);
  const service = new CommitteeTransferNoticeService(prisma, lookups, notifications, {} as Queue);

  async function org(tag: string) {
    const slug = `acc297-${tag}-${randomUUID().slice(0, 8)}`;
    const id = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const unit = async (nameEn: string) => (await prisma.orgUnit.create({ data: { organizationId: id, nameEn, code: `${nameEn}-${slug}` } })).id;
    const headPosition = (await prisma.orgPosition.create({ data: { organizationId: id, nameEn: 'Head', grade: 1, isUnitHeadPosition: true } })).id;
    const user = async (name: string, extra: { primaryOrgUnitId?: string; positionId?: string; status?: 'ACTIVE' | 'INACTIVE' } = {}) =>
      (await prisma.user.create({ data: { organizationId: id, email: `${slug}-${name}@example.test`, name, status: extra.status ?? 'ACTIVE', primaryOrgUnitId: extra.primaryOrgUnitId, positionId: extra.positionId } })).id;
    const committee = async (nameEn: string, orgUnitId: string) =>
      (await prisma.committee.create({ data: { organizationId: id, nameEn, typeValueId: 'type', orgUnitId } })).id;
    const seat = (committeeId: string, userId: string, roleValueId: string, isActive = true) =>
      prisma.committeeMember.create({ data: { organizationId: id, committeeId, userId, roleValueId, isActive, leftAt: isActive ? null : new Date() } });
    return { id, unit, headPosition, user, committee, seat };
  }

  async function grantCommitteesView(organizationId: string, userId: string) {
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: 'committees', action: 'view' } },
      update: {},
      create: { module: 'committees', action: 'view' },
    });
    const role = await prisma.role.create({ data: { organizationId, nameEn: `viewer-${randomUUID().slice(0, 6)}` } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
  }

  it('tells the right people once each, with the right lines, and reads nothing from before the transfer or from another organisation', async () => {
    // ── Organisation A ──
    const a = await org('a');
    const [uQuality, uSafety, uPharmacy] = [await a.unit('Quality'), await a.unit('Safety'), await a.unit('Pharmacy')];
    const person = await a.user('person', { primaryOrgUnitId: uPharmacy });
    const admin = await a.user('admin');
    const chair = await a.user('chair'); // chair of both committees, holds committees:view
    const secretary = await a.user('secretary'); // secretary of Quality, a member: sees Quality only
    const formerSecretary = await a.user('former', { status: 'INACTIVE' }); // Safety's secretary, no longer ACTIVE
    const headQuality = await a.user('head-q', { primaryOrgUnitId: uQuality, positionId: a.headPosition });
    const headSafety = await a.user('head-s', { primaryOrgUnitId: uSafety, positionId: a.headPosition });
    const coverSafety = await a.user('cover-s');
    const quality = await a.committee('Quality Council', uQuality);
    const safety = await a.committee('Safety Committee', uSafety);
    await a.seat(quality, person, 'acc297-seat-member');
    await a.seat(quality, chair, 'acc297-seat-chair');
    await a.seat(safety, chair, 'acc297-seat-chair');
    await a.seat(quality, secretary, 'acc297-seat-sec');
    await a.seat(safety, formerSecretary, 'acc297-seat-sec');
    await grantCommitteesView(a.id, chair);
    await prisma.orgUnitHeadAssignment.create({
      data: { organizationId: a.id, orgUnitId: uSafety, userId: coverSafety, kind: 'ACTING', reason: 'ABSENCE', validFrom: new Date(Date.now() - 86_400_000), createdById: admin },
    });

    // An OLD removal, before the transfer: never told.
    const oldCommittee = await a.committee('Old Committee', uQuality);
    await a.seat(oldCommittee, chair, 'acc297-seat-chair');
    await a.seat(oldCommittee, person, 'acc297-seat-member', false);
    await prisma.committeeMembershipEvent.create({
      data: { organizationId: a.id, committeeId: oldCommittee, userId: person, roleValueId: 'acc297-seat-member', action: 'LEFT', effectiveDate: new Date(), reason: 'old', approvedBy: admin, createdAt: new Date(Date.now() - 3_600_000) },
    });

    const since = new Date();

    // After the transfer, the admin removes the Safety seat (as the wizard does).
    await a.seat(safety, person, 'acc297-seat-sec', false);
    await prisma.committeeMembershipEvent.create({
      data: { organizationId: a.id, committeeId: safety, userId: person, roleValueId: 'acc297-seat-sec', action: 'LEFT', effectiveDate: new Date(), reason: 'Transfer to Pharmacy (admin wording)', approvedBy: admin },
    });

    // ── Organisation B ──
    const b = await org('b');
    const uB = await b.unit('B unit');
    const chairB = await b.user('chair-b');
    await b.user('head-b', { primaryOrgUnitId: uB, positionId: b.headPosition });
    const committeeB = await b.committee('B Committee', uB);
    await b.seat(committeeB, chairB, 'acc297-seat-chair');
    // A LEFT row in B naming A's person, after `since`: must never be read.
    await prisma.committeeMembershipEvent.create({
      data: { organizationId: b.id, committeeId: committeeB, userId: person, roleValueId: 'acc297-seat-member', action: 'LEFT', effectiveDate: new Date(), reason: 'B', approvedBy: admin },
    });

    // ── Run, in-process ──
    const sent = await service.run({ organizationId: a.id, userId: person, actorId: admin, sinceMs: since.getTime() });

    const written = await prisma.notification.findMany({ where: { organizationId: a.id }, orderBy: { userId: 'asc' } });
    const byUser = new Map(written.map((n) => [n.userId, n]));
    expect(sent).toBe(written.length);
    // Chair (both), secretary (Quality), Quality's head, Safety's cover (instead of its head).
    expect(new Set(written.map((n) => n.userId))).toEqual(new Set([chair, secretary, headQuality, coverSafety]));
    expect(byUser.has(headSafety)).toBe(false);
    expect(byUser.has(formerSecretary)).toBe(false);
    expect(byUser.has(person)).toBe(false);
    expect(byUser.has(admin)).toBe(false);

    // The chair: committees:view, so every name, and one notice for both committees.
    const chairNotice = byUser.get(chair)!;
    expect(chairNotice.bodyEn).toContain('Quality Council: still holds Member.');
    expect(chairNotice.bodyEn).toContain('Safety Committee: was removed from Secretary as part of the transfer to Pharmacy.');
    expect(chairNotice.bodyEn).not.toContain('admin wording');
    expect(chairNotice.bodyEn).not.toContain('Old Committee'); // removed before `since`
    // The title is the whole notice (the bell shows only the title); the body is the same.
    expect(chairNotice.titleEn).toBe(chairNotice.bodyEn);
    expect(chairNotice.titleAr).toBe(chairNotice.bodyAr);
    expect(chairNotice.titleAr!.startsWith('تم نقل person إلى «Pharmacy». ')).toBe(true);
    expect(chairNotice.titleEn).toContain('Quality Council: still holds Member.');
    expect([chairNotice.objectType, chairNotice.objectId]).toEqual(['COMMITTEE', quality]);

    // The secretary: an active member of Quality only, so Quality is named and linked.
    expect(byUser.get(secretary)!.bodyEn).toContain('Quality Council: still holds Member.');
    expect(byUser.get(secretary)!.objectId).toBe(quality);

    // Safety's cover: may open neither, so "a committee" and no link.
    const coverNotice = byUser.get(coverSafety)!;
    expect(coverNotice.bodyEn).toContain('A committee: was removed from Secretary as part of the transfer to Pharmacy.');
    expect(coverNotice.bodyEn).not.toContain('Safety Committee');
    expect([coverNotice.objectType, coverNotice.objectId]).toEqual([null, null]);
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // B's committee, chair and head, and B's LEFT row naming A's person, never reach a notice;
    // and a job naming B's person under A reads nothing.
    const a = await org('ta');
    const uA = await a.unit('A unit');
    const admin = await a.user('admin');
    const since = new Date(Date.now() - 1000);

    const b = await org('tb');
    const uB = await b.unit('B unit');
    const personB = await b.user('person-b', { primaryOrgUnitId: uB });
    const chairB = await b.user('chair-b');
    await b.user('head-b', { primaryOrgUnitId: uB, positionId: b.headPosition });
    const committeeB = await b.committee('B Committee', uB);
    await b.seat(committeeB, personB, 'acc297-seat-member');
    await b.seat(committeeB, chairB, 'acc297-seat-chair');
    await prisma.committeeMembershipEvent.create({
      data: { organizationId: b.id, committeeId: committeeB, userId: personB, roleValueId: 'acc297-seat-member', action: 'LEFT', effectiveDate: new Date(), reason: 'B', approvedBy: admin },
    });
    void uA;

    // B's person, under A's organisation: nothing read, nothing sent.
    await expect(service.run({ organizationId: a.id, userId: personB, actorId: admin, sinceMs: since.getTime() })).resolves.toBe(0);
    expect(await prisma.notification.count({ where: { organizationId: { in: [a.id, b.id] } } })).toBe(0);
  });
});
