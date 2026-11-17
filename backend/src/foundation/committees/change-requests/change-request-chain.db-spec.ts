/**
 * ACC-283 PR 2 — the chain of authority's LOADER against a REAL Postgres
 * (npm run test:db). The walk's rules are pinned in change-request-chain.spec.ts;
 * this proves the reads: in force, seats, holders, members, the ancestor walk,
 * heads and covers, the query count for 1 request and for 20, and isolation.
 *
 *   ROOT ── DEPT ── WARD          P (owned by ROOT, in force) has a Chair seat
 *        └─ SIB                   that decides reporting changes.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../../common/testing/tenant-isolation';
import { SEAT_ACTIONS } from '../seat-actions';
import { resolveDecisionChains } from './change-request-chain';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const DAY = 24 * 60 * 60 * 1000;
const SEAT = 'seat-chair';

describe('The chain of authority against a real database (ACC-283 PR 2)', () => {
  const prisma = new PrismaService();

  interface World {
    org: string;
    slug: string;
    units: Record<'root' | 'dept' | 'ward' | 'sib', string>;
    people: Record<'rootHead' | 'deptHead' | 'wardHead' | 'chair' | 'member' | 'requester' | 'cover', string>;
    stages: Record<'formation' | 'active' | 'suspended' | 'dissolving', string>;
    template: string;
    p: string;
    c: string;
  }

  async function world(): Promise<World> {
    const slug = `acc283c-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const unit = async (nameEn: string, parentId: string | null) =>
      (await prisma.orgUnit.create({ data: { organizationId: org, nameEn, code: `${nameEn}-${slug}`, parentId } })).id;
    const root = await unit('Root', null);
    const dept = await unit('Dept', root);
    const ward = await unit('Ward', dept);
    const sib = await unit('Sib', root);
    const headPos = (await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head', grade: 10, isUnitHeadPosition: true } })).id;
    const user = async (name: string, primaryOrgUnitId: string | null = null, head = false) =>
      (
        await prisma.user.create({
          data: { organizationId: org, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE', primaryOrgUnitId, positionId: head ? headPos : null },
        })
      ).id;
    const people = {
      rootHead: await user('rootHead', root, true),
      deptHead: await user('deptHead', dept, true),
      wardHead: await user('wardHead', ward, true),
      chair: await user('chair', root),
      member: await user('member', ward),
      requester: await user('requester', ward),
      cover: await user('cover', sib),
    };

    const template = (
      await prisma.workflowTemplate.create({ data: { organizationId: org, nameEn: 'Committee (spec)', objectType: 'COMMITTEE', isDefault: true, isActive: true } })
    ).id;
    const stage = async (nameEn: string, order: number, flags: string[]) =>
      (await prisma.workflowStage.create({ data: { workflowTemplateId: template, nameEn, order, isInitial: order === 10, whoMode: 'ANY_ONE', flags } })).id;
    const stages = {
      formation: await stage('Formation', 10, []),
      active: await stage('Active', 20, ['IN_FORCE']),
      suspended: await stage('Suspended', 30, ['IN_FORCE']),
      dissolving: await stage('Dissolution Pending', 40, ['DISSOLVING']),
    };
    const committee = async (nameEn: string, orgUnitId: string, reportingToCommitteeId: string | null, stageId: string) => {
      const id = (await prisma.committee.create({ data: { organizationId: org, nameEn, typeValueId: 'type', orgUnitId, reportingToCommitteeId } })).id;
      await prisma.workflowInstance.create({
        data: { organizationId: org, workflowTemplateId: template, objectType: 'COMMITTEE', objectId: id, status: 'IN_PROGRESS', currentStageId: stageId },
      });
      return id;
    };
    const p = await committee('Board', root, null, stages.active);
    const c = await committee('Ward Quality', ward, p, stages.active);
    await prisma.committeeSeatAction.create({ data: { organizationId: org, committeeId: p, roleValueId: SEAT, actionKey: SEAT_ACTIONS.DECIDE_REPORTING_CHANGES } });
    await prisma.committeeMember.create({ data: { organizationId: org, committeeId: p, userId: people.chair, roleValueId: SEAT } });
    return { org, slug, units: { root, dept, ward, sib }, people, stages, template, p, c };
  }

  const chainFor = async (w: World, requesterId = w.people.requester, committeeId = w.c) =>
    (await resolveDecisionChains(prisma, w.org, [{ id: 'r', committeeId, requesterId }])).get('r')!;

  const setStage = (w: World, committeeId: string, stageId: string) =>
    prisma.workflowInstance.updateMany({ where: { organizationId: w.org, objectType: 'COMMITTEE', objectId: committeeId }, data: { currentStageId: stageId } });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("the Reports-to committee's Chair decides, by the seat's stored action", async () => {
    const w = await world();
    const r = await chainFor(w);
    expect(r.step).toEqual({ kind: 'REPORTS_TO_SEAT', committeeId: w.p, seatIds: [SEAT] });
    expect(r.deciderIds).toEqual([w.people.chair]);
  });

  it('a Suspended Reports-to still decides (IN_FORCE); one being dissolved does not: the owning unit decides', async () => {
    const w = await world();
    await setStage(w, w.p, w.stages.suspended);
    expect((await chainFor(w)).deciderIds).toEqual([w.people.chair]);
    await setStage(w, w.p, w.stages.dissolving);
    expect((await chainFor(w)).step).toEqual({ kind: 'UNIT_HEAD', unitId: w.units.ward, isRoot: false });
    await prisma.committee.update({ where: { id: w.p }, data: { isActive: false } });
    await setStage(w, w.p, w.stages.active);
    expect((await chainFor(w)).step).toEqual({ kind: 'UNIT_HEAD', unitId: w.units.ward, isRoot: false });
  });

  it("a seat with no decide action decides nothing; a Chair who left fills nothing", async () => {
    const w = await world();
    await prisma.committeeSeatAction.deleteMany({ where: { organizationId: w.org, committeeId: w.p } });
    expect((await chainFor(w)).deciderIds).toEqual([w.people.wardHead]);
    const w2 = await world();
    await prisma.committeeMember.updateMany({ where: { organizationId: w2.org, committeeId: w2.p }, data: { isActive: false, leftAt: new Date() } });
    expect((await chainFor(w2)).deciderIds).toEqual([w2.people.wardHead]);
  });

  it('members of C are skipped below the root: a Chair and a ward head who sit on C pass it up', async () => {
    const w = await world();
    for (const userId of [w.people.chair, w.people.wardHead]) {
      await prisma.committeeMember.create({ data: { organizationId: w.org, committeeId: w.c, userId, roleValueId: 'seat-member' } });
    }
    expect((await chainFor(w)).deciderIds).toEqual([w.people.deptHead]);
  });

  it('a cover in force decides with the head; one not started does not; a deactivated cover does not', async () => {
    const w = await world();
    await prisma.committeeSeatAction.deleteMany({ where: { organizationId: w.org } });
    const cover = (userId: string, validFrom: Date) =>
      prisma.orgUnitHeadAssignment.create({
        data: { organizationId: w.org, orgUnitId: w.units.ward, userId, kind: 'ACTING', reason: 'ABSENCE', validFrom, createdById: w.people.rootHead },
      });
    await cover(w.people.cover, new Date(Date.now() - DAY));
    expect((await chainFor(w)).deciderIds).toEqual([w.people.cover, w.people.wardHead].sort());
    await prisma.user.update({ where: { id: w.people.cover }, data: { status: 'INACTIVE' } });
    expect((await chainFor(w)).deciderIds).toEqual([w.people.wardHead]);
    const w2 = await world();
    await prisma.committeeSeatAction.deleteMany({ where: { organizationId: w2.org } });
    await prisma.orgUnitHeadAssignment.create({
      data: { organizationId: w2.org, orgUnitId: w2.units.ward, userId: w2.people.cover, kind: 'ACTING', reason: 'ABSENCE', validFrom: new Date(Date.now() + DAY), createdById: w2.people.rootHead },
    });
    expect((await chainFor(w2)).deciderIds).toEqual([w2.people.wardHead]);
  });

  it('the walk climbs to the root, which a member of C may still decide at; the root head alone is NONE with requesterHeadsRoot', async () => {
    const w = await world();
    await prisma.committeeSeatAction.deleteMany({ where: { organizationId: w.org } });
    await prisma.user.updateMany({ where: { id: { in: [w.people.wardHead, w.people.deptHead] } }, data: { positionId: null } });
    await prisma.committeeMember.create({ data: { organizationId: w.org, committeeId: w.c, userId: w.people.rootHead, roleValueId: 'seat-member' } });
    expect((await chainFor(w)).step).toEqual({ kind: 'UNIT_HEAD', unitId: w.units.root, isRoot: true });
    expect((await chainFor(w)).deciderIds).toEqual([w.people.rootHead]);
    expect(await chainFor(w, w.people.rootHead)).toEqual({ step: { kind: 'NONE' }, deciderIds: [], requesterHeadsRoot: true });
  });

  it('at most NINE queries, the same for 1 request as for 20 on 20 committees', async () => {
    const w = await world();
    await prisma.orgUnitHeadAssignment.create({
      // On the ROOT, which every chain reaches, so both runs make every read (the covers' users included).
      data: { organizationId: w.org, orgUnitId: w.units.root, userId: w.people.cover, kind: 'ACTING', reason: 'ABSENCE', validFrom: new Date(Date.now() - DAY), createdById: w.people.rootHead },
    });
    const owners = [w.units.ward, w.units.dept, w.units.sib, w.units.root];
    const committees: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = (
        await prisma.committee.create({ data: { organizationId: w.org, nameEn: `C${i}`, typeValueId: 'type', orgUnitId: owners[i % 4]!, reportingToCommitteeId: i % 2 ? w.p : null } })
      ).id;
      committees.push(id);
    }
    const counted = () => {
      let n = 0;
      const wrap = <T extends object>(target: T): T =>
        new Proxy(target, {
          get(t, k) {
            const v = (t as Record<string | symbol, unknown>)[k];
            return typeof v === 'function' ? (...a: unknown[]) => (n++, (v as (...x: unknown[]) => unknown).apply(t, a)) : v;
          },
        });
      const client = {
        committee: wrap(prisma.committee),
        committeeMember: wrap(prisma.committeeMember),
        committeeSeatAction: wrap(prisma.committeeSeatAction),
        user: wrap(prisma.user),
        orgUnitHeadAssignment: wrap(prisma.orgUnitHeadAssignment),
        $queryRaw: (...a: Parameters<PrismaService['$queryRaw']>) => (n++, prisma.$queryRaw(...a)),
      } as unknown as PrismaService;
      return { client, count: () => n };
    };
    const one = counted();
    await resolveDecisionChains(one.client, w.org, [{ id: 'r0', committeeId: committees[1]!, requesterId: w.people.requester }]);
    const twenty = counted();
    const results = await resolveDecisionChains(
      twenty.client,
      w.org,
      committees.map((c, i) => ({ id: `r${i}`, committeeId: c, requesterId: w.people.requester })),
    );
    expect(one.count()).toBeLessThanOrEqual(9);
    expect(twenty.count()).toBe(one.count());
    expect(results.size).toBe(20);
    expect(results.get('r1')!.deciderIds).toEqual([w.people.chair]);
    // r2 is owned by SIB (no head) and reports to nobody: the root's head and its cover.
    expect(results.get('r2')!.deciderIds).toEqual([w.people.cover, w.people.rootHead].sort());
    expect(one.count()).toBe(9);
  });

  itEnforcesTenantIsolation("the chain of authority — another organisation's seats, members, heads and covers never decide here", async () => {
    const w = await world();
    const other = await world();
    // Another organisation's rows pointed at THIS organisation's committees and units.
    await prisma.committeeMember.create({ data: { organizationId: other.org, committeeId: w.p, userId: other.people.chair, roleValueId: SEAT } });
    await prisma.committeeSeatAction.create({ data: { organizationId: other.org, committeeId: w.p, roleValueId: 'seat-other', actionKey: SEAT_ACTIONS.DECIDE_REPORTING_CHANGES } });
    await prisma.orgUnitHeadAssignment.create({
      data: { organizationId: other.org, orgUnitId: w.units.ward, userId: other.people.cover, kind: 'ACTING', reason: 'ABSENCE', validFrom: new Date(Date.now() - DAY), createdById: other.people.rootHead },
    });
    // A membership row filed under the other organisation making THIS ward head a member of C:
    // only the organisation on the members read keeps it from skipping them.
    await prisma.committeeMember.create({ data: { organizationId: other.org, committeeId: w.c, userId: w.people.wardHead, roleValueId: 'seat-member' } });
    const r = await chainFor(w);
    expect(r.deciderIds).toEqual([w.people.chair]);
    expect(r.step).toEqual({ kind: 'REPORTS_TO_SEAT', committeeId: w.p, seatIds: [SEAT] });
    await prisma.committeeSeatAction.deleteMany({ where: { organizationId: w.org } });
    expect((await chainFor(w)).deciderIds).toEqual([w.people.wardHead]);
    // This organisation's committee, asked about under the other organisation: nothing.
    expect((await resolveDecisionChains(prisma, other.org, [{ id: 'r', committeeId: w.c, requesterId: w.people.requester }])).get('r')!.step).toEqual({
      kind: 'NONE',
    });
  });
});
