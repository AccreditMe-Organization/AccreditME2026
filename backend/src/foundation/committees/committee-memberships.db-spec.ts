/**
 * ACC-295 — one person's committee memberships, against a REAL Postgres (npm run
 * test:db): the rows the read keeps and leaves out, and `mayRemove` from the seeded
 * stage actions through the real StageRulesService (a Dissolved committee's stage
 * allows no member change, ACC-255 Q-A).
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database, and
 * refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { applyWorkflowSeed } from '../workflow/workflow-seed-apply';
import { SYSTEM_WORKFLOW_SEED } from '../workflow/workflow.seed';
import { CommitteeMembershipsService } from './committee-memberships.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
const CR_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE_CHANGE_REQUEST')!;
const VIEWER = { permissions: ['committees:view', 'users:view'] };

describe('One person’s committee memberships, on a real database (ACC-295)', () => {
  const prisma = new PrismaService();
  // The seats are not what this spec is about: none are seeded, so every seat has null labels.
  const lookups = { getValues: () => Promise.resolve([]) } as unknown as LookupService;
  const service = new CommitteeMembershipsService(prisma, lookups, new StageRulesService(prisma));

  async function org(tag: string) {
    const slug = `acc295-${tag}-${randomUUID().slice(0, 8)}`;
    const id = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    await applyWorkflowSeed(prisma, id, [COMMITTEE_SEED, CR_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: id, objectType: 'COMMITTEE', isDefault: true } });
    const stageId = async (key: string) => (await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } })).id;
    const unit = (await prisma.orgUnit.create({ data: { organizationId: id, nameEn: 'Quality', code: `Q-${slug}` } })).id;
    const user = (await prisma.user.create({ data: { organizationId: id, email: `${slug}@example.test`, name: 'Person', status: 'ACTIVE' } })).id;
    /** A committee, in `stageKey` (or with no workflow instance), with `user` seated. */
    const committee = async (name: string, opts: { stageKey?: string; active?: boolean; seatActive?: boolean; joinedAt?: string } = {}) => {
      const c = (
        await prisma.committee.create({
          data: { organizationId: id, nameEn: name, typeValueId: 'type', orgUnitId: unit, isActive: opts.active ?? true },
        })
      ).id;
      if (opts.stageKey) {
        await prisma.workflowInstance.create({
          data: { organizationId: id, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: c, status: 'IN_PROGRESS', currentStageId: await stageId(opts.stageKey) },
        });
      }
      const seatActive = opts.seatActive ?? true;
      const member = await prisma.committeeMember.create({
        data: {
          organizationId: id,
          committeeId: c,
          userId: user,
          roleValueId: 'seat-member',
          isActive: seatActive,
          joinedAt: new Date(opts.joinedAt ?? '2026-01-01T00:00:00Z'),
          ...(seatActive ? {} : { leftAt: new Date() }),
        },
      });
      return { committee: c, member: member.id };
    };
    return { id, user, committee };
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('keeps active seats on active committees, leaves out the rest, and says where a remove is allowed', async () => {
    const a = await org('a');
    const active = await a.committee('Active committee', { stageKey: 'active', joinedAt: '2026-01-01T00:00:00Z' });
    const dissolved = await a.committee('Dissolved committee', { stageKey: 'dissolved', joinedAt: '2026-02-01T00:00:00Z' });
    const noStage = await a.committee('No workflow yet', { joinedAt: '2026-03-01T00:00:00Z' });
    await a.committee('Inactive committee', { stageKey: 'active', active: false });
    await a.committee('Left the seat', { stageKey: 'active', seatActive: false });

    const result = await service.forUser(a.id, VIEWER, a.user);

    expect(result.total).toBe(3);
    expect(result.rows.map((r) => r.nameEn)).toEqual(['Active committee', 'Dissolved committee', 'No workflow yet']);
    expect(result.rows.map((r) => r.memberId)).toEqual([active.member, dissolved.member, noStage.member]);
    expect(result.rows.map((r) => [r.stage.nameEn, r.mayRemove])).toEqual([
      ['Active', true],
      ['Dissolved', false],
      [null, false],
    ]);
  });

  it('should NOT return records belonging to a different tenant', async () => {
    const a = await org('a');
    const b = await org('b');
    await b.committee('Organisation B committee', { stageKey: 'active' });

    // B's person, asked about from A: nothing, and no 404 that would say they exist.
    expect(await service.forUser(a.id, VIEWER, b.user)).toEqual({ total: 0, rows: [] });
    // An invented id: the same answer.
    expect(await service.forUser(a.id, VIEWER, 'no-such-user')).toEqual({ total: 0, rows: [] });
    // From B, the same person's seat is there: the empty answer above is the scoping.
    expect((await service.forUser(b.id, VIEWER, b.user)).total).toBe(1);
  });
});
