/**
 * ACC-283 PR 2a (Ahmad, 16 Nov, Q6) — a unit's heads and acting covers in force
 * see, READ ONLY, every committee owned by their unit or any unit below it.
 * Against a REAL Postgres (npm run test:db). Plan:
 * backend/Plans/step-283-change-request-chain.md §4.6.
 *
 * The world, one organisation:
 *
 *   Root ── A ── A1          committees: cRoot (Root), cA (A), cA1 (A1, child of
 *        └─ B                cA, reports to cRoot), cB (B), cAOld (A, inactive)
 *
 *   headA  holds a head position, primary unit A      → reads cA, cA1
 *   headA1 holds a head position, primary unit A1     → reads cA1 only (a CHILD's head)
 *   headB  holds a head position, primary unit B      → reads cB only (a SIBLING)
 *   coverA1 acting cover of A1, in force              → reads cA1
 *   coverSoon acting cover of A, starts tomorrow      → reads nothing
 *   coverEnded acting cover of A, ended yesterday     → reads nothing
 *   former a non-head position in A (no longer head)  → reads nothing
 *
 * Nobody here holds committees:view or is a member. Every write is refused.
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { CommitteeViewer, committeeOversightUnitIds, mayReadCommittee } from '../../common/services/committee-membership';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { COMMITTEE_ACTIONS } from '../workflow/record-registry';
import { LookupService } from '../lookup/lookup.service';
import { WorkflowService } from '../workflow/workflow.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { TaskService } from '../task/task.service';
import { NotificationService } from '../notification/notification.service';
import { recordNamesOf } from '../task/task-record-names';
import { CommitteesService } from './committees.service';
import { CommitteeListsService } from './committee-lists.service';
import { CommitteeHomeService } from './committee-home.service';
import { CommitteeChangeRequestService } from './change-requests/committee-change-request.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const WRITE_KEYS = ['committees:edit_details', 'committees:add_member', 'committees:remove_member', 'committees:change_member_role'];
const READ_REFUSED = 'Required permission: committees:view';
const DAY = 24 * 60 * 60 * 1000;

describe('Heads see the committees of their units, read only, against a real database (ACC-283 PR 2a)', () => {
  const prisma = new PrismaService();
  const workflow = { startInstance: async () => undefined } as unknown as WorkflowService;
  const committees = new CommitteesService(prisma, new AuditLogService(prisma), workflow, new StageRulesService(prisma));
  const lookups = { getValues: async () => [{ id: 'seat-member', labelEn: 'Member', labelAr: null }] } as unknown as LookupService;
  const lists = new CommitteeListsService(prisma, lookups);
  const visibility = new ObjectVisibilityService(prisma);
  const home = new CommitteeHomeService(prisma, lookups);
  // The reads touch only Prisma and the stage rules; the write-side services are never reached.
  const requests = new CommitteeChangeRequestService(
    prisma,
    {} as WorkflowService,
    {} as TaskService,
    new AuditLogService(prisma),
    {} as NotificationService,
    new StageRulesService(prisma),
  );

  type Who = 'headA' | 'headA1' | 'headB' | 'coverA1' | 'coverSoon' | 'coverEnded' | 'former' | 'stranger';
  interface World {
    org: string;
    slug: string;
    units: { root: string; a: string; a1: string; b: string };
    c: { root: string; a: string; a1: string; b: string; aOld: string };
    v: Record<Who, CommitteeViewer>;
    request: string;
  }

  async function world(): Promise<World> {
    const slug = `acc283o-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const unit = async (nameEn: string, parentId: string | null) =>
      (await prisma.orgUnit.create({ data: { organizationId: org, nameEn, code: `${nameEn}-${slug}`, parentId } })).id;
    const root = await unit('Root', null);
    const a = await unit('A', root);
    const a1 = await unit('A1', a);
    const b = await unit('B', root);
    const headPos = (await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head', grade: 10, isUnitHeadPosition: true } })).id;
    const plainPos = (await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Officer', grade: 5 } })).id;
    const user = async (name: string, positionId: string | null, primaryOrgUnitId: string | null) =>
      (
        await prisma.user.create({
          data: { organizationId: org, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE', positionId, primaryOrgUnitId },
        })
      ).id;
    const ids = {
      headA: await user('headA', headPos, a),
      headA1: await user('headA1', headPos, a1),
      headB: await user('headB', headPos, b),
      coverA1: await user('coverA1', plainPos, root),
      coverSoon: await user('coverSoon', plainPos, root),
      coverEnded: await user('coverEnded', plainPos, root),
      former: await user('former', plainPos, a),
      stranger: await user('stranger', plainPos, root),
    };
    const now = Date.now();
    const cover = (userId: string, orgUnitId: string, validFrom: Date, extra: { endedAt?: Date; validTo?: Date } = {}) =>
      prisma.orgUnitHeadAssignment.create({
        data: { organizationId: org, orgUnitId, userId, kind: 'ACTING', reason: 'ABSENCE', validFrom, createdById: ids.stranger, ...extra },
      });
    await cover(ids.coverA1, a1, new Date(now - DAY));
    await cover(ids.coverSoon, a, new Date(now + DAY));
    await cover(ids.coverEnded, a, new Date(now - 10 * DAY), { endedAt: new Date(now - DAY) });

    // A live stage that allows every direct change, as Formation does. Made here, and
    // stating its whoMode, so the spec does not depend on the shared helper's stage
    // when ACC-278 makes whoMode required.
    const template = await prisma.workflowTemplate.create({
      data: { organizationId: org, nameEn: 'Committee (spec)', objectType: 'COMMITTEE', isDefault: true, isActive: true },
    });
    const stage = await prisma.workflowStage.create({
      data: {
        workflowTemplateId: template.id,
        nameEn: 'Formation (spec)',
        order: 10,
        isInitial: true,
        whoMode: 'ANY_ONE',
        flags: ['IN_FORCE'],
        recordActions: {
          create: [COMMITTEE_ACTIONS.EDIT_DETAILS, COMMITTEE_ACTIONS.ADD_MEMBER, COMMITTEE_ACTIONS.REMOVE_MEMBER, COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE].map(
            (actionKey) => ({ organizationId: org, actionKey }),
          ),
        },
      },
    });
    const make = async (nameEn: string, orgUnitId: string, extra: { parentCommitteeId?: string; reportingToCommitteeId?: string; isActive?: boolean } = {}) => {
      const id = (await prisma.committee.create({ data: { organizationId: org, nameEn, typeValueId: 'type', orgUnitId, ...extra } })).id;
      await prisma.workflowInstance.create({
        data: { organizationId: org, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: id, status: 'IN_PROGRESS', currentStageId: stage.id },
      });
      return id;
    };
    const cRoot = await make('Board', root);
    const cA = await make('Quality Council', a);
    const cA1 = await make('Hand Hygiene', a1, { parentCommitteeId: cA, reportingToCommitteeId: cRoot });
    const cB = await make('Safety', b);
    const cAOld = await make('Old', a, { isActive: false });
    const request = (
      await prisma.committeeChangeRequest.create({
        data: { organizationId: org, committeeId: cA1, number: 1, requestedById: ids.stranger, reason: 'Rename', changes: { nameEn: 'Hand Hygiene and Infection' } },
      })
    ).id;

    const v = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, { id, permissions: WRITE_KEYS }])) as unknown as Record<Who, CommitteeViewer>;
    return { org, slug, units: { root, a, a1, b }, c: { root: cRoot, a: cA, a1: cA1, b: cB, aOld: cAOld }, v, request };
  }

  /** 'OK', or the refusal's message or code. */
  const outcome = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => string | { message?: string | string[]; code?: string } }) => {
        const r = e.getResponse?.();
        if (typeof r === 'string') return r;
        return (r?.code as string) ?? (Array.isArray(r?.message) ? r.message.join('; ') : r?.message) ?? `ERROR ${String(e)}`;
      },
    );

  /** Which of the world's committees this viewer may read, by the one rule. */
  const readable = async (w: World, who: Who): Promise<string[]> => {
    const names: string[] = [];
    for (const [name, id] of Object.entries(w.c)) if (await mayReadCommittee(prisma, id, w.org, w.v[who])) names.push(name);
    return names.sort();
  };

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('who reads what', () => {
    it("a head reads their unit's committees and every unit's below, active only; not a sibling's, not the parent's", async () => {
      const w = await world();
      expect(await readable(w, 'headA')).toEqual(['a', 'a1']);
    });

    it("a CHILD unit's head reads their own unit's committees, never the parent unit's", async () => {
      const w = await world();
      expect(await readable(w, 'headA1')).toEqual(['a1']);
    });

    it("a SIBLING unit's head reads only their own unit's", async () => {
      const w = await world();
      expect(await readable(w, 'headB')).toEqual(['b']);
    });

    it('a cover in force reads like the head of that unit', async () => {
      const w = await world();
      expect(await readable(w, 'coverA1')).toEqual(['a1']);
    });

    it('a cover not started yet, a cover that has ended, a former head and a stranger read nothing', async () => {
      const w = await world();
      for (const who of ['coverSoon', 'coverEnded', 'former', 'stranger'] as const) expect(await readable(w, who)).toEqual([]);
    });

    it('the oversight set is the unit led and every unit below, by the one function', async () => {
      const w = await world();
      expect(await committeeOversightUnitIds(prisma, w.org, w.v.headA.id, new Date())).toEqual(new Set([w.units.a, w.units.a1]));
      expect(await committeeOversightUnitIds(prisma, w.org, w.v.former.id, new Date())).toEqual(new Set());
    });
  });

  describe('every read', () => {
    const reads: [string, (w: World, v: CommitteeViewer, id: string) => Promise<unknown>][] = [
      ['GET /committees/:id', (w, v, id) => committees.getCommitteeDetail(id, w.org, v)],
      ['GET /committees/:id/members', (w, v, id) => committees.listMembers(id, w.org, v)],
      ['GET /committees/:id/members/page', (w, v, id) => lists.members(id, {}, w.org, v)],
      ['GET /committees/:id/sub-committees', (w, v, id) => lists.subCommittees(id, {}, w.org, v)],
      ['GET /committees/:id/membership-events', (w, v, id) => lists.membershipEvents(id, w.org, v)],
      ['GET /committees/:id/seat-actions', (w, v, id) => committees.getSeatActions(id, w.org, v)],
      ['GET /committees/:id/change-requests', (w, v, id) => requests.list(id, {} as never, w.org, { userId: v.id, permissions: [...v.permissions] })],
      ['GET /committees/:id/change-requests/open', (w, v, id) => requests.openSummary(id, w.org, { userId: v.id, permissions: [...v.permissions] })],
      ['the workflow reads (InstanceAccess, the parent rule with oversight)', (w, v, id) => visibility.assertCanView('COMMITTEE', id, w.org, v.permissions, v.id, { oversight: true })],
    ];

    it.each(reads)("%s: the unit's head and a cover in force are admitted; anyone else gets the identical 403", async (_name, read) => {
      const w = await world();
      expect(await outcome(read(w, w.v.headA, w.c.a1))).toBe('OK');
      expect(await outcome(read(w, w.v.coverA1, w.c.a1))).toBe('OK');
      expect(await outcome(read(w, w.v.headB, w.c.a1))).toBe(READ_REFUSED);
      expect(await outcome(read(w, w.v.headA1, w.c.a))).toBe(READ_REFUSED);
      expect(await outcome(read(w, w.v.stranger, w.c.a1))).toBe(READ_REFUSED);
    });

    it('a change request by id: its committee\'s overseer reads it; anyone else gets the 403 a missing request gets', async () => {
      const w = await world();
      const asViewer = (v: CommitteeViewer) => ({ userId: v.id, permissions: [...v.permissions] });
      expect(await outcome(requests.getOne(w.request, w.org, asViewer(w.v.headA)))).toBe('OK');
      expect(await outcome(requests.getOne(w.request, w.org, asViewer(w.v.headB)))).toBe(READ_REFUSED);
      expect(await outcome(requests.getOne('no-such-request', w.org, asViewer(w.v.headA)))).toBe(READ_REFUSED);
      expect(await outcome(visibility.assertCanView('COMMITTEE_CHANGE_REQUEST', w.request, w.org, [], w.v.headA.id, { oversight: true }))).toBe('OK');
      expect(await outcome(visibility.assertCanView('COMMITTEE_CHANGE_REQUEST', w.request, w.org, [], w.v.headB.id, { oversight: true }))).toBe(READ_REFUSED);
    });

    it('an invented committee id is the same 403 for a head as a committee they do not oversee', async () => {
      const w = await world();
      expect(await outcome(committees.getCommitteeDetail('no-such-committee', w.org, w.v.headA))).toBe(READ_REFUSED);
    });

    it('GET /committees lists the active committees of the units led, and nothing else', async () => {
      const w = await world();
      const names = async (v: CommitteeViewer) => (await committees.listCommittees(w.org, v)).map((c) => c.nameEn).sort();
      expect(await names(w.v.headA)).toEqual(['Hand Hygiene', 'Quality Council']);
      expect(await names(w.v.coverA1)).toEqual(['Hand Hygiene']);
      expect(await names(w.v.former)).toEqual([]);
    });

    it('mayOpen and task-row names follow the same rule, read once per response', async () => {
      const w = await world();
      const detail = await committees.getCommitteeDetail(w.c.a1, w.org, w.v.headA1);
      expect(detail.parent).toEqual(expect.objectContaining({ id: w.c.a, mayOpen: false }));
      expect(detail.reportsTo).toEqual(expect.objectContaining({ id: w.c.root, mayOpen: false }));
      const fromAbove = await committees.getCommitteeDetail(w.c.a1, w.org, w.v.headA);
      expect(fromAbove.parent).toEqual(expect.objectContaining({ id: w.c.a, mayOpen: true }));
      const subs = await lists.subCommittees(w.c.a, {}, w.org, w.v.headA);
      expect(subs.items.map((r) => [r.nameEn, r.mayOpen])).toEqual([['Hand Hygiene', true]]);

      const named = await recordNamesOf(
        prisma,
        [{ sourceType: 'COMMITTEE', sourceId: w.c.a1 }, { sourceType: 'COMMITTEE', sourceId: w.c.b }],
        w.org,
        w.v.headA.permissions,
        w.v.headA.id,
      );
      expect([...named.values()].map((r) => r.nameEn)).toEqual(['Hand Hygiene']);
    });
  });

  describe('GET /committees/mine — mayBrowseCommittees, what the rail and the /committees guard key on', () => {
    const may = async (w: World, v: CommitteeViewer) => (await home.mine(w.org, v.id, v.permissions)).mayBrowseCommittees;

    it('true for committees:view, an active member, a head and a cover in force', async () => {
      const w = await world();
      await prisma.committeeMember.create({ data: { organizationId: w.org, committeeId: w.c.b, userId: w.v.stranger.id, roleValueId: 'seat-member' } });
      expect(await may(w, { id: w.v.former.id, permissions: ['committees:view'] })).toBe(true);
      expect(await may(w, w.v.stranger)).toBe(true);
      expect(await may(w, w.v.headA)).toBe(true);
      expect(await may(w, w.v.headA1)).toBe(true);
      expect(await may(w, w.v.coverA1)).toBe(true);
    });

    it('false for a stranger, a former head, a cover not started and a cover ended', async () => {
      const w = await world();
      for (const who of ['stranger', 'former', 'coverSoon', 'coverEnded'] as const) expect(await may(w, w.v[who])).toBe(false);
    });

    it("false for a head whose units own only an inactive committee; a membership row that ended doesn't count", async () => {
      const w = await world();
      await prisma.committee.updateMany({ where: { organizationId: w.org, id: { in: [w.c.b] } }, data: { isActive: false } });
      expect(await may(w, w.v.headB)).toBe(false);
      await prisma.committeeMember.create({
        data: { organizationId: w.org, committeeId: w.c.a, userId: w.v.former.id, roleValueId: 'seat-member', isActive: false, leftAt: new Date() },
      });
      expect(await may(w, w.v.former)).toBe(false);
    });

    itEnforcesTenantIsolation("mayBrowseCommittees — another organisation's head, units and committees grant nothing here", async () => {
      const w = await world();
      const other = await world();
      expect(await home.mine(w.org, other.v.headA.id, [])).toEqual(expect.objectContaining({ total: 0, mayBrowseCommittees: false }));
      // A cover filed under the other organisation, pointing at this organisation's unit B.
      await prisma.orgUnitHeadAssignment.create({
        data: { organizationId: other.org, orgUnitId: w.units.b, userId: w.v.stranger.id, kind: 'ACTING', reason: 'ABSENCE', validFrom: new Date(Date.now() - DAY), createdById: w.v.stranger.id },
      });
      expect(await may(w, w.v.stranger)).toBe(false);
    });
  });

  describe('writes are unchanged: overseeing is read only', () => {
    it('a head may not edit, add a member, or save seat actions on a committee they oversee: the 404 a missing committee gets', async () => {
      const w = await world();
      const v = w.v.headA;
      const loaded = JSON.parse(JSON.stringify((await committees.getSeatActions(w.c.a1, w.org, v)).updatedAt)) as string;
      expect(await outcome(committees.updateCommittee(w.c.a1, { nameEn: 'Renamed' } as never, w.org, v.id, v.permissions))).toBe('Committee not found');
      expect(await outcome(committees.addMember(w.c.a1, { userId: w.v.stranger.id, roleValueId: 'seat-member' } as never, w.org, v.id, v.permissions))).toBe(
        'Committee not found',
      );
      expect(await outcome(committees.replaceSeatActions(w.c.a1, { expectedUpdatedAt: loaded, seats: [] }, w.org, v.id, v.permissions))).toBe(
        'Committee not found',
      );
    });

    it('the parent rule WITHOUT the oversight option (task create, a press, a vote) still refuses a head', async () => {
      const w = await world();
      expect(await outcome(visibility.assertCanView('COMMITTEE', w.c.a1, w.org, [], w.v.headA.id))).toBe(READ_REFUSED);
    });
  });

  describe('the platform organisation', () => {
    it('a head in the platform organisation oversees nothing in a tenant, and is refused its committees', async () => {
      const w = await world();
      const pslug = `acc283p-${randomUUID().slice(0, 8)}`;
      const platform = (await prisma.organization.create({ data: { name: pslug, slug: pslug, country: 'SA', isPlatformOrg: true } })).id;
      const pUnit = (await prisma.orgUnit.create({ data: { organizationId: platform, nameEn: 'Platform', code: `P-${pslug}` } })).id;
      const pPos = (await prisma.orgPosition.create({ data: { organizationId: platform, nameEn: 'Head', grade: 10, isUnitHeadPosition: true } })).id;
      const pHead = (
        await prisma.user.create({
          data: { organizationId: platform, email: `${pslug}-h@example.test`, name: 'Platform head', status: 'ACTIVE', positionId: pPos, primaryOrgUnitId: pUnit },
        })
      ).id;
      expect(await committeeOversightUnitIds(prisma, w.org, pHead, new Date())).toEqual(new Set());
      expect(await outcome(committees.getCommitteeDetail(w.c.a, w.org, { id: pHead, permissions: [] }))).toBe(READ_REFUSED);
      expect(await outcome(committees.getCommitteeDetail(w.c.a, platform, { id: pHead, permissions: [] }))).toBe(READ_REFUSED);
    });
  });

  describe('tenant isolation', () => {
    itEnforcesTenantIsolation("committee oversight — another organisation's units, heads and covers grant nothing here", async () => {
      const w = await world();
      const other = await world();
      // A cover row filed under the other organisation, for THIS organisation's head, on the other's unit.
      await prisma.orgUnitHeadAssignment.create({
        data: { organizationId: other.org, orgUnitId: other.units.a, userId: w.v.stranger.id, kind: 'ACTING', reason: 'ABSENCE', validFrom: new Date(Date.now() - DAY), createdById: w.v.stranger.id },
      });
      // And one filed under the other organisation that points at one of THIS organisation's units:
      // only the organisation on the cover read keeps it out.
      await prisma.orgUnitHeadAssignment.create({
        data: { organizationId: other.org, orgUnitId: w.units.b, userId: w.v.stranger.id, kind: 'ACTING', reason: 'ABSENCE', validFrom: new Date(Date.now() - DAY), createdById: w.v.stranger.id },
      });
      expect(await committeeOversightUnitIds(prisma, w.org, w.v.stranger.id, new Date())).toEqual(new Set());
      expect(await readable(w, 'stranger')).toEqual([]);
      // The other organisation's head, asking about this organisation's committees.
      expect(await outcome(committees.getCommitteeDetail(w.c.a, w.org, other.v.headA))).toBe(READ_REFUSED);
      expect(await outcome(committees.getCommitteeDetail(w.c.a, other.org, other.v.headA))).toBe(READ_REFUSED);
      expect((await committees.listCommittees(other.org, other.v.headA)).map((c) => c.id).sort()).toEqual([other.c.a, other.c.a1].sort());
    });

    itEnforcesTenantIsolation("committee oversight — a head's set never holds another organisation's units", async () => {
      const w = await world();
      const other = await world();
      const set = await committeeOversightUnitIds(prisma, w.org, w.v.headA.id, new Date());
      for (const id of Object.values(other.units)) expect(set.has(id)).toBe(false);
      expect(await committeeOversightUnitIds(prisma, other.org, w.v.headA.id, new Date())).toEqual(new Set());
    });
  });
});
