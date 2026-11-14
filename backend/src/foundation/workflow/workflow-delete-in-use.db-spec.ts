/**
 * ACC-191 — removing a stage, a transition or a transition action that a record
 * has used, against a REAL Postgres (npm run test:db). Plan:
 * backend/Plans/step-57-191-202-workflow-checks.md.
 *
 * Before ACC-191 each of these reached a RESTRICT foreign key and came back as
 * a 500 (Prisma's P2003). Only a database proves:
 *
 *   - each is refused with its code and a count, and nothing is deleted;
 *   - the count is of RECORDS for a stage (one that came back through it counts
 *     once) and of RUNS for an action or a transition (Q5);
 *   - the count is made under the row lock, inside the delete's transaction:
 *     a reference written by another transaction that has not committed yet
 *     makes the delete WAIT, then be refused — never a P2003 when it commits;
 *   - another organisation's stage, transition or action is the same 404.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { HttpException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { WorkflowTemplateService } from './workflow-template.service';
import type { TaskService } from '../task/task.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

describe('Removing what a record has used, against a real database (ACC-191)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const templates = new WorkflowTemplateService(prisma, audit, new StageTaskDefinitionService(prisma, audit, {} as TaskService));

  /** The refusal's status, code and body, or undefined when it did not throw. Anything else (a P2003) rethrows, failing the test. */
  async function refusal(p: Promise<unknown>): Promise<Record<string, unknown> | undefined> {
    try {
      await p;
      return undefined;
    } catch (e) {
      if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as Record<string, unknown>) };
      throw e;
    }
  }

  /**
   * An organisation with a committee workflow: Formation (start) → Terms Review
   * (Submit, with a LOG_AUDIT action), an unused stage Spare with nothing in or
   * out, and an unused move Formation → Spare with one action.
   */
  async function org() {
    const slug = `acc191-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const admin = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-admin@example.test`, name: 'Hessa', status: 'ACTIVE' } });
    const template = await prisma.workflowTemplate.create({
      data: { organizationId: o.id, nameEn: 'Committee Management', nameAr: 'إدارة اللجان', objectType: 'COMMITTEE', isDefault: true, isActive: true },
    });
    const stage = (nameEn: string, order: number, isInitial = false) =>
      prisma.workflowStage.create({ data: { workflowTemplateId: template.id, nameEn, nameAr: nameEn, order, whoMode: 'ANY_ONE', isInitial } });
    const formation = await stage('Formation', 10, true);
    const review = await stage('Terms Review', 20);
    const spare = await stage('Spare', 30);
    const loose = await stage('Loose', 40);
    const submit = await prisma.workflowTransition.create({
      data: { fromStageId: formation.id, toStageId: review.id, labelEn: 'Submit', labelAr: 'إرسال', mover: 'PERSON' },
    });
    const submitAction = await prisma.workflowTransitionAction.create({ data: { workflowTransitionId: submit.id, actionType: 'LOG_AUDIT', order: 10 } });
    const unused = await prisma.workflowTransition.create({
      data: { fromStageId: formation.id, toStageId: spare.id, labelEn: 'Park', labelAr: 'تأجيل', mover: 'PERSON' },
    });
    const unusedAction = await prisma.workflowTransitionAction.create({ data: { workflowTransitionId: unused.id, actionType: 'SEND_NOTIFICATION', order: 10 } });
    return { id: o.id, admin: admin.id, template: template.id, formation: formation.id, review: review.id, spare: spare.id, loose: loose.id, submit: submit.id, submitAction: submitAction.id, unused: unused.id, unusedAction: unusedAction.id };
  }

  type Org = Awaited<ReturnType<typeof org>>;
  const instance = (o: Org, objectId: string) =>
    prisma.workflowInstance.create({ data: { organizationId: o.id, workflowTemplateId: o.template, objectType: 'COMMITTEE', objectId, status: 'IN_PROGRESS' } });
  const entry = (instanceId: string, stageId: string) => prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instanceId, stageId } });
  const run = (o: Org, actionId: string, instanceId: string) =>
    prisma.workflowActionLog.create({ data: { organizationId: o.id, workflowTransitionActionId: actionId, workflowInstanceId: instanceId, actionType: 'LOG_AUDIT' } });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('a stage', () => {
    it('one records have entered is refused 409 STAGE_IN_USE, counting records once each, and kept', async () => {
      const o = await org();
      // Record 1 entered Loose twice (it came back); record 2 once.
      const one = await instance(o, 'committee-1');
      await entry(one.id, o.loose);
      await entry(one.id, o.loose);
      const two = await instance(o, 'committee-2');
      await entry(two.id, o.loose);

      expect(await refusal(templates.removeStage(o.loose, o.id, o.admin))).toMatchObject({ status: 409, code: 'STAGE_IN_USE', recordCount: 2 });
      expect(await prisma.workflowStage.count({ where: { id: o.loose } })).toBe(1);
    });

    it('one with transitions in or out is refused 409 STAGE_HAS_TRANSITIONS, with the count (Q4)', async () => {
      const o = await org();
      expect(await refusal(templates.removeStage(o.spare, o.id, o.admin))).toMatchObject({ status: 409, code: 'STAGE_HAS_TRANSITIONS', transitionCount: 1 });
    });

    it('one nothing has used is removed', async () => {
      const o = await org();
      await templates.removeStage(o.loose, o.id, o.admin);
      expect(await prisma.workflowStage.count({ where: { id: o.loose } })).toBe(0);
    });

    it("another organisation's stage is the same 404, and is not touched", async () => {
      const mine = await org();
      const theirs = await org();
      await expect(templates.removeStage(theirs.loose, mine.id, mine.admin)).rejects.toMatchObject({ status: 404 });
      expect(await prisma.workflowStage.count({ where: { id: theirs.loose } })).toBe(1);
    });

    // The lock, proved: a record entering the stage in a transaction that has
    // not committed holds a key-share lock on the stage row. The delete's
    // FOR UPDATE waits for it, then counts the committed entry and refuses.
    // Without the lock, the count sees nothing, the delete waits on the
    // foreign key instead, and fails with P2003 once the entry commits.
    it('waits for a record entering it at that moment, then refuses rather than failing', async () => {
      const o = await org();
      const one = await instance(o, 'committee-1');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let entered!: () => void;
      const inside = new Promise<void>((r) => (entered = r));
      const entering = prisma.$transaction(
        async (tx) => {
          await tx.workflowInstanceStage.create({ data: { workflowInstanceId: one.id, stageId: o.loose } });
          entered();
          await gate;
        },
        { timeout: 30_000 },
      );
      await inside;
      const removal = refusal(templates.removeStage(o.loose, o.id, o.admin));
      await new Promise((r) => setTimeout(r, 500));
      release();
      await entering;
      expect(await removal).toMatchObject({ code: 'STAGE_IN_USE', recordCount: 1 });
    });
  });

  describe('a transition action', () => {
    it('one that has run is refused 409 TRANSITION_ACTION_IN_USE with its runs, and kept; an unused one is removed', async () => {
      const o = await org();
      const one = await instance(o, 'committee-1');
      for (let i = 0; i < 3; i++) await run(o, o.submitAction, one.id);

      expect(await refusal(templates.removeTransitionAction(o.submitAction, o.id, o.admin))).toMatchObject({
        status: 409,
        code: 'TRANSITION_ACTION_IN_USE',
        runCount: 3,
      });
      expect(await prisma.workflowTransitionAction.count({ where: { id: o.submitAction } })).toBe(1);

      await templates.removeTransitionAction(o.unusedAction, o.id, o.admin);
      expect(await prisma.workflowTransitionAction.count({ where: { id: o.unusedAction } })).toBe(0);
    });

    it('waits for a run being logged at that moment, then refuses rather than failing', async () => {
      const o = await org();
      const one = await instance(o, 'committee-1');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let logged!: () => void;
      const inside = new Promise<void>((r) => (logged = r));
      const logging = prisma.$transaction(
        async (tx) => {
          await tx.workflowActionLog.create({
            data: { organizationId: o.id, workflowTransitionActionId: o.unusedAction, workflowInstanceId: one.id, actionType: 'SEND_NOTIFICATION' },
          });
          logged();
          await gate;
        },
        { timeout: 30_000 },
      );
      await inside;
      const removal = refusal(templates.removeTransitionAction(o.unusedAction, o.id, o.admin));
      await new Promise((r) => setTimeout(r, 500));
      release();
      await logging;
      expect(await removal).toMatchObject({ code: 'TRANSITION_ACTION_IN_USE', runCount: 1 });
    });

    it("another organisation's action is the same 404", async () => {
      const mine = await org();
      const theirs = await org();
      await expect(templates.removeTransitionAction(theirs.unusedAction, mine.id, mine.admin)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('a transition (Q3)', () => {
    it('one whose actions have run is refused 409 TRANSITION_IN_USE with the runs, keeping it and its actions; an unused one goes with its actions', async () => {
      const o = await org();
      const one = await instance(o, 'committee-1');
      const two = await instance(o, 'committee-2');
      await run(o, o.submitAction, one.id);
      await run(o, o.submitAction, two.id);

      expect(await refusal(templates.removeTransition(o.submit, o.id, o.admin))).toMatchObject({ status: 409, code: 'TRANSITION_IN_USE', runCount: 2 });
      expect(await prisma.workflowTransition.count({ where: { id: o.submit } })).toBe(1);
      expect(await prisma.workflowTransitionAction.count({ where: { id: o.submitAction } })).toBe(1);

      await templates.removeTransition(o.unused, o.id, o.admin);
      expect(await prisma.workflowTransition.count({ where: { id: o.unused } })).toBe(0);
      expect(await prisma.workflowTransitionAction.count({ where: { id: o.unusedAction } })).toBe(0);
    });

    it('waits for a run of one of its actions being logged at that moment, then refuses rather than failing', async () => {
      const o = await org();
      const one = await instance(o, 'committee-1');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let logged!: () => void;
      const inside = new Promise<void>((r) => (logged = r));
      const logging = prisma.$transaction(
        async (tx) => {
          await tx.workflowActionLog.create({
            data: { organizationId: o.id, workflowTransitionActionId: o.unusedAction, workflowInstanceId: one.id, actionType: 'SEND_NOTIFICATION' },
          });
          logged();
          await gate;
        },
        { timeout: 30_000 },
      );
      await inside;
      const removal = refusal(templates.removeTransition(o.unused, o.id, o.admin));
      await new Promise((r) => setTimeout(r, 500));
      release();
      await logging;
      expect(await removal).toMatchObject({ code: 'TRANSITION_IN_USE', runCount: 1 });
    });

    it("another organisation's transition is the same 404", async () => {
      const mine = await org();
      const theirs = await org();
      await expect(templates.removeTransition(theirs.unused, mine.id, mine.admin)).rejects.toMatchObject({ status: 404 });
      expect(await prisma.workflowTransition.count({ where: { id: theirs.unused } })).toBe(1);
    });
  });
});
