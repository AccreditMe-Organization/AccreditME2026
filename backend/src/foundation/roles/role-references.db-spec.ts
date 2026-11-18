/**
 * ACC-154 — a role can't be deactivated while anything still holds or names
 * it, against a REAL Postgres (npm run test:db).
 *
 * One case per category (a direct user grant, a grant through a head position,
 * a position that gives the role, a workflow stage escalation rule naming it),
 * each refused with 409 ROLE_IN_USE naming that category, and the pre-flight
 * returning the same blockers. The names are capped at 10 with the true count;
 * an unreferenced system role still deactivates; another organisation's rows
 * never count. Only ACTIVE and INVITED users' grants count, and each category's
 * names follow the reader's own permissions (users:view, positions:view,
 * workflows:view), its count never. Fails, never skips, without a local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { RoleService } from './role.service';
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
  const roles = new RoleService(prisma, new AuditLogService(prisma));

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  /** A fresh organisation and one role in it. */
  async function setup(roleKey: string | null = null): Promise<{ org: string; role: string; slug: string }> {
    const slug = `acc154-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const role = (await prisma.role.create({ data: { organizationId: org, key: roleKey, nameEn: `Reviewers ${slug}`, isSystem: roleKey !== null } })).id;
    return { org, role, slug };
  }
  /** Every name permission: the tests about what blocks read every name. */
  const ALL = ['users:view', 'positions:view', 'workflows:view'];
  const user = async (org: string, name: string, status: 'ACTIVE' | 'INACTIVE' | 'INVITED' | 'SUSPENDED' = 'ACTIVE') =>
    (await prisma.user.create({ data: { organizationId: org, email: `${randomUUID()}@example.test`, name, status } })).id;
  const refusal = async (role: string, org: string) =>
    roles.deactivateRole(role, org, 'actor', ALL).then(
      () => null,
      (e: { getResponse?: () => unknown }) => (e.getResponse ? (e.getResponse() as { statusCode: number; code: string; blockers: RoleReferenceBlocker[] }) : e),
    );
  const isActive = async (role: string) => (await prisma.role.findUniqueOrThrow({ where: { id: role } })).isActive;

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
    const refused = await refusal(role, org);
    expect(refused).toEqual(expect.objectContaining({ statusCode: 409, code: 'ROLE_IN_USE' }));
    expect(refused && 'blockers' in refused ? refused.blockers : null).toEqual([{ category: 'USER_GRANTS', count: 2, names: ['Huda', 'Omar'] }]);
    expect(await roles.deactivationCheck(role, org, ALL)).toEqual({ canDeactivate: false, rootRole: false, blockers: [{ category: 'USER_GRANTS', count: 2, names: ['Huda', 'Omar'] }] });
    expect(await isActive(role)).toBe(true);
  });

  it('a grant through a head position blocks it (POSITION_GRANTS)', async () => {
    const { org, role } = await setup();
    const position = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head of Quality', grade: 1 } });
    await prisma.userRole.create({ data: { userId: await user(org, 'Sara'), roleId: role, grantedViaHeadPositionId: position.id } });
    expect((await refusal(role, org)) as unknown).toEqual(
      expect.objectContaining({ code: 'ROLE_IN_USE', blockers: [{ category: 'POSITION_GRANTS', count: 1, names: ['Sara'] }] }),
    );
    expect(await isActive(role)).toBe(true);
  });

  it('a position that gives the role blocks it (POSITIONS)', async () => {
    const { org, role } = await setup();
    await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Quality Lead', grade: 2, roleId: role } });
    expect((await refusal(role, org)) as unknown).toEqual(
      expect.objectContaining({ code: 'ROLE_IN_USE', blockers: [{ category: 'POSITIONS', count: 1, names: ['Quality Lead'] }] }),
    );
    expect(await isActive(role)).toBe(true);
  });

  it('a workflow stage escalation rule naming it blocks it (STAGE_ESCALATIONS)', async () => {
    const { org, role } = await setup();
    const template = await prisma.workflowTemplate.create({ data: { organizationId: org, nameEn: 'Committee', objectType: 'COMMITTEE' } });
    await prisma.workflowStage.create({
      data: { workflowTemplateId: template.id, nameEn: 'Terms Review', order: 1, whoMode: 'ANY_ONE', escalationConfig: [{ afterHours: 8, notifyRoleId: role }] },
    });
    expect((await refusal(role, org)) as unknown).toEqual(
      expect.objectContaining({ code: 'ROLE_IN_USE', blockers: [{ category: 'STAGE_ESCALATIONS', count: 1, names: ['Committee — Terms Review'] }] }),
    );
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
    const template = await prisma.workflowTemplate.create({ data: { organizationId: org, nameEn: 'Committee', objectType: 'COMMITTEE' } });
    await prisma.workflowStage.create({
      data: { workflowTemplateId: template.id, nameEn: 'Terms Review', order: 1, whoMode: 'ANY_ONE', escalationConfig: [{ afterHours: 8, notifyRoleId: role }] },
    });
    const seen = async (permissions: string[]) =>
      (await roles.deactivationCheck(role, org, permissions)).blockers.map((b) => [b.category, b.count, b.names]);

    expect(await seen(['roles:manage'])).toEqual([
      ['USER_GRANTS', 1, []],
      ['POSITION_GRANTS', 1, []],
      ['POSITIONS', 1, []],
      ['STAGE_ESCALATIONS', 1, []],
    ]);
    expect(await seen(['roles:manage', 'users:view'])).toEqual([
      ['USER_GRANTS', 1, ['Huda']],
      ['POSITION_GRANTS', 1, ['Sara']],
      ['POSITIONS', 1, []],
      ['STAGE_ESCALATIONS', 1, []],
    ]);
    expect(await seen(['roles:manage', 'positions:view'])).toEqual([
      ['USER_GRANTS', 1, []],
      ['POSITION_GRANTS', 1, []],
      ['POSITIONS', 1, ['Quality Lead']],
      ['STAGE_ESCALATIONS', 1, []],
    ]);
    expect(await seen(['roles:manage', 'workflows:view'])).toEqual([
      ['USER_GRANTS', 1, []],
      ['POSITION_GRANTS', 1, []],
      ['POSITIONS', 1, []],
      ['STAGE_ESCALATIONS', 1, ['Committee — Terms Review']],
    ]);
    // The refusal carries the same: counts, and only the names the caller may see.
    await expect(roles.deactivateRole(role, org, 'actor', ['roles:manage'])).rejects.toMatchObject({
      response: { code: 'ROLE_IN_USE', blockers: [1, 2, 3, 4].map(() => expect.objectContaining({ count: 1, names: [] })) },
    });
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
      // An administrator holds the root role elsewhere, so the root-role invariant is satisfied.
      expect(await roles.deactivationCheck(role, org, ALL)).toEqual({ canDeactivate: true, rootRole: false, blockers: [] });
      await roles.deactivateRole(role, org, await user(org, 'Admin'), ALL);
      expect(await isActive(role)).toBe(false);
    }
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // A role in organisation A with nothing of its own; organisation B grants its
    // own role, has a position giving it, and a stage rule that even names A's role id.
    const a = await setup();
    const b = await setup();
    await prisma.userRole.create({ data: { userId: await user(b.org, 'Bilal'), roleId: b.role } });
    await prisma.orgPosition.create({ data: { organizationId: b.org, nameEn: 'B position', grade: 1, roleId: b.role } });
    const template = await prisma.workflowTemplate.create({ data: { organizationId: b.org, nameEn: 'B workflow', objectType: 'COMMITTEE' } });
    await prisma.workflowStage.create({
      data: { workflowTemplateId: template.id, nameEn: 'B stage', order: 1, whoMode: 'ANY_ONE', escalationConfig: [{ afterHours: 8, notifyRoleId: a.role }] },
    });
    expect((await roles.deactivationCheck(a.role, a.org, ALL)).blockers).toEqual([]);
    // And A's role asked for under B's organisation is not found at all.
    await expect(roles.deactivationCheck(a.role, b.org, ALL)).rejects.toThrow('Role not found');
    await roles.deactivateRole(a.role, a.org, await user(a.org, 'Admin'), ALL);
    expect(await isActive(a.role)).toBe(false);
  });
});
