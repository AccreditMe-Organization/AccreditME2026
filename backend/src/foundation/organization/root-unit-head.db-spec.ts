/**
 * ACC-288 — the root-head rule against a REAL Postgres (npm run test:db).
 *
 * The unit specs fake every answer. Only a database can prove the lock: a root
 * with one head AND one acting cover may lose either, but not both. Two changes
 * saved at the same moment — ending the cover and deactivating the head's
 * position — would each read the other still in place, both pass, and both
 * commit, leaving the root with nobody. The per-organisation advisory lock
 * (`root-head:<org>`) makes the second wait for the first, and then see it.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { OrganizationService } from './organization.service';
import { OrgUnitHeadService } from './org-unit-head.service';
import { OrgPositionService } from '../org-position/org-position.service';
import { UserService } from '../user/user.service';
import { RoleService } from '../roles/role.service';
import { findCurrentHeadHolders, findRunningActingCover } from './unit-headship';
import { ROOT_UNIT_NEEDS_HEAD } from './org-unit-refusals';
// ACC-324 — the real person deactivation, and Setup health's reader.
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { LookupService } from '../lookup/lookup.service';
import { TaskService } from '../task/task.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskAssignmentService } from '../task/task-assignment.service';
import { TaskSlaService } from '../task/task-sla.service';
import { TaskClosedNoticeService } from '../task/task-closed-notice.service';
import { ChangeRequestDepartureService } from '../committees/change-requests/departure/change-request-departure.service';
import { CommitteeSeatDepartureService } from '../committees/departure/committee-seat-departure.service';
import type { CommitteeTransferNoticeService } from '../committees/transfer-notice/committee-transfer-notice.service';
import type { AuthProvider } from '../../providers/auth/auth.provider';
import { WorkflowService } from '../workflow/workflow.service';
import { StageTaskDefinitionService } from '../workflow/stage-task-definition.service';
import { StagePoolService } from '../workflow/stage-pool.service';
import { SetupConditionDetectors } from '../setup-health/setup-condition.detectors';
import { captureRootHeadBaseline } from './root-unit-head.invariant';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

describe('The root unit keeps a head, against a real database (ACC-288)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const organizations = new OrganizationService(prisma, audit);
  // clearActingHead() revokes a cover's role after commit; nothing here holds one.
  const roles = { revokeRoleViaHeadAuthority: async () => undefined } as unknown as RoleService;
  const heads = new OrgUnitHeadService(prisma, audit, {} as UserService, organizations, roles);
  const positions = new OrgPositionService(prisma, audit, organizations);

  const code = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => { code?: string } }) => e.getResponse?.()?.code ?? `ERROR ${String(e)}`,
    );

  /** A tenant whose root has one head (on an active head position) and one acting cover in force. */
  async function rootWithHeadAndCover() {
    const slug = `acc288-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const root = await prisma.orgUnit.create({ data: { organizationId: org.id, nameEn: 'Root', code: `R-${slug}` } });
    const position = await prisma.orgPosition.create({
      data: { organizationId: org.id, nameEn: 'Director', grade: 10, isUnitHeadPosition: true, isSingleAssignee: true },
    });
    const head = await prisma.user.create({
      data: { organizationId: org.id, email: `head-${slug}@example.test`, name: 'Head', status: 'ACTIVE', primaryOrgUnitId: root.id, positionId: position.id },
    });
    const acting = await prisma.user.create({
      data: { organizationId: org.id, email: `acting-${slug}@example.test`, name: 'Acting', status: 'ACTIVE' },
    });
    await prisma.orgUnitHeadAssignment.create({
      data: {
        organizationId: org.id,
        orgUnitId: root.id,
        userId: acting.id,
        kind: 'ACTING',
        reason: 'ABSENCE',
        validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
        createdById: head.id,
      },
    });
    await prisma.orgUnit.update({ where: { id: root.id }, data: { actingHeadUserId: acting.id } });
    return { organizationId: org.id, rootId: root.id, positionId: position.id, actorId: head.id };
  }

  async function headed(organizationId: string, rootId: string): Promise<boolean> {
    if ((await findCurrentHeadHolders(prisma, organizationId, rootId)).length > 0) return true;
    return (await findRunningActingCover(prisma, organizationId, rootId)) !== null;
  }

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('either change alone passes: the root keeps the other', async () => {
    const a = await rootWithHeadAndCover();
    expect(await code(heads.clearActingHead(a.rootId, a.organizationId, a.actorId))).toBe('OK');
    expect(await headed(a.organizationId, a.rootId)).toBe(true);

    const b = await rootWithHeadAndCover();
    expect(await code(positions.deactivatePosition(b.positionId, b.organizationId, b.actorId))).toBe('OK');
    expect(await headed(b.organizationId, b.rootId)).toBe(true);
  });

  it('two changes at the same moment: exactly one is refused, and the root stays headed', async () => {
    const t = await rootWithHeadAndCover();

    const results = await Promise.all([
      code(heads.clearActingHead(t.rootId, t.organizationId, t.actorId)),
      code(positions.deactivatePosition(t.positionId, t.organizationId, t.actorId)),
    ]);

    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(results.filter((r) => r === ROOT_UNIT_NEEDS_HEAD)).toHaveLength(1);
    expect(await headed(t.organizationId, t.rootId)).toBe(true);
  });

  it('a refused change leaves nothing written: the cover is still open and no ACTING_ENDED event exists', async () => {
    const t = await rootWithHeadAndCover();
    expect(await code(positions.deactivatePosition(t.positionId, t.organizationId, t.actorId))).toBe('OK');

    expect(await code(heads.clearActingHead(t.rootId, t.organizationId, t.actorId))).toBe(ROOT_UNIT_NEEDS_HEAD);

    const open = await prisma.orgUnitHeadAssignment.count({ where: { organizationId: t.organizationId, orgUnitId: t.rootId, endedAt: null } });
    const ended = await prisma.orgUnitHeadEvent.count({ where: { organizationId: t.organizationId, orgUnitId: t.rootId, action: 'ACTING_ENDED' } });
    const unit = await prisma.orgUnit.findFirst({ where: { id: t.rootId, organizationId: t.organizationId }, select: { actingHeadUserId: true } });
    expect(open).toBe(1);
    expect(ended).toBe(0);
    expect(unit?.actingHeadUserId).not.toBeNull();
  });

  // ── ACC-324: a cover heads the root only while its person is ACTIVE ─────────
  describe('a cover heads the root only while its person is ACTIVE (ACC-324)', () => {
    const notifications = { create: async () => ({ id: randomUUID() }), createInAppMany: async () => 0 } as unknown as NotificationService;
    const labels = new DelegationLabelService(prisma);
    const visibility = new ObjectVisibilityService(prisma);
    const calendar = new WorkingCalendarService(prisma, audit);
    const authority = new TaskAuthorityService(prisma);
    const lookups = { getValues: async () => [] } as unknown as LookupService;
    const tasks = new TaskService(
      prisma, audit, labels, visibility, calendar, notifications,
      { getTaskSla: async () => null } as unknown as TenantService,
      new TaskAssignmentService(prisma, authority, lookups), authority, new TaskSlaService(prisma, calendar),
      new TaskClosedNoticeService(prisma, notifications),
    );
    const pools = new StagePoolService(prisma);
    const workflow = new WorkflowService(
      prisma, audit, labels, visibility, calendar, notifications, tasks, { add: async () => undefined } as never,
      new StageTaskDefinitionService(prisma, audit, tasks), pools,
    );
    // The real deactivation, with the real organisation service (its vacancy refresh reads the new rule).
    const users = new UserService(
      prisma,
      audit,
      notifications,
      { getUserPermissions: async () => [] } as unknown as RoleService,
      tasks,
      organizations,
      {} as unknown as AuthProvider,
      {} as OrgUnitHeadService,
      {} as OrgPositionService,
      pools,
      { schedule: () => Promise.resolve() } as unknown as CommitteeTransferNoticeService,
      new ChangeRequestDepartureService(prisma, workflow, tasks, audit),
      new CommitteeSeatDepartureService(prisma, new LookupService(prisma, audit), notifications),
    );

    /** A tenant (or the platform) whose root has NO head holder and one acting cover in force; optionally a head holder too. */
    async function rootWithCover(opts: { withHead?: boolean; platform?: boolean } = {}) {
      const slug = `acc324-${randomUUID().slice(0, 8)}`;
      const org = await prisma.organization.create({ data: { name: slug, slug, country: 'SA', isPlatformOrg: opts.platform ?? false } });
      const root = await prisma.orgUnit.create({ data: { organizationId: org.id, nameEn: 'Root', code: `R-${slug}` } });
      const actor = await prisma.user.create({ data: { organizationId: org.id, email: `actor-${slug}@example.test`, name: 'Actor', status: 'ACTIVE' } });
      if (opts.withHead) {
        const position = await prisma.orgPosition.create({
          data: { organizationId: org.id, nameEn: 'Director', grade: 10, isUnitHeadPosition: true, isSingleAssignee: true },
        });
        await prisma.user.create({
          data: { organizationId: org.id, email: `head-${slug}@example.test`, name: 'Head', status: 'ACTIVE', primaryOrgUnitId: root.id, positionId: position.id },
        });
      }
      const cover = await prisma.user.create({ data: { organizationId: org.id, email: `cover-${slug}@example.test`, name: 'Cover', status: 'ACTIVE' } });
      await prisma.orgUnitHeadAssignment.create({
        data: {
          organizationId: org.id,
          orgUnitId: root.id,
          userId: cover.id,
          kind: 'ACTING',
          reason: 'VACANCY',
          validFrom: new Date(Date.now() - 24 * 60 * 60 * 1000),
          createdById: actor.id,
        },
      });
      await prisma.orgUnit.update({ where: { id: root.id }, data: { actingHeadUserId: cover.id } });
      return { organizationId: org.id, rootId: root.id, coverId: cover.id, actorId: actor.id };
    }

    const baselineOf = (organizationId: string) => prisma.$transaction((tx) => captureRootHeadBaseline(organizationId, tx));

    it('a root covered only by a deactivated person is headless; an unrelated change still passes (already headless)', async () => {
      const t = await rootWithCover();
      expect(await baselineOf(t.organizationId)).toBe(true); // non-vacuity: the active cover heads it
      await prisma.user.update({ where: { id: t.coverId }, data: { status: 'INACTIVE' } });
      expect(await baselineOf(t.organizationId)).toBe(false);
      // The cover on record is unchanged: findRunningActingCover() still shows it.
      expect((await findRunningActingCover(prisma, t.organizationId, t.rootId))?.userId).toBe(t.coverId);
      // Already headless: deactivating someone unrelated is allowed (logged, never refused).
      const other = await prisma.user.create({ data: { organizationId: t.organizationId, email: `other-${t.rootId}@example.test`, name: 'Other', status: 'ACTIVE' } });
      expect(await code(users.deactivate(other.id, t.organizationId, t.actorId))).toBe('OK');
    });

    it('deactivating the root’s only active cover is refused, and nothing is written', async () => {
      const t = await rootWithCover();
      expect(await code(users.deactivate(t.coverId, t.organizationId, t.actorId))).toBe(ROOT_UNIT_NEEDS_HEAD);
      const cover = await prisma.user.findFirstOrThrow({ where: { id: t.coverId } });
      expect(cover.status).toBe('ACTIVE');
      expect(await prisma.orgUnitHeadAssignment.count({ where: { organizationId: t.organizationId, orgUnitId: t.rootId, endedAt: null } })).toBe(1);
      expect(await baselineOf(t.organizationId)).toBe(true);
    });

    it('deactivating a cover while the root has a head holder succeeds', async () => {
      const t = await rootWithCover({ withHead: true });
      expect(await code(users.deactivate(t.coverId, t.organizationId, t.actorId))).toBe('OK');
      expect((await prisma.user.findFirstOrThrow({ where: { id: t.coverId } })).status).toBe('INACTIVE');
      expect(await baselineOf(t.organizationId)).toBe(true);
    });

    it('Setup health lists the root, as blocking work, once its only cover is deactivated', async () => {
      const t = await rootWithCover();
      await organizations.refreshOrgUnitHeadVacancy(t.rootId, t.organizationId);
      const detectors = new SetupConditionDetectors(prisma);
      expect((await detectors.orgUnitsWithoutHead(t.organizationId)).map((c) => c.objectId)).toEqual([]); // covered: not listed
      // Reached outside the guarded paths (a status written directly, or older data).
      await prisma.user.update({ where: { id: t.coverId }, data: { status: 'INACTIVE' } });
      await organizations.refreshOrgUnitHeadVacancy(t.rootId, t.organizationId);
      const listed = await detectors.orgUnitsWithoutHead(t.organizationId);
      expect(listed.map((c) => [c.objectId, c.severity])).toEqual([[t.rootId, 'BLOCKS_WORK']]);
    });

    it('the platform organisation stays excluded: deactivating its root’s only cover is not refused', async () => {
      const t = await rootWithCover({ platform: true });
      expect(await code(users.deactivate(t.coverId, t.organizationId, t.actorId))).toBe('OK');
      expect((await prisma.user.findFirstOrThrow({ where: { id: t.coverId } })).status).toBe('INACTIVE');
    });
  });
});
