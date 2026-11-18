/**
 * ACC-86 / ACC-216 — "ON A TASK" IN PRISMA AND IN SQL SELECT THE SAME ROWS, against a
 * REAL Postgres (npm run test:db).
 *
 * task-pool.ts states the one definition twice, because some readers are Prisma
 * where-clauses and some are raw SQL:
 *   - CURRENT_ACTIVE_ASSIGNEE      ↔ HAS_CURRENT_ACTIVE_ASSIGNEE_SQL   (anyone on it)
 *   - currentActiveAssigneeOf(u)   ↔ currentActiveAssigneeOfSql(u)     (this person on it)
 * This spec pins each pair to each other on real rows: a current row of an ACTIVE
 * user, a current row of a user no longer ACTIVE, an ended row, a task nobody is
 * on, a task shared by both, and another organisation's task naming the same user.
 *
 * Fails, never skips, without a local database, and refuses any database that is
 * not on this machine (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CURRENT_ACTIVE_ASSIGNEE,
  HAS_CURRENT_ACTIVE_ASSIGNEE_SQL,
  currentActiveAssigneeOf,
  currentActiveAssigneeOfSql,
} from './task-pool';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

describe('"On a task": the Prisma and SQL forms select the same rows (ACC-86, ACC-216)', () => {
  const prisma = new PrismaService();
  let org = '';
  let otherOrg = '';
  const u = { active: '', gone: '', creator: '' };
  const t: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc86p-${randomUUID().slice(0, 8)}`;
    org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    otherOrg = (await prisma.organization.create({ data: { name: `${slug}-b`, slug: `${slug}-b`, country: 'SA' } })).id;
    const user = async (key: string, status: 'ACTIVE' | 'INACTIVE', o = org) =>
      (await prisma.user.create({ data: { organizationId: o, email: `${slug}-${key}@example.test`, name: key, status } })).id;
    u.active = await user('active', 'ACTIVE');
    u.gone = await user('gone', 'INACTIVE');
    u.creator = await user('creator', 'ACTIVE');

    const task = async (key: string, rows: { userId: string; removedAt?: Date }[], o = org, createdById = u.creator) => {
      const id = (
        await prisma.task.create({
          data: { organizationId: o, createdById, sourceType: 'COMMITTEE', sourceId: `rec-${key}`, title: key, status: 'PENDING' },
        })
      ).id;
      for (const r of rows) await prisma.taskAssignee.create({ data: { taskId: id, assignedById: createdById, ...r } });
      t[key] = id;
    };
    await task('activeOn', [{ userId: u.active }]); // the active person is on it
    await task('goneLeftover', [{ userId: u.gone }]); // a leftover current row: nobody is on it
    await task('ended', [{ userId: u.active, removedAt: new Date() }]); // an ended row: nobody
    await task('nobody', []); // no rows at all
    await task('shared', [{ userId: u.active }, { userId: u.gone }]); // the active one counts
    // Another organisation's task with a row naming the SAME user id.
    const foreignCreator = await user('foreign', 'ACTIVE', otherOrg);
    await task('foreign', [{ userId: u.active }], otherOrg, foreignCreator);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const sorted = (ids: string[]) => [...ids].sort();
  async function prismaOf(where: object): Promise<string[]> {
    const rows = await prisma.task.findMany({ where: { organizationId: org, assignees: { some: where } }, select: { id: true } });
    return sorted(rows.map((r) => r.id));
  }
  async function sqlOf(condition: ReturnType<typeof currentActiveAssigneeOfSql>): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT t.id FROM "Task" t WHERE t."organizationId" = ${org} AND ${condition}`;
    return sorted(rows.map((r) => r.id));
  }

  it('anyone on it: CURRENT_ACTIVE_ASSIGNEE and HAS_CURRENT_ACTIVE_ASSIGNEE_SQL select the same tasks', async () => {
    const viaPrisma = await prismaOf(CURRENT_ACTIVE_ASSIGNEE);
    const viaSql = await sqlOf(HAS_CURRENT_ACTIVE_ASSIGNEE_SQL);
    // Non-vacuity: the definition admits some tasks and refuses others.
    expect(viaPrisma).toEqual(sorted([t['activeOn']!, t['shared']!]));
    expect(viaSql).toEqual(viaPrisma);
  });

  for (const who of ['active', 'gone', 'creator'] as const) {
    it(`this person on it (${who}): currentActiveAssigneeOf and currentActiveAssigneeOfSql select the same tasks`, async () => {
      const viaPrisma = await prismaOf(currentActiveAssigneeOf(u[who]));
      const viaSql = await sqlOf(currentActiveAssigneeOfSql(u[who]));
      expect(viaSql).toEqual(viaPrisma);
      // Non-vacuity: the active person is on two tasks; the deactivated one, whose
      // current rows exist, is on none; the creator holds no row.
      const expected = { active: [t['activeOn']!, t['shared']!], gone: [], creator: [] }[who];
      expect(viaPrisma).toEqual(sorted(expected));
    });
  }

  it('the deactivated person\'s leftover rows exist, so their empty result is the ACTIVE rule', async () => {
    const leftover = await prisma.taskAssignee.count({ where: { userId: u.gone, removedAt: null } });
    expect(leftover).toBe(2);
  });

  it('should NOT return records belonging to a different tenant: another organisation\'s task naming the same user is in neither form', async () => {
    const foreign = t['foreign']!;
    expect(await prisma.taskAssignee.count({ where: { taskId: foreign, userId: u.active } })).toBe(1); // non-vacuity
    expect(await prismaOf(currentActiveAssigneeOf(u.active))).not.toContain(foreign);
    expect(await sqlOf(currentActiveAssigneeOfSql(u.active))).not.toContain(foreign);
    expect(await sqlOf(HAS_CURRENT_ACTIVE_ASSIGNEE_SQL)).not.toContain(foreign);
  });
});
