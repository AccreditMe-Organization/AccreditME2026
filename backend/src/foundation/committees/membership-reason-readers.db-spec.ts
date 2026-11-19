/**
 * ACC-301 (Ahmad, 19 Nov) — WHO READS A REMOVAL'S REASON on a committee's
 * Membership history, against a REAL Postgres (npm run test:db).
 *
 * The reason goes to: a committees:view holder; this committee's ACTIVE Chairman
 * or Secretary (seats found by their lookup KEYS); and a head whose oversight
 * covers the committee (the existing oversight clause). Any other reader of the
 * history (its other members) gets the row with `reason: null` and
 * `reasonWithheld: true`. Another organisation's reason never reaches anyone.
 *
 * The read is CommitteeListsService.membershipEvents(), the route's own service,
 * with the real LookupService (the seeded committee_member_role values). Same
 * guards as the other db-specs: it FAILS, never skips, without a database, and
 * refuses any database not on this machine.
 */
import { randomUUID } from 'crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { LookupService } from '../lookup/lookup.service';
import { CommitteeListsService } from './committee-lists.service';
import { CommitteeViewer } from '../../common/services/committee-membership';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const REASON = 'Repeated absence without notice';
const FOREIGN_REASON = 'Another organisation’s private reason';

describe('Membership history: who reads a removal reason, on a real database (ACC-301)', () => {
  const prisma = new PrismaService();
  const audit = { log: async () => undefined } as unknown as AuditLogService;
  const lookups = new LookupService(prisma, audit);
  const lists = new CommitteeListsService(prisma, lookups);
  let seat: Record<string, string> = {};

  interface World {
    org: string;
    committee: string;
    people: Record<'chair' | 'secretary' | 'member' | 'leaver' | 'head' | 'viewer' | 'stranger' | 'inactiveChair', string>;
  }
  let w: World;
  let foreign: { org: string; committee: string; head: string };

  /** An organisation, its root unit and head, one committee with seats, and one removal with a reason. */
  async function world(reason: string): Promise<World> {
    const slug = `acc301r-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const root = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Root', code: `R-${slug}` } })).id;
    const headPos = (await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head', grade: 10, isUnitHeadPosition: true } })).id;
    const user = async (name: string, extra: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { organizationId: org, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE', ...extra } as never })).id;
    const people = {
      chair: await user('chair'),
      secretary: await user('secretary'),
      member: await user('member'),
      leaver: await user('leaver'),
      head: await user('head', { primaryOrgUnitId: root, positionId: headPos }),
      viewer: await user('viewer'),
      stranger: await user('stranger'),
      inactiveChair: await user('inactiveChair', { status: 'INACTIVE' }),
    };
    const committee = (
      await prisma.committee.create({ data: { organizationId: org, nameEn: 'Quality Committee', typeValueId: 'type', orgUnitId: root } })
    ).id;
    const sit = (userId: string, seatKey: string, isActive = true) =>
      prisma.committeeMember.create({
        data: { organizationId: org, committeeId: committee, userId, roleValueId: seat[seatKey]!, isActive, ...(isActive ? {} : { leftAt: new Date() }) },
      });
    await sit(people.chair, 'chairman');
    await sit(people.secretary, 'secretary');
    await sit(people.member, 'member');
    await sit(people.inactiveChair, 'chairman');
    await sit(people.leaver, 'member', false);
    await prisma.committeeMembershipEvent.create({
      data: {
        organizationId: org,
        committeeId: committee,
        userId: people.leaver,
        roleValueId: seat['member']!,
        action: 'LEFT',
        effectiveDate: new Date(),
        reason,
        approvedBy: people.chair,
      },
    });
    await prisma.committeeMembershipEvent.create({
      data: { organizationId: org, committeeId: committee, userId: people.member, roleValueId: seat['member']!, action: 'JOINED', effectiveDate: new Date(Date.now() - 86_400_000) },
    });
    return { org, committee, people };
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    await lookups.seedSystemData();
    const values = await prisma.lookupValue.findMany({
      where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
      select: { id: true, key: true },
    });
    seat = Object.fromEntries(values.map((v) => [v.key, v.id]));
    w = await world(REASON);
    const f = await world(FOREIGN_REASON);
    foreign = { org: f.org, committee: f.committee, head: f.people.head };
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const as = (id: string, permissions: string[] = []): CommitteeViewer => ({ id, permissions });
  /** The LEFT row's reason and flag, as this viewer reads the history. */
  const leftRow = async (viewer: CommitteeViewer) => {
    const rows = await lists.membershipEvents(w.committee, w.org, viewer);
    const left = rows.find((r) => r.action === 'LEFT');
    if (!left) throw new Error('the removal is not in the history');
    return { reason: left.reason, reasonWithheld: left.reasonWithheld, rows: rows.length };
  };
  const SHOWN = { reason: REASON, reasonWithheld: false, rows: 2 };
  const WITHHELD = { reason: null, reasonWithheld: true, rows: 2 };

  it('non-vacuity: the stored removal has its reason, and the seats are found by key', async () => {
    expect(seat['chairman'] && seat['secretary'] && seat['member']).toBeTruthy();
    expect((await prisma.committeeMembershipEvent.findFirstOrThrow({ where: { committeeId: w.committee, action: 'LEFT' } })).reason).toBe(REASON);
  });

  it('a member who is no officer reads the history with the reason withheld', async () => {
    expect(await leftRow(as(w.people.member))).toEqual(WITHHELD);
  });

  it('the Chairman reads it', async () => {
    expect(await leftRow(as(w.people.chair))).toEqual(SHOWN);
  });

  it('the Secretary reads it', async () => {
    expect(await leftRow(as(w.people.secretary))).toEqual(SHOWN);
  });

  it('a committees:view holder reads it, with no seat on the committee', async () => {
    expect(await leftRow(as(w.people.viewer, ['committees:view']))).toEqual(SHOWN);
  });

  it('the head of the owning unit reads it through oversight', async () => {
    expect(await leftRow(as(w.people.head))).toEqual(SHOWN);
  });

  it('an INACTIVE user still holding the Chairman seat is not an officer for this', async () => {
    // They could not sign in; the rule refuses them anyway, so a stale session reads nothing.
    expect(await leftRow(as(w.people.inactiveChair))).toEqual(WITHHELD);
  });

  it('a JOINED row with no reason is never marked withheld', async () => {
    const rows = await lists.membershipEvents(w.committee, w.org, as(w.people.member));
    expect(rows.find((r) => r.action === 'JOINED')!.reasonWithheld).toBe(false);
  });

  it('should NOT return records belonging to a different tenant: another organisation’s reason reaches nobody here', async () => {
    // This organisation's committees:view holder and head ask for the other organisation's committee.
    const asked = [as(w.people.viewer, ['committees:view']), as(w.people.head)];
    for (const viewer of asked) {
      const outcome = await lists.membershipEvents(foreign.committee, w.org, viewer).then(
        (rows) => JSON.stringify(rows),
        (e: unknown) => (e instanceof NotFoundException || e instanceof ForbiddenException ? `refused ${e.getStatus()}` : String(e)),
      );
      expect(outcome).toMatch(/^refused 40[34]$/);
      expect(outcome).not.toContain(FOREIGN_REASON);
    }
    // And this organisation's history never carries the other's reason.
    const own = JSON.stringify(await lists.membershipEvents(w.committee, w.org, as(w.people.viewer, ['committees:view'])));
    expect(own).not.toContain(FOREIGN_REASON);
    // The other organisation's own head reads its own reason, so the rule is not simply off.
    const theirs = await lists.membershipEvents(foreign.committee, foreign.org, as(foreign.head));
    expect(theirs.find((r) => r.action === 'LEFT')!.reason).toBe(FOREIGN_REASON);
  });
});
