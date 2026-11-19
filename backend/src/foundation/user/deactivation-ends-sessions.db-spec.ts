/**
 * ACC-216 (CC-301) — deactivating a person ends their sign-ins, against a REAL
 * Postgres (npm run test:db). UserService.deactivate() calls
 * endEverySessionInTx() INSIDE the flip's transaction, so only a database
 * proves:
 *
 *   - every live RefreshToken row of the person is revoked, tokenVersion is
 *     bumped and their Better Auth sessions are deleted, with the status flip;
 *   - a refusal later in the same transaction (the last administrator) rolls the
 *     ending back too: the rows stay live, the version unchanged;
 *   - another organisation's rows are never touched;
 *   - reactivation brings no session back.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { LookupService } from '../lookup/lookup.service';
import { RoleService } from '../roles/role.service';
import { OrganizationService } from '../organization/organization.service';
import { TaskService } from '../task/task.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskAssignmentService } from '../task/task-assignment.service';
import { TaskSlaService } from '../task/task-sla.service';
import { TaskClosedNoticeService } from '../task/task-closed-notice.service';
import { ChangeRequestDepartureService } from '../committees/change-requests/departure/change-request-departure.service';
import { OrgUnitHeadService } from '../organization/org-unit-head.service';
import { OrgPositionService } from '../org-position/org-position.service';
import type { AuthProvider } from '../../providers/auth/auth.provider';
import { WorkflowService } from '../workflow/workflow.service';
import { StageTaskDefinitionService } from '../workflow/stage-task-definition.service';
import { StagePoolService } from '../workflow/stage-pool.service';
import type { CommitteeTransferNoticeService } from '../committees/transfer-notice/committee-transfer-notice.service';
import { TENANT_ADMIN_KEY } from '../roles/tenant-administrator.invariant';
import { UserService } from './user.service';
import { CommitteeSeatDepartureService } from '../committees/departure/committee-seat-departure.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

const HOUR = 3_600_000;

describe('Deactivation ends every sign-in, against a real database (ACC-216, CC-301)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notifications = { create: async () => ({ id: randomUUID() }), createInAppMany: async () => 0 } as unknown as NotificationService;
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const assignment = new TaskAssignmentService(prisma, authority, lookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla, new TaskClosedNoticeService(prisma, notifications));
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);
  const roles = { getUserPermissions: async () => [] } as unknown as RoleService;
  const organizations = { resolveActingHeadForOrgUnit: async () => [], refreshOrgUnitHeadVacancy: async () => undefined } as unknown as OrganizationService;
  const queue = { add: async () => undefined } as never;
  const pools = new StagePoolService(prisma);
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, queue, stageTasks, pools);
  // The old after-commit bump must not run any more: a spy that fails the spec if it does.
  const invalidateUserSessions = jest.fn(async () => undefined);
  const users = new UserService(
    prisma,
    audit,
    notifications,
    roles,
    tasks,
    organizations,
    { invalidateUserSessions } as unknown as AuthProvider,
    {} as OrgUnitHeadService,
    {} as OrgPositionService,
    pools,
    { schedule: () => Promise.resolve() } as unknown as CommitteeTransferNoticeService,
    new ChangeRequestDepartureService(prisma, workflow, tasks, audit),
    // ACC-306 — the real seat ending (no seat here unless a test gives one).
    new CommitteeSeatDepartureService(prisma, new LookupService(prisma, audit), notifications),
  );

  interface Org {
    id: string;
    adminId: string;
    person: (name: string, extra?: Record<string, unknown>) => Promise<string>;
  }

  async function org(): Promise<Org> {
    const slug = `acc216s-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    let n = 0;
    const person = async (name: string, extra: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-${n++}@example.test`, name, status: 'ACTIVE', ...extra } })).id;
    const adminId = await person('Admin');
    return { id: o.id, adminId, person };
  }

  /** A sign-in's refresh row, as issueRefreshToken() writes it; `revoked` for one already ended. */
  async function signIn(o: Org, userId: string, opts: { revoked?: boolean } = {}) {
    const now = Date.now();
    return prisma.refreshToken.create({
      data: {
        userId,
        organizationId: o.id,
        tokenHash: randomUUID(),
        tokenVersion: 0,
        sessionStartedAt: new Date(now - HOUR),
        expiresAt: new Date(now + 10 * HOUR),
        revokedAt: opts.revoked ? new Date(now - HOUR / 2) : null,
        deviceInfo: 'Mozilla/5.0 (test)',
        ipAddress: '203.0.113.7',
      },
    });
  }

  const live = (userId: string, organizationId: string) =>
    prisma.refreshToken.count({ where: { userId, organizationId, revokedAt: null } });
  const versionOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tokenVersion;

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('revokes every live refresh row, bumps tokenVersion and deletes Better Auth sessions, with the flip', async () => {
    const o = await org();
    const authUser = await prisma.authUser.create({ data: { id: randomUUID(), email: `${randomUUID()}@example.test`, name: 'Leaver', emailVerified: true } });
    const leaver = await o.person('Leaver', { authUserId: authUser.id });
    await signIn(o, leaver);
    await signIn(o, leaver);
    const alreadyEnded = await signIn(o, leaver, { revoked: true });
    await prisma.authSession.create({
      data: { id: randomUUID(), userId: authUser.id, token: randomUUID(), expiresAt: new Date(Date.now() + HOUR) },
    });
    const before = await versionOf(leaver);

    await users.deactivate(leaver, o.id, o.adminId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: leaver } });
    expect(user.status).toBe('INACTIVE');
    expect(user.tokenVersion).toBe(before + 1);
    expect(await live(leaver, o.id)).toBe(0);
    expect(await prisma.authSession.count({ where: { userId: authUser.id } })).toBe(0);
    // An already-ended row keeps its own end time.
    const kept = await prisma.refreshToken.findUniqueOrThrow({ where: { id: alreadyEnded.id } });
    expect(kept.revokedAt).toEqual(alreadyEnded.revokedAt);
    // One bump, inside the transaction: the old after-commit call is gone.
    expect(invalidateUserSessions).not.toHaveBeenCalled();
  });

  it('a refusal later in the transaction (the last administrator) rolls the ending back with the flip', async () => {
    const o = await org();
    const lastAdmin = await o.person('Only administrator');
    const role = await prisma.role.create({
      data: { organizationId: o.id, key: TENANT_ADMIN_KEY, nameEn: 'Organization Administrator', isSystem: true },
    });
    await prisma.userRole.create({ data: { userId: lastAdmin, roleId: role.id } });
    await signIn(o, lastAdmin);
    await signIn(o, lastAdmin);
    const before = await versionOf(lastAdmin);

    await expect(users.deactivate(lastAdmin, o.id, o.adminId)).rejects.toThrow();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: lastAdmin } });
    expect(user.status).toBe('ACTIVE');
    expect(user.tokenVersion).toBe(before);
    expect(await live(lastAdmin, o.id)).toBe(2);
  });

  it('should NOT return records belonging to a different tenant: deactivation ends sessions in this organisation only', async () => {
    const a = await org();
    const b = await org();
    const leaver = await a.person('Leaver');
    const bystander = await b.person('Someone in B');
    await signIn(a, leaver);
    await signIn(b, bystander);
    // A row of organisation B naming the leaver's id (as a cross-tenant id
    // would): it must survive, because every write names the organisation too.
    await prisma.refreshToken.create({
      data: { userId: leaver, organizationId: b.id, tokenHash: randomUUID(), tokenVersion: 0, expiresAt: new Date(Date.now() + HOUR) },
    });
    const bystanderVersion = await versionOf(bystander);

    await users.deactivate(leaver, a.id, a.adminId);

    expect(await live(leaver, a.id)).toBe(0);
    expect(await live(leaver, b.id)).toBe(1);
    expect(await live(bystander, b.id)).toBe(1);
    expect(await versionOf(bystander)).toBe(bystanderVersion);
  });

  it('reactivation brings no session back', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    await signIn(o, leaver);
    await users.deactivate(leaver, o.id, o.adminId);
    const ended = await prisma.refreshToken.findMany({ where: { userId: leaver, organizationId: o.id } });

    await users.reactivate(leaver, o.id, o.adminId);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: leaver } })).status).toBe('ACTIVE');
    expect(await live(leaver, o.id)).toBe(0);
    const after = await prisma.refreshToken.findMany({ where: { userId: leaver, organizationId: o.id } });
    expect(after.map((r) => [r.id, r.revokedAt])).toEqual(ended.map((r) => [r.id, r.revokedAt]));
  });
});
