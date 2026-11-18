/**
 * ACC-154 — a role can't be deactivated while anything still holds or names
 * it, and a deactivated role is never given out again, against a REAL Postgres
 * (npm run test:db).
 *
 * One case per category (a direct user grant, a grant through a head position,
 * an active position that gives the role, a workflow stage escalation rule
 * naming it), each refused with 409 ROLE_IN_USE naming that category, and the
 * pre-flight returning the same blockers. The names are capped at 10 with the
 * true count; an unreferenced system role still deactivates; another
 * organisation's rows never count. Only ACTIVE and INVITED users' grants and
 * ACTIVE positions count, and each category's names follow the reader's own
 * permissions (users:view, positions:view, workflows:view), its count never.
 *
 * Then the other side: a deactivated role is refused (ROLE_INACTIVE) to a
 * person, through a head position and as a position's role; a position's role
 * can be cleared; and the two races — a stage save and a grant each WAIT for a
 * deactivate holding the role, then see it inactive.
 * Fails, never skips, without a local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { RoleService } from './role.service';
import { OrgPositionService } from '../org-position/org-position.service';
import type { OrganizationService } from '../organization/organization.service';
import { StageTaskDefinitionService } from '../workflow/stage-task-definition.service';
import { WorkflowTemplateService } from '../workflow/workflow-template.service';
import type { TaskService } from '../task/task.service';
import type { RoleReferenceBlocker } from './role-references';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

describe('A role is deactivated only when nothing holds or names it, on a real database (ACC-154)', () => {
  const prisma = new PrismaService();
  /** A second connection, for the deactivate that holds the role while another write waits. */
  const other = new PrismaService();
  const audit = new AuditLogService(prisma);
  const roles = new RoleService(prisma, audit);
  const positions = new OrgPositionService(prisma, audit, {} as OrganizationService);
  const templates = new WorkflowTemplateService(prisma, audit, new StageTaskDefinitionService(prisma, audit, {} as TaskService));

  beforeAll(async () => {
    await prisma.onModuleInit();
    await other.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
    await other.onModuleDestroy();
  });

  /** Every name permission: the tests about what blocks read every name. */
  const ALL = ['users:view', 'positions:view', 'workflows:view'];

  /** A fresh organisation and one role in it. */
  async function setup(roleKey: string | null = null): Promise<{ org: string; role: string; slug: string }> {
    const slug = `acc154-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const role = (await prisma.role.create({ data: { organizationId: org, key: roleKey, nameEn: `Reviewers ${slug}`, isSystem: roleKey !== null } })).id;
    return { org, role, slug };
  }
  const user = async (org: string, name: string, status: 'ACTIVE' | 'INACTIVE' | 'INVITED' | 'SUSPENDED' = 'ACTIVE') =>
    (await prisma.user.create({ data: { organizationId: org, email: `${randomUUID()}@example.test`, name, status } })).id;
  type Refusal = { statusCode: number; code: string; reason?: string; blockers: RoleReferenceBlocker[] };
  const refusalOf = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { getResponse?: () => unknown }) => (e.getResponse ? (e.getResponse() as Refusal) : e),
    ) as Promise<Refusal | null>;
  const refusal = (role: string, org: string) => refusalOf(roles.deactivateRole(role, org, 'actor', ALL));
  const isActive = async (role: string) => (await prisma.role.findUniqueOrThrow({ where: { id: role } })).isActive;
  const person = (name: string) => ({ nameEn: name, nameAr: null });
  const deactivated = async (role: string) => prisma.role.update({ where: { id: role }, data: { isActive: false } });
  async function stageNaming(org: string, role: string | null, name = 'Terms Review') {
    const template = await prisma.workflowTemplate.create({ data: { organizationId: org, nameEn: 'Committee', nameAr: 'اللجنة', objectType: 'COMMITTEE' } });
    return prisma.workflowStage.create({
      data: {
        workflowTemplateId: template.id,
        nameEn: name,
        nameAr: 'مراجعة الشروط',
        order: 1,
        whoMode: 'ANY_ONE',
        escalationConfig: role ? [{ afterHours: 8, notifyRoleId: role }] : [],
      },
    });
  }

  // ── What blocks ────────────────────────────────────────────────────────────

  it('a direct user grant blocks it (USER_GRANTS), active and invited users only; the pre-flight says the same', async () => {
    const { org, role } = await setup();
    await prisma.userRole.createMany({
      data: [
        { userId: await user(org, 'Huda'), roleId: role },
        { userId: await user(org, 'Omar', 'INVITED'), roleId: role },
        { userId: await user(org, 'Layla', 'INACTIVE'), roleId: role },
        { userId: await user(org, 'Sami', 'SUSPENDED'), roleId: role },
      ],
    });
    const expected = [{ category: 'USER_GRANTS', count: 2, names: [person('Huda'), person('Omar')] }];
    const refused = await refusal(role, org);
    expect(refused).toEqual(expect.objectContaining({ statusCode: 409, code: 'ROLE_IN_USE' }));
    expect(refused?.blockers).toEqual(expected);
    expect(await roles.deactivationCheck(role, org, ALL)).toEqual({ canDeactivate: false, rootRole: false, blockers: expected });
    expect(await isActive(role)).toBe(true);
  });

  it('a grant through a head position blocks it (POSITION_GRANTS)', async () => {
    const { org, role } = await setup();
    const position = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head of Quality', grade: 1 } });
    await prisma.userRole.create({ data: { userId: await user(org, 'Sara'), roleId: role, grantedViaHeadPositionId: position.id } });
    expect((await refusal(role, org))?.blockers).toEqual([{ category: 'POSITION_GRANTS', count: 1, names: [person('Sara')] }]);
    expect(await isActive(role)).toBe(true);
  });

  it('an ACTIVE position that gives the role blocks it (POSITIONS), with both its names; an inactive one does not', async () => {
    const { org, role } = await setup();
    await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Quality Lead', nameAr: 'قائد الجودة', grade: 2, roleId: role } });
    await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Retired Lead', grade: 2, roleId: role, isActive: false } });
    expect((await refusal(role, org))?.blockers).toEqual([
      { category: 'POSITIONS', count: 1, names: [{ nameEn: 'Quality Lead', nameAr: 'قائد الجودة' }] },
    ]);
    expect(await isActive(role)).toBe(true);

    const onlyInactive = await setup();
    await prisma.orgPosition.create({ data: { organizationId: onlyInactive.org, nameEn: 'Retired Lead', grade: 2, roleId: onlyInactive.role, isActive: false } });
    expect(await roles.deactivationCheck(onlyInactive.role, onlyInactive.org, ALL)).toEqual({ canDeactivate: true, rootRole: false, blockers: [] });
  });

  it('a workflow stage escalation rule naming it blocks it (STAGE_ESCALATIONS), the workflow and stage named apart', async () => {
    const { org, role } = await setup();
    await stageNaming(org, role);
    expect((await refusal(role, org))?.blockers).toEqual([
      {
        category: 'STAGE_ESCALATIONS',
        count: 1,
        names: [{ nameEn: 'Terms Review', nameAr: 'مراجعة الشروط', workflow: { nameEn: 'Committee', nameAr: 'اللجنة' } }],
      },
    ]);
    expect(await isActive(role)).toBe(true);
  });

  it('an inactive or suspended user’s leftover grant does not block it, direct or through a head position', async () => {
    const { org, role } = await setup();
    const position = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head of Quality', grade: 1 } });
    await prisma.userRole.createMany({
      data: [
        { userId: await user(org, 'Layla', 'INACTIVE'), roleId: role },
        { userId: await user(org, 'Sami', 'SUSPENDED'), roleId: role, grantedViaHeadPositionId: position.id },
      ],
    });
    expect(await roles.deactivationCheck(role, org, ALL)).toEqual({ canDeactivate: true, rootRole: false, blockers: [] });
    await roles.deactivateRole(role, org, await user(org, 'Admin'), ALL);
    expect(await isActive(role)).toBe(false);
  });

  it('names each category only for a reader with its view permission; counts always', async () => {
    const { org, role } = await setup();
    const position = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Quality Lead', grade: 2, roleId: role } });
    await prisma.userRole.create({ data: { userId: await user(org, 'Huda'), roleId: role } });
    await prisma.userRole.create({ data: { userId: await user(org, 'Sara'), roleId: role, grantedViaHeadPositionId: position.id } });
    await stageNaming(org, role);
    const seen = async (permissions: string[]) =>
      (await roles.deactivationCheck(role, org, permissions)).blockers.map((b) => [b.category, b.count, b.names.length]);

    expect(await seen(['roles:manage'])).toEqual([
      ['USER_GRANTS', 1, 0],
      ['POSITION_GRANTS', 1, 0],
      ['POSITIONS', 1, 0],
      ['STAGE_ESCALATIONS', 1, 0],
    ]);
    expect(await seen(['roles:manage', 'users:view'])).toEqual([
      ['USER_GRANTS', 1, 1],
      ['POSITION_GRANTS', 1, 1],
      ['POSITIONS', 1, 0],
      ['STAGE_ESCALATIONS', 1, 0],
    ]);
    expect(await seen(['roles:manage', 'positions:view'])).toEqual([
      ['USER_GRANTS', 1, 0],
      ['POSITION_GRANTS', 1, 0],
      ['POSITIONS', 1, 1],
      ['STAGE_ESCALATIONS', 1, 0],
    ]);
    expect(await seen(['roles:manage', 'workflows:view'])).toEqual([
      ['USER_GRANTS', 1, 0],
      ['POSITION_GRANTS', 1, 0],
      ['POSITIONS', 1, 0],
      ['STAGE_ESCALATIONS', 1, 1],
    ]);
    // The refusal carries the same: counts, and only the names the caller may see.
    expect((await refusalOf(roles.deactivateRole(role, org, 'actor', ['roles:manage'])))?.blockers).toEqual(
      [1, 2, 3, 4].map(() => expect.objectContaining({ count: 1, names: [] })),
    );
    expect(await isActive(role)).toBe(true);
  });

  it('names at most 10, with the true count, and lists every category that has any', async () => {
    const { org, role } = await setup();
    for (let i = 0; i < 12; i++) await prisma.userRole.create({ data: { userId: await user(org, `Person ${String(i).padStart(2, '0')}`), roleId: role } });
    await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Quality Lead', grade: 2, roleId: role } });
    const check = await roles.deactivationCheck(role, org, ALL);
    expect(check.blockers.map((b) => [b.category, b.count, b.names.length])).toEqual([
      ['USER_GRANTS', 12, 10],
      ['POSITIONS', 1, 1],
    ]);
  });

  it('an unreferenced role deactivates, a system role included', async () => {
    for (const key of [null, 'VIEWER']) {
      const { org, role } = await setup(key);
      expect(await roles.deactivationCheck(role, org, ALL)).toEqual({ canDeactivate: true, rootRole: false, blockers: [] });
      await roles.deactivateRole(role, org, await user(org, 'Admin'), ALL);
      expect(await isActive(role)).toBe(false);
    }
  });

  it('an already inactive role: the pre-flight agrees with deactivate (no blockers, allowed)', async () => {
    const { org, role } = await setup();
    await prisma.userRole.create({ data: { userId: await user(org, 'Huda'), roleId: role } });
    await deactivated(role);
    expect(await roles.deactivationCheck(role, org, ALL)).toEqual({ canDeactivate: true, rootRole: false, blockers: [] });
    await expect(roles.deactivateRole(role, org, 'actor', ALL)).resolves.toBeUndefined();
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // A role in organisation A with nothing of its own; organisation B grants its
    // own role, has a position giving it, and a stage rule that even names A's role id.
    const a = await setup();
    const b = await setup();
    await prisma.userRole.create({ data: { userId: await user(b.org, 'Bilal'), roleId: b.role } });
    await prisma.orgPosition.create({ data: { organizationId: b.org, nameEn: 'B position', grade: 1, roleId: b.role } });
    await stageNaming(b.org, a.role, 'B stage');
    expect((await roles.deactivationCheck(a.role, a.org, ALL)).blockers).toEqual([]);
    // And A's role asked for under B's organisation is not found at all.
    await expect(roles.deactivationCheck(a.role, b.org, ALL)).rejects.toThrow('Role not found');
    // Nor can B give out A's role.
    expect(await refusalOf(roles.assignRoleToUser(await user(b.org, 'Bader'), { roleId: a.role }, b.org, 'actor'))).toEqual(
      expect.objectContaining({ statusCode: 404, code: 'ROLE_NOT_FOUND' }),
    );
    await roles.deactivateRole(a.role, a.org, await user(a.org, 'Admin'), ALL);
    expect(await isActive(a.role)).toBe(false);
  });

  // ── A deactivated role is never given out again (ROLE_INACTIVE) ─────────────

  it('is refused to a person, through a head position, and as a position’s role', async () => {
    const { org, role } = await setup();
    await deactivated(role);
    const actor = await user(org, 'Admin');
    const huda = await user(org, 'Huda');
    const inactive = expect.objectContaining({ statusCode: 409, code: 'ROLE_INACTIVE' });

    expect(await refusalOf(roles.assignRoleToUser(huda, { roleId: role }, org, actor))).toEqual(inactive);
    const head = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head of Quality', grade: 1 } });
    expect(await refusalOf(roles.grantRoleViaHeadAuthority(huda, role, head.id, null, org, actor))).toEqual(inactive);
    expect(await refusalOf(positions.createPosition({ nameEn: 'Lead', grade: 2, roleId: role }, org, actor))).toEqual(inactive);
    expect(await refusalOf(positions.updatePosition(head.id, { roleId: role }, org, actor))).toEqual(inactive);
    expect(await prisma.userRole.count({ where: { roleId: role } })).toBe(0);
    expect(await prisma.orgPosition.count({ where: { roleId: role } })).toBe(0);
  });

  it('a position keeping its (since deactivated) role can still be renamed; only a changed role is checked', async () => {
    const { org, role } = await setup();
    const position = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Quality Lead', grade: 2, roleId: role } });
    await deactivated(role);
    const actor = await user(org, 'Admin');
    await positions.updatePosition(position.id, { nameEn: 'Senior Quality Lead', roleId: role }, org, actor);
    expect((await prisma.orgPosition.findUniqueOrThrow({ where: { id: position.id } })).nameEn).toBe('Senior Quality Lead');
  });

  it('a POSITIONS blocker is cleared in the app: roleId null removes the position’s role, and the role deactivates', async () => {
    const { org, role } = await setup();
    const position = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Quality Lead', grade: 2, roleId: role } });
    const actor = await user(org, 'Admin');
    expect((await refusal(role, org))?.code).toBe('ROLE_IN_USE');
    await positions.updatePosition(position.id, { roleId: null }, org, actor);
    expect((await prisma.orgPosition.findUniqueOrThrow({ where: { id: position.id } })).roleId).toBeNull();
    await roles.deactivateRole(role, org, actor, ALL);
    expect(await isActive(role)).toBe(false);
  });

  // ── The races: a write WAITS for a deactivate that holds the role ──────────

  /**
   * Starts a deactivate on the second connection that takes the role FOR
   * UPDATE (as deactivateRole() does) and holds it until `commit()`.
   */
  async function holdDeactivating(role: string): Promise<{ commit: () => Promise<void> }> {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));
    const done = other.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${role} FOR UPDATE`;
        locked();
        await gate;
        await tx.role.update({ where: { id: role }, data: { isActive: false } });
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    await lockTaken;
    return {
      commit: async () => {
        release();
        await done;
      },
    };
  }

  /** Whether `p` is still pending after a second: it is waiting on a lock. */
  async function stillWaiting(p: Promise<unknown>): Promise<boolean> {
    let settled = false;
    void p.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((r) => setTimeout(r, 1000));
    return !settled;
  }

  it('a stage save naming the role waits for a deactivate holding it, then refuses it as inactive', async () => {
    const { org, role } = await setup();
    const actor = await user(org, 'Admin');
    const stage = await stageNaming(org, null);
    const deactivate = await holdDeactivating(role);

    const save = refusalOf(templates.updateStage(stage.id, { escalationConfig: [{ afterHours: 8, notifyRoleId: role }] } as never, org, actor));
    expect(await stillWaiting(save)).toBe(true);
    await deactivate.commit();

    expect(await save).toEqual(expect.objectContaining({ code: 'STAGE_ESCALATION_INVALID', reason: 'ROLE' }));
    expect((await prisma.workflowStage.findUniqueOrThrow({ where: { id: stage.id } })).escalationConfig).toEqual([]);
  });

  it('a grant queued behind a deactivate re-reads the role after the lock, and refuses it as inactive', async () => {
    const { org, role } = await setup();
    const actor = await user(org, 'Admin');
    const huda = await user(org, 'Huda');
    const deactivate = await holdDeactivating(role);

    const grant = refusalOf(roles.assignRoleToUser(huda, { roleId: role }, org, actor));
    expect(await stillWaiting(grant)).toBe(true);
    await deactivate.commit();

    expect(await grant).toEqual(expect.objectContaining({ statusCode: 409, code: 'ROLE_INACTIVE' }));
    expect(await prisma.userRole.count({ where: { roleId: role } })).toBe(0);
  });
});
