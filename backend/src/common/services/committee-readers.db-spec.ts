/**
 * ACC-245 (P195) — PARITY: committeeReadersAmong(), the batch that decides who
 * gets a review stage's notice, must name exactly the people mayReadCommittee()
 * admits one by one. Both read the same pieces (activeSeatWhere(),
 * committeeOverseersAmong(), findUnitAncestorIds(), findUnitLeadersAmong()); this
 * proves the clauses around them agree too, on real rows, against a REAL Postgres
 * (npm run test:db).
 *
 * The world, organisation A:
 *
 *   Root (active) ── Mid (INACTIVE) ── Owner (active)      committees: cLive (Owner),
 *        └─ Side (active)                                  cOff (Owner, INACTIVE)
 *
 *   viewHolder      a role holding committees:view           → reads both
 *   viewOffRole     committees:view only on an INACTIVE role  → reads nothing
 *   seatHolder      an active seat on cLive and cOff          → reads cLive
 *   headOwner       head position, primary unit Owner         → reads cLive
 *   headRoot        head position, primary unit Root (above
 *                   the inactive Mid)                         → reads cLive
 *   headMid         head position, primary unit Mid (inactive)→ reads nothing
 *   headSide        head position, primary unit Side          → reads nothing
 *   coverNow        acting cover of Owner, in force           → reads cLive
 *   coverExpired    acting cover of Root, its date passed     → reads nothing
 *   coverEnded      acting cover of Owner, ended by hand      → reads nothing
 *   inactiveHead    an INACTIVE user, head position of Owner  → reads nothing
 *   inactiveSeated  an INACTIVE user with an active seat      → reads cLive (both
 *                   rules ask about the committee; the pool passes ACTIVE people)
 *   stranger        nothing at all                            → reads nothing
 *   elsewhere       organisation B: committees:view there, and head of B's own unit
 *                                                             → reads nothing here
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../testing/tenant-isolation';
import { committeeReadersAmong, mayReadCommittee } from './committee-membership';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

const DAY = 24 * 60 * 60 * 1000;

describe('Who may read a committee: the batch equals the single check, on a real database (ACC-245)', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function permission(module: string, action: string): Promise<string> {
    return (await prisma.permission.upsert({ where: { module_action: { module, action } }, create: { module, action }, update: {} })).id;
  }

  /**
   * What TenantGuard hands a request as `permissions`: RoleService.getUserPermissions()'s
   * rule — the keys of the user's ACTIVE roles in the organisation. Restated here so the
   * single check is fed exactly what production feeds it.
   */
  async function permissionsOf(userId: string, organizationId: string): Promise<string[]> {
    const roles = await prisma.userRole.findMany({
      where: { userId, role: { isActive: true, organizationId } },
      select: { role: { select: { rolePermissions: { select: { permission: { select: { module: true, action: true } } } } } } },
    });
    return [...new Set(roles.flatMap((r) => r.role.rolePermissions.map((rp) => `${rp.permission.module}:${rp.permission.action}`)))];
  }

  async function world() {
    const now = new Date();
    const slug = `acc245p-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const otherSlug = `${slug}-b`;
    const otherOrg = (await prisma.organization.create({ data: { name: otherSlug, slug: otherSlug, country: 'SA' } })).id;

    const unit = async (organizationId: string, nameEn: string, parentId: string | null, isActive = true) =>
      (await prisma.orgUnit.create({ data: { organizationId, nameEn, code: `${nameEn}-${randomUUID().slice(0, 6)}`, parentId, isActive } })).id;
    const root = await unit(org, 'Root', null);
    const mid = await unit(org, 'Mid', root, false);
    const owner = await unit(org, 'Owner', mid);
    const side = await unit(org, 'Side', root);
    const otherRoot = await unit(otherOrg, 'B-Root', null);

    const headPos = (await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head', grade: 10, isUnitHeadPosition: true } })).id;
    const otherHeadPos = (await prisma.orgPosition.create({ data: { organizationId: otherOrg, nameEn: 'Head', grade: 10, isUnitHeadPosition: true } })).id;

    const person = async (name: string, data: Record<string, unknown> = {}, organizationId = org) =>
      (await prisma.user.create({ data: { organizationId, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE', ...data } })).id;
    const p = {
      viewHolder: await person('viewHolder'),
      viewOffRole: await person('viewOffRole'),
      seatHolder: await person('seatHolder'),
      headOwner: await person('headOwner', { positionId: headPos, primaryOrgUnitId: owner }),
      headRoot: await person('headRoot', { positionId: headPos, primaryOrgUnitId: root }),
      headMid: await person('headMid', { positionId: headPos, primaryOrgUnitId: mid }),
      headSide: await person('headSide', { positionId: headPos, primaryOrgUnitId: side }),
      coverNow: await person('coverNow'),
      coverExpired: await person('coverExpired'),
      coverEnded: await person('coverEnded'),
      inactiveHead: await person('inactiveHead', { positionId: headPos, primaryOrgUnitId: owner, status: 'INACTIVE' }),
      inactiveSeated: await person('inactiveSeated', { status: 'INACTIVE' }),
      stranger: await person('stranger'),
      elsewhere: await person('elsewhere', { positionId: otherHeadPos, primaryOrgUnitId: otherRoot }, otherOrg),
    };

    const viewKey = await permission('committees', 'view');
    const role = async (organizationId: string, isActive: boolean, holders: string[]) => {
      const r = await prisma.role.create({ data: { organizationId, nameEn: `View ${randomUUID().slice(0, 6)}`, key: `VIEW_${randomUUID().slice(0, 8)}`, isActive } });
      await prisma.rolePermission.create({ data: { roleId: r.id, permissionId: viewKey } });
      for (const userId of holders) await prisma.userRole.create({ data: { userId, roleId: r.id } });
    };
    await role(org, true, [p.viewHolder]);
    await role(org, false, [p.viewOffRole]);
    await role(otherOrg, true, [p.elsewhere]);

    const committee = async (nameEn: string, isActive: boolean) =>
      (
        await prisma.committee.create({
          data: { organizationId: org, nameEn, typeValueId: 'type', orgUnitId: owner, quorumCount: 1, meetingFrequency: 'MONTHLY', isActive },
        })
      ).id;
    const cLive = await committee('Live', true);
    const cOff = await committee('Off', false);
    for (const committeeId of [cLive, cOff]) {
      await prisma.committeeMember.create({ data: { organizationId: org, committeeId, userId: p.seatHolder, roleValueId: 'seat' } });
    }
    await prisma.committeeMember.create({ data: { organizationId: org, committeeId: cLive, userId: p.inactiveSeated, roleValueId: 'seat' } });

    const cover = (userId: string, orgUnitId: string, extra: Record<string, unknown>) =>
      prisma.orgUnitHeadAssignment.create({
        data: { organizationId: org, orgUnitId, userId, kind: 'ACTING', reason: 'ABSENCE', validFrom: new Date(now.getTime() - 3 * DAY), createdById: p.headRoot, ...extra },
      });
    await cover(p.coverNow, owner, {});
    await cover(p.coverExpired, root, { validTo: new Date(now.getTime() - DAY) });
    await cover(p.coverEnded, owner, { endedAt: new Date(now.getTime() - DAY) });

    return { org, now, p, cLive, cOff };
  }

  /** The single check, person by person, fed the permissions production feeds it. */
  async function singleReaders(w: Awaited<ReturnType<typeof world>>, committeeId: string): Promise<string[]> {
    const out: string[] = [];
    for (const id of Object.values(w.p)) {
      const viewer = { id, permissions: await permissionsOf(id, w.org) };
      if (await mayReadCommittee(prisma, committeeId, w.org, viewer, w.now)) out.push(id);
    }
    return out.sort();
  }
  const batchReaders = async (w: Awaited<ReturnType<typeof world>>, committeeId: string) =>
    [...(await committeeReadersAmong(prisma, committeeId, w.org, Object.values(w.p), w.now))].sort();
  const names = (w: Awaited<ReturnType<typeof world>>, ids: string[]) =>
    ids.map((id) => Object.entries(w.p).find(([, v]) => v === id)![0]).sort();

  it('an active committee: the batch names exactly whom the single check admits', async () => {
    const w = await world();
    const single = await singleReaders(w, w.cLive);
    // Non-vacuity first: the fixture really admits each kind of reader, and refuses the rest.
    expect(names(w, single)).toEqual(['coverNow', 'headOwner', 'headRoot', 'inactiveSeated', 'seatHolder', 'viewHolder'].sort());
    expect(await batchReaders(w, w.cLive)).toEqual(single);
  });

  it('an inactive committee: only committees:view reads it, in both', async () => {
    const w = await world();
    const single = await singleReaders(w, w.cOff);
    expect(names(w, single)).toEqual(['viewHolder']);
    expect(await batchReaders(w, w.cOff)).toEqual(single);
  });

  it('an invented committee: committees:view only, in both', async () => {
    const w = await world();
    const invented = randomUUID();
    const single = await singleReaders(w, invented);
    expect(names(w, single)).toEqual(['viewHolder']);
    expect(await batchReaders(w, invented)).toEqual(single);
  });

  itEnforcesTenantIsolation('committee readers — another organisation’s view key, headship and committee count for nothing here', async () => {
    const w = await world();
    expect(await batchReaders(w, w.cLive)).not.toContain(w.p.elsewhere);
    expect(await singleReaders(w, w.cLive)).not.toContain(w.p.elsewhere);
  });
});
