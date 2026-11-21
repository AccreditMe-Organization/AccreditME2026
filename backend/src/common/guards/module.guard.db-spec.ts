/**
 * ACC-102 — ModuleGuard's one statement against a REAL Postgres (npm run test:db).
 *
 * module.guard.spec.ts proves the decisions with the query stubbed. Only a
 * database can prove the statement itself: the table and column names, the
 * `::text` cast of the PlanModuleAccess enum, the LEFT JOIN when there is no
 * plan or no plan rows, a null settings column, and that the plan is reached
 * only through the caller's own planId.
 *
 * It FAILS, never skips, without a database, and refuses any database that is
 * not on this machine (CI's ephemeral Postgres, or a local throwaway), so it
 * can never write to the shared dev database. Every row it creates is removed
 * in afterAll.
 */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANT_ISOLATION_GATE_STRING } from '../testing/tenant-isolation';
import { ModuleAccessMode, ModuleGuard, RequiredModule } from './module.guard';
import { ModuleRefusalException } from './module-refusal.exception';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

type Level = 'FULL' | 'READ_ONLY' | 'NONE';

describe('ModuleGuard against a real database (ACC-102)', () => {
  const prisma = new PrismaService();
  const run = randomUUID().slice(0, 8);
  const orgIds: string[] = [];
  const planIds: string[] = [];

  /** A plan granting `modules` (moduleKey → level); `{}` is a plan with no rows. */
  async function plan(modules: Record<string, Level>): Promise<string> {
    const created = await prisma.plan.create({
      data: {
        name: `acc102-${run}-${planIds.length}`,
        nameEn: 'ACC-102 test plan',
        nameAr: 'خطة اختبار',
        monthlyPrice: new Prisma.Decimal(0),
        annualPrice: new Prisma.Decimal(0),
        maxStorageGb: 1,
        aiCreditsPerMonth: 0,
        isPublic: false,
        planModules: { create: Object.entries(modules).map(([moduleKey, accessLevel]) => ({ moduleKey, accessLevel })) },
      },
    });
    planIds.push(created.id);
    return created.id;
  }

  async function organisation(planId: string | null, settings: Prisma.InputJsonValue | typeof Prisma.DbNull): Promise<string> {
    const slug = `acc102-${run}-${orgIds.length}`;
    const org = await prisma.organization.create({ data: { name: slug, slug, country: 'SA', planId, settings } });
    orgIds.push(org.id);
    return org.id;
  }

  /** The real guard's decision for one request: 'allowed' or the refusal code. */
  async function decide(tenantId: string, moduleKey: string, mode: ModuleAccessMode): Promise<string> {
    const required: RequiredModule = { moduleKey, mode };
    const reflector = { get: () => required } as unknown as Reflector;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ tenantId }) }),
      getHandler: () => decide,
    } as unknown as ExecutionContext;
    try {
      await new ModuleGuard(prisma, reflector).canActivate(ctx);
      return 'allowed';
    } catch (err) {
      if (err instanceof ModuleRefusalException) return err.code;
      throw err;
    }
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.planModule.deleteMany({ where: { planId: { in: planIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
    const left =
      (await prisma.organization.count({ where: { id: { in: orgIds } } })) +
      (await prisma.plan.count({ where: { id: { in: planIds } } }));
    await prisma.onModuleDestroy();
    expect(left).toBe(0);
  });

  it('(a) a plan granting FULL, READ_ONLY and NONE: read passes on all but NONE, write only on FULL', async () => {
    const planId = await plan({ docs: 'FULL', standards: 'READ_ONLY', audit: 'NONE' });
    const org = await organisation(planId, { modules: { docs: true, standards: true, audit: true } });

    expect(await decide(org, 'docs', 'read')).toBe('allowed');
    expect(await decide(org, 'docs', 'write')).toBe('allowed');
    expect(await decide(org, 'standards', 'read')).toBe('allowed');
    expect(await decide(org, 'standards', 'write')).toBe('MODULE_READ_ONLY');
    expect(await decide(org, 'audit', 'read')).toBe('MODULE_NOT_ENABLED');
    expect(await decide(org, 'audit', 'write')).toBe('MODULE_NOT_ENABLED');
  });

  it('(b) no plan, module switched on: the FULL fallback (read and write)', async () => {
    const org = await organisation(null, { modules: { docs: true } });
    expect(await decide(org, 'docs', 'read')).toBe('allowed');
    expect(await decide(org, 'docs', 'write')).toBe('allowed');
  });

  it('(c) a plan with no PlanModule rows grants nothing', async () => {
    const org = await organisation(await plan({}), { modules: { docs: true } });
    expect(await decide(org, 'docs', 'read')).toBe('MODULE_NOT_ENABLED');
  });

  it('(d) settings null: MODULE_NOT_ENABLED, no throw', async () => {
    const org = await organisation(null, Prisma.DbNull);
    expect(await decide(org, 'docs', 'read')).toBe('MODULE_NOT_ENABLED');
  });

  it(`(e) ${TENANT_ISOLATION_GATE_STRING} — ModuleGuard never reads another organisation's plan`, async () => {
    // Non-vacuous: the other organisation really is granted the module.
    const other = await organisation(await plan({ docs: 'FULL' }), { modules: { docs: true } });
    expect(await decide(other, 'docs', 'write')).toBe('allowed');

    const caller = await organisation(await plan({ standards: 'FULL' }), { modules: { docs: true } });
    expect(await decide(caller, 'docs', 'read')).toBe('MODULE_NOT_ENABLED');
    expect(await decide(caller, 'docs', 'write')).toBe('MODULE_NOT_ENABLED');
  });
});
