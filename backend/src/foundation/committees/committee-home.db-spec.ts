/**
 * ACC-279 — Home's committee counts against a REAL Postgres (npm run test:db).
 *
 * homeCounts() is one hand-written grouped query, so only a database can prove
 * it counts what committeeListStatus() calls "in force":
 *
 *   - an inactive committee is out;
 *   - DISSOLVING wins over IN_FORCE;
 *   - the NEWEST workflow instance decides the stage;
 *   - below quorum means a quorum above 0 and fewer ACTIVE members than it;
 *   - another organisation's committees, instances and members change nothing.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';
import { CommitteeHomeService } from './committee-home.service';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

describe('Home committee counts against a real database (ACC-279)', () => {
  const prisma = new PrismaService();
  const home = new CommitteeHomeService(prisma, {} as LookupService);

  interface Fixture {
    organizationId: string;
    committee: (
      name: string,
      opts: { quorum?: number; isActive?: boolean; members?: number; departed?: number; stages: ('inForce' | 'formation' | 'dissolving')[] },
    ) => Promise<string>;
  }

  async function fixture(): Promise<Fixture> {
    const slug = `acc279-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${slug}` } });
    const template = await prisma.workflowTemplate.create({
      data: { organizationId: o.id, nameEn: 'Committee (spec)', objectType: 'COMMITTEE', isDefault: true, isActive: true },
    });
    const stage = async (nameEn: string, order: number, flags: string[]) =>
      (await prisma.workflowStage.create({ data: { workflowTemplateId: template.id, nameEn, order, flags } })).id;
    const stages = {
      formation: await stage('Formation (spec)', 10, []),
      inForce: await stage('Active (spec)', 20, ['IN_FORCE']),
      dissolving: await stage('Dissolution Pending (spec)', 30, ['IN_FORCE', 'DISSOLVING']),
    };
    let people = 0;
    const committee: Fixture['committee'] = async (name, opts) => {
      const c = await prisma.committee.create({
        data: {
          organizationId: o.id,
          nameEn: name,
          typeValueId: 'type',
          orgUnitId: unit.id,
          quorumCount: opts.quorum ?? 0,
          isActive: opts.isActive ?? true,
        },
      });
      // One instance per listed stage, oldest first: the LAST is the newest.
      for (const [i, key] of opts.stages.entries()) {
        await prisma.workflowInstance.create({
          data: {
            organizationId: o.id,
            workflowTemplateId: template.id,
            objectType: 'COMMITTEE',
            objectId: c.id,
            status: 'IN_PROGRESS',
            currentStageId: stages[key],
            createdAt: new Date(Date.UTC(2026, 9, 1 + i)),
          },
        });
      }
      const seat = async (active: boolean) => {
        const u = await prisma.user.create({
          data: { organizationId: o.id, email: `${slug}-${people++}@example.test`, name: 'Member', status: 'ACTIVE' },
        });
        await prisma.committeeMember.create({
          data: {
            organizationId: o.id,
            committeeId: c.id,
            userId: u.id,
            roleValueId: 'member',
            isActive: active,
            leftAt: active ? null : new Date(),
          },
        });
      };
      for (let i = 0; i < (opts.members ?? 0); i++) await seat(true);
      for (let i = 0; i < (opts.departed ?? 0); i++) await seat(false);
      return c.id;
    };
    return { organizationId: o.id, committee };
  }

  /** The committees whose counts the tests below assert, in one organisation. */
  async function standardSet(f: Fixture): Promise<void> {
    await f.committee('A in force, 2 of 3', { quorum: 3, members: 2, departed: 1, stages: ['inForce'] }); // in force, below
    await f.committee('B in force, 2 of 2', { quorum: 2, members: 2, stages: ['inForce'] }); // in force
    await f.committee('C in force, no quorum', { quorum: 0, stages: ['inForce'] }); // in force, never below
    await f.committee('D inactive', { quorum: 5, isActive: false, stages: ['inForce'] }); // out
    await f.committee('E formation', { quorum: 5, stages: ['formation'] }); // out
    await f.committee('F dissolving', { quorum: 5, stages: ['dissolving'] }); // out: DISSOLVING wins
    await f.committee('G was in force', { quorum: 0, stages: ['inForce', 'formation'] }); // out: newest wins (quorum 0, so reading the OLDEST would change the below count too)
    await f.committee('H now in force', { quorum: 1, stages: ['formation', 'inForce'] }); // in force, below
    await f.committee('I no instance', { quorum: 5, stages: [] }); // out: no stage
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('counts committees in force by their newest stage, and those below quorum by active members', async () => {
    const f = await fixture();
    await standardSet(f);

    expect(await home.homeCounts(f.organizationId)).toEqual({ inForce: 4, belowQuorum: 2 });
  });

  it('an organisation with no committees reads zero, not an error', async () => {
    const f = await fixture();

    expect(await home.homeCounts(f.organizationId)).toEqual({ inForce: 0, belowQuorum: 0 });
  });

  it('should NOT return records belonging to a different tenant — committee counts', async () => {
    const mine = await fixture();
    await mine.committee('Mine in force', { quorum: 1, members: 1, stages: ['inForce'] });
    const other = await fixture();
    await standardSet(other);

    expect(await home.homeCounts(mine.organizationId)).toEqual({ inForce: 1, belowQuorum: 0 });
    expect(await home.homeCounts(other.organizationId)).toEqual({ inForce: 4, belowQuorum: 2 });
  });
});
