/**
 * ACC-244 — the retire script (prisma/backfill-acc244-retire-flat-task-keys.ts),
 * planned and applied against a REAL Postgres (npm run test:db).
 *
 * What it must do: remove every grant of the four flat task keys in the
 * organisations in scope, one audit row per revocation, nothing else of any
 * role; delete a catalogue row only once nothing references it; report each
 * user's visible-task count by the rule, unchanged by the revocation; refuse
 * --execute for a customer organisation, a transition gated on a retired key,
 * or a count that would change; and a second run plans and writes nothing.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskVisibilityService } from '../task/task-visibility.service';
import {
  applyRetirement,
  BACKFILL_TX,
  planRetirement,
  refusals,
  RetirePlan,
  RETIRED_KEYS,
  SCRIPT_NAME,
} from '../../../prisma/backfill-acc244-retire-flat-task-keys';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

const [OLD_VIEW, OLD_CREATE, OLD_REASSIGN, OLD_MANAGE] = RETIRED_KEYS as [string, string, string, string];
const SEE = 'committees:view';
const VIEW_ALL = 'committees:view_all_tasks';

describe('backfill:acc244-retire-flat-task-keys, on a real database (ACC-244)', () => {
  const prisma = new PrismaService();
  const visibility = new TaskVisibilityService(prisma, new TaskAuthorityService(prisma));
  let A = '';
  let C = '';
  let slugA = '';
  const role: Record<string, string> = {};
  const user: Record<string, string> = {};

  async function held(roleId: string): Promise<string[]> {
    const rows = await prisma.rolePermission.findMany({ where: { roleId }, select: { permission: { select: { module: true, action: true } } } });
    return rows.map((r) => `${r.permission.module}:${r.permission.action}`).sort();
  }

  async function permissionId(key: string): Promise<string> {
    const [module, action] = key.split(':') as [string, string];
    return (await prisma.permission.upsert({ where: { module_action: { module, action } }, update: {}, create: { module, action, description: key } })).id;
  }

  async function seedRole(organizationId: string, key: string | null, keys: string[]): Promise<string> {
    const id = (
      await prisma.role.create({ data: { organizationId, key, nameEn: `${key ?? 'Custom'} ${randomUUID().slice(0, 4)}`, isSystem: key !== null } as never })
    ).id;
    for (const k of keys) await prisma.rolePermission.create({ data: { roleId: id, permissionId: await permissionId(k) } });
    return id;
  }

  async function person(key: string, organizationId: string, roleId: string): Promise<string> {
    const id = (
      await prisma.user.create({ data: { organizationId, email: `${slugA}-${key}@example.test`, name: key, status: 'ACTIVE' } })
    ).id;
    await prisma.userRole.create({ data: { userId: id, roleId } as never });
    return (user[key] = id);
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    slugA = `acc244r-${randomUUID().slice(0, 8)}`;
    A = (await prisma.organization.create({ data: { name: slugA, slug: slugA, country: 'SA' } })).id;
    C = (await prisma.organization.create({ data: { name: `${slugA}-c`, slug: `${slugA}-c`, country: 'SA' } })).id;

    // A: an organisation seeded before ACC-244 PR 2, already granted the new keys by PR 1.
    role['QM'] = await seedRole(A, 'QUALITY_MANAGER', [...RETIRED_KEYS, SEE, VIEW_ALL]);
    // A role that held only the flat key: it reached no task under PR 2's rule.
    role['VIEWER'] = await seedRole(A, 'VIEWER', [OLD_VIEW, SEE]);
    // A custom role is in scope too.
    role['CUSTOM'] = await seedRole(A, null, [OLD_CREATE, 'workflows:view']);
    // C still holds a flat key, outside the first run's scope.
    role['C:QM'] = await seedRole(C, 'QUALITY_MANAGER', [OLD_VIEW, SEE]);
    // The tasks' creator holds nothing, so the others' counts are their own keys'.
    role['NONE'] = await seedRole(A, null, []);

    const unit = (await prisma.orgUnit.create({ data: { organizationId: A, nameEn: 'Root', code: `R${slugA.slice(-6)}`.toUpperCase() } })).id;
    const committee = (await prisma.committee.create({ data: { organizationId: A, nameEn: 'C', typeValueId: 'type', orgUnitId: unit } })).id;
    await person('creator', A, role['NONE']!);
    await person('qm', A, role['QM']!);
    await person('viewer', A, role['VIEWER']!);
    await person('assignee', A, role['VIEWER']!);
    await person('custom', A, role['CUSTOM']!);
    for (let i = 0; i < 3; i++) {
      const t = await prisma.task.create({
        data: { organizationId: A, createdById: user['creator']!, sourceType: 'COMMITTEE', sourceId: committee, title: `T${i}`, status: 'PENDING' } as never,
      });
      if (i === 0) await prisma.taskAssignee.create({ data: { taskId: t.id, userId: user['assignee']!, assignedById: user['creator']! } });
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("plans the revocations and each user's count by the rule, unchanged; refuses --execute for a customer", async () => {
    const plan = await planRetirement(prisma, visibility, { onlyOrganizationIds: [A] });
    const label = (roleId: string) => Object.entries(role).find(([, id]) => id === roleId)![0];
    expect(plan.revocations.map((r) => `${label(r.roleId)} ${r.permission}`).sort()).toEqual(
      [
        `QM ${OLD_VIEW}`, `QM ${OLD_CREATE}`, `QM ${OLD_REASSIGN}`, `QM ${OLD_MANAGE}`,
        `VIEWER ${OLD_VIEW}`,
        `CUSTOM ${OLD_CREATE}`,
      ].sort(),
    );
    expect(plan.revocations.every((r) => r.organizationId === A)).toBe(true);

    // Non-vacuity first: View all reaches every task, a relationship one, the flat key none.
    const count = Object.fromEntries(plan.users.map((u) => [u.name, [u.before, u.after]]));
    expect(count).toEqual({ assignee: [1, 1], creator: [3, 3], custom: [0, 0], qm: [3, 3], viewer: [0, 0] });

    // A spec-made organisation has no fixture slug, so it counts as a customer.
    expect(refusals(plan)).toEqual([expect.stringContaining(`${slugA}: a customer organisation holds a retired key`)]);
  });

  it('refuses a transition gated on a retired key, and a count the revocation would change', () => {
    const base: RetirePlan = { organizations: [], revocations: [], gatedTransitions: [], catalogue: [], users: [] };
    expect(refusals(base)).toEqual([]);
    expect(
      refusals({ ...base, gatedTransitions: [{ slug: 'al-x', transitionId: 'tr-1', labelEn: 'Approve', permission: OLD_MANAGE }] }),
    ).toEqual([`al-x: transition "Approve" (tr-1) is gated on ${OLD_MANAGE}.`]);
    expect(refusals({ ...base, users: [{ slug: 'al-x', userId: 'u', name: 'Huda', before: 4, after: 0 }] })).toEqual([
      'al-x: Huda would see 4 → 0 tasks — the rule still reads a retired key.',
    ]);
  });

  it('applies in ONE transaction with one audit row per revocation, keeps every other key, and a re-run is empty', async () => {
    const before = Object.fromEntries(await Promise.all(Object.entries(role).map(async ([k, id]) => [k, await held(id)])));
    const plan = await planRetirement(prisma, visibility, { onlyOrganizationIds: [A] });
    const auditBefore = await prisma.auditLog.count({ where: { organizationId: A } });

    const tx = jest.spyOn(prisma, '$transaction');
    const result = await applyRetirement(prisma, plan);
    expect(tx).toHaveBeenCalledTimes(1);
    expect(tx).toHaveBeenCalledWith(expect.any(Function), BACKFILL_TX);
    tx.mockRestore();
    expect(result.revoked).toBe(6);
    // C still holds tasks:view, so its catalogue row stays.
    expect(result.catalogueDeleted).not.toContain(OLD_VIEW);
    expect(await prisma.permission.count({ where: { module: 'tasks', action: 'view' } })).toBe(1);

    const audits = await prisma.auditLog.findMany({ where: { organizationId: A }, orderBy: { createdAt: 'asc' } });
    expect(audits).toHaveLength(auditBefore + 6);
    for (const a of audits.slice(auditBefore)) {
      expect(a).toMatchObject({ action: 'DELETE', objectType: 'RolePermission', actorId: null, metadata: expect.objectContaining({ source: SCRIPT_NAME }) });
      expect(RETIRED_KEYS).toContain((a.before as { permission: string }).permission);
      expect(await prisma.rolePermission.findUnique({ where: { id: a.objectId! } })).toBeNull();
    }

    // Exactly the flat keys went; everything else each role held stayed. C is untouched.
    for (const [k, id] of Object.entries(role)) {
      const expected = k.startsWith('C:') ? before[k] : before[k].filter((p: string) => !RETIRED_KEYS.includes(p));
      expect({ role: k, keys: await held(id) }).toEqual({ role: k, keys: expected });
    }

    // Idempotent.
    const again = await planRetirement(prisma, visibility, { onlyOrganizationIds: [A] });
    expect(again.revocations).toEqual([]);
    expect((await applyRetirement(prisma, again)).revoked).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: A } })).toBe(auditBefore + 6);
  });

  it('deletes each catalogue row once nothing references it', async () => {
    // Every organisation in this local database still holding one: C, and
    // whatever other db-specs left behind.
    const holding = await prisma.rolePermission.findMany({
      where: { permission: { module: 'tasks', action: { in: ['view', 'create', 'reassign', 'manage'] } } },
      select: { role: { select: { organizationId: true } } },
    });
    const orgs = [...new Set(holding.map((h) => h.role.organizationId))];
    expect(orgs).toContain(C);
    const plan = await planRetirement(prisma, visibility, { onlyOrganizationIds: orgs });
    const result = await applyRetirement(prisma, plan);
    expect(result.catalogueDeleted).toContain(OLD_VIEW);
    expect(await prisma.permission.count({ where: { module: 'tasks', action: { in: ['view', 'create', 'reassign', 'manage'] } } })).toBe(0);
    expect(await held(role['C:QM']!)).toEqual([SEE]);
    expect((await planRetirement(prisma, visibility, { onlyOrganizationIds: [C] })).catalogue).toEqual([]);
  });
});
