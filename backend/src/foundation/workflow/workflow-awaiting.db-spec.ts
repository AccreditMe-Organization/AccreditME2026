/**
 * ACC-271 — Home's "Awaiting my action" (GET /workflows/awaiting-me) against a
 * REAL Postgres (npm run test:db), on the seeded committee workflow.
 *
 * Only a database proves the query and the pools together:
 *   - a pool member sees a committee in Terms Review; not an Active committee
 *     (no person's way back), not a final stage, not an entry they already
 *     voted on;
 *   - the acting user sees it for someone away, and the absent person does not;
 *   - someone without committees:view sees nothing;
 *   - another organisation's records never appear, even one whose stage names
 *     this viewer's id;
 *   - total counts past five while rows stop at five.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { StagePoolService } from './stage-pool.service';
import { WorkflowAwaitingService } from './workflow-awaiting.service';
import { applyWorkflowSeed } from './workflow-seed-apply';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
const VIEW = ['committees:view'];
const DAY = 86_400_000;

describe('Awaiting my action, against a real database (ACC-271)', () => {
  const prisma = new PrismaService();
  const awaiting = new WorkflowAwaitingService(prisma, new StagePoolService(prisma));

  interface Org {
    id: string;
    templateId: string;
    person: (name: string, extra?: Record<string, unknown>) => Promise<string>;
    /** Makes the seeded stage `key` worked by exactly these people. */
    workedBy: (key: string, whoMode: 'ANY_ONE' | 'ALL' | 'COMMITTEE_VOTE', userIds: string[]) => Promise<void>;
    /** A committee sitting in the seeded stage `key`, entered at `enteredAt`. */
    committeeAt: (key: string, enteredAt?: Date) => Promise<{ id: string; entryId: string }>;
  }

  async function org(): Promise<Org> {
    const slug = `acc271aw-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const roleKeys = new Set<string>(['TENANT_ADMIN']);
    for (const key of roleKeys) await prisma.role.create({ data: { organizationId: o.id, key, nameEn: key, isSystem: true } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Quality', code: `Q-${slug}` } });
    let n = 0;
    const person = async (name: string, extra: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-${n++}@example.test`, name, status: 'ACTIVE', ...extra } })).id;
    const workedBy = async (key: string, whoMode: 'ANY_ONE' | 'ALL' | 'COMMITTEE_VOTE', userIds: string[]) => {
      const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
      await prisma.workflowStage.update({ where: { id: stage.id }, data: { whoMode } });
      await prisma.workflowStageAssignee.deleteMany({ where: { stageId: stage.id } });
      let order = 0;
      for (const userId of userIds) {
        await prisma.workflowStageAssignee.create({ data: { organizationId: o.id, stageId: stage.id, order: ++order, kind: 'SPECIFIC_USER', userId } });
      }
    };
    let c = 0;
    const committeeAt = async (key: string, enteredAt = new Date()) => {
      const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
      const committee = await prisma.committee.create({
        data: { organizationId: o.id, nameEn: `${slug} committee ${++c}`, typeValueId: 'type', orgUnitId: unit.id, quorumCount: 1, meetingFrequency: 'MONTHLY' },
      });
      const instance = await prisma.workflowInstance.create({
        data: { organizationId: o.id, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: committee.id, status: 'IN_PROGRESS', currentStageId: stage.id },
      });
      const entry = await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id, enteredAt } });
      return { id: committee.id, entryId: entry.id };
    };
    return { id: o.id, templateId: template.id, person, workedBy, committeeAt };
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('a pool member sees a committee in Terms Review, named, at its place among the seeded stages', async () => {
    const o = await org();
    const member = await o.person('Member');
    await o.workedBy('terms_review', 'ANY_ONE', [member]);
    const c = await o.committeeAt('terms_review');

    const result = await awaiting.awaitingMe(o.id, member, VIEW);

    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      instanceStageId: c.entryId,
      record: { type: 'COMMITTEE', id: c.id },
      stage: { nameEn: 'Terms Review', position: 2, stageCount: COMMITTEE_SEED.stages.length },
    });
  });

  it('not an Active committee, not a final stage, and not an entry the viewer already voted on', async () => {
    const o = await org();
    const member = await o.person('Member');
    const other = await o.person('Other member');
    await o.workedBy('active', 'ANY_ONE', [member]);
    await o.workedBy('dissolved', 'ANY_ONE', [member]);
    await o.workedBy('terms_review', 'ALL', [member, other]);
    await o.committeeAt('active');
    await o.committeeAt('dissolved');
    const voted = await o.committeeAt('terms_review');
    await prisma.workflowApproval.create({ data: { workflowInstanceStageId: voted.entryId, approverId: member, decision: 'APPROVED', decidedAt: new Date() } });

    expect(await awaiting.awaitingMe(o.id, member, VIEW)).toEqual({ total: 0, rows: [] });
    // The other member has not voted yet: it waits on them.
    expect((await awaiting.awaitingMe(o.id, other, VIEW)).rows.map((r) => r.instanceStageId)).toEqual([voted.entryId]);
  });

  it('the acting user sees it for someone away, and the absent person does not', async () => {
    const o = await org();
    const acting = await o.person('Acting');
    const now = Date.now();
    const absent = await o.person('Away', { outOfOfficeFrom: new Date(now - DAY), outOfOfficeTo: new Date(now + DAY), actingUserId: acting });
    await o.workedBy('terms_review', 'ANY_ONE', [absent]);
    const c = await o.committeeAt('terms_review');

    expect((await awaiting.awaitingMe(o.id, acting, VIEW)).rows.map((r) => r.instanceStageId)).toEqual([c.entryId]);
    expect((await awaiting.awaitingMe(o.id, absent, VIEW)).total).toBe(0);
  });

  it('someone without committees:view sees nothing', async () => {
    const o = await org();
    const member = await o.person('Member');
    await o.workedBy('terms_review', 'ANY_ONE', [member]);
    await o.committeeAt('terms_review');

    expect(await awaiting.awaitingMe(o.id, member, ['users:view'])).toEqual({ total: 0, rows: [] });
  });

  itEnforcesTenantIsolation("GET /workflows/awaiting-me — another organisation's records never appear, even one whose stage names this viewer", async () => {
    const a = await org();
    const b = await org();
    const viewer = await a.person('Viewer');
    await a.workedBy('terms_review', 'ANY_ONE', [viewer]);
    const mine = await a.committeeAt('terms_review');
    // Organisation B's stage names A's viewer by id: it must still never reach A.
    await b.workedBy('terms_review', 'ANY_ONE', [viewer]);
    await b.committeeAt('terms_review');

    const result = await awaiting.awaitingMe(a.id, viewer, VIEW);
    expect(result.total).toBe(1);
    expect(result.rows.map((r) => r.instanceStageId)).toEqual([mine.entryId]);
    expect(await awaiting.awaitingMe(b.id, viewer, VIEW)).toEqual({ total: 0, rows: [] });
  });

  it('oldest first; total counts past five while rows stop at five', async () => {
    const o = await org();
    const member = await o.person('Member');
    await o.workedBy('terms_review', 'ANY_ONE', [member]);
    const base = Date.now() - 30 * DAY;
    const entries: string[] = [];
    for (let i = 6; i >= 0; i--) entries[i] = (await o.committeeAt('terms_review', new Date(base + i * DAY))).entryId;

    const result = await awaiting.awaitingMe(o.id, member, VIEW);

    expect(result.total).toBe(7);
    expect(result.rows.map((r) => r.instanceStageId)).toEqual(entries.slice(0, 5));
  });
});
