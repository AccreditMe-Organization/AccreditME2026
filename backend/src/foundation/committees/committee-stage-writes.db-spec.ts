/**
 * ACC-255 PR 2 (ACC-241, Q-A) — a committee's direct writes decided by its
 * stage, against a REAL Postgres (npm run test:db).
 *
 * Only a database proves:
 *
 *   - the seeded rules decide: Formation allows a direct edit and Active does
 *     not; Dissolved refuses every member change (Ahmad, Q-A) while Dissolution
 *     Pending still allows them — with 409 STAGE_ACTION_NOT_ALLOWED naming the
 *     stage in both languages, and nothing written;
 *   - the lock order: an edit and Submit for Approval pressed together, ten
 *     times, always both finish (instance first, then the committee row — the
 *     engine's order, step-238 §7). The edit either lands before the move or
 *     is refused by the stage the move reached; never a deadlock;
 *   - another organisation's committee is the same 404 as a missing one.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
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
import { WorkflowService } from '../workflow/workflow.service';
import { StageTaskDefinitionService } from '../workflow/stage-task-definition.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { applyWorkflowSeed } from '../workflow/workflow-seed-apply';
import { SYSTEM_WORKFLOW_SEED } from '../workflow/workflow.seed';
import { CommitteesService } from './committees.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;

describe("A committee's direct writes, decided by its stage, against a real database (ACC-255 PR 2)", () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notifications = { create: async () => ({ id: randomUUID() }) } as unknown as NotificationService;
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const assignment = new TaskAssignmentService(prisma, authority, lookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla);
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);
  const roles = { getUserPermissions: async () => [] } as unknown as RoleService;
  const organizations = { resolveActingHeadForOrgUnit: async () => null } as unknown as OrganizationService;
  const queue = { add: async () => undefined } as never;
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, roles, organizations, queue, stageTasks);
  const committees = new CommitteesService(prisma, audit, workflow, new StageRulesService(prisma));

  interface Org {
    id: string;
    actorId: string;
    unitId: string;
    memberUserId: string;
    /** A committee at the seeded stage `key`, with one active member. */
    committeeAt: (key: string) => Promise<{ id: string; instanceId: string; memberId: string }>;
  }

  /** An organisation with the COMMITTEE workflow seeded exactly as bootstrap seeds it. */
  async function org(): Promise<Org> {
    const slug = `acc255w-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const roleKeys = new Set<string>();
    for (const s of COMMITTEE_SEED.stages) if (s.assigneeRoleKey) roleKeys.add(s.assigneeRoleKey);
    for (const t of COMMITTEE_SEED.transitions) if (t.triggerRoleKey) roleKeys.add(t.triggerRoleKey);
    for (const key of roleKeys) await prisma.role.create({ data: { organizationId: o.id, key, nameEn: key, isSystem: true } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const actor = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-a@example.test`, name: 'Committee editor', status: 'ACTIVE' } });
    const member = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-m@example.test`, name: 'Member', status: 'ACTIVE' } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${slug}` } });

    const committeeAt = async (key: string) => {
      const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
      const c = await prisma.committee.create({
        data: { organizationId: o.id, nameEn: `Committee ${key}`, typeValueId: 'type', orgUnitId: unit.id, quorumCount: 3, meetingFrequency: 'MONTHLY' },
      });
      const instance = await prisma.workflowInstance.create({
        data: { organizationId: o.id, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: stage.id },
      });
      await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id, enteredAt: new Date() } });
      const m = await prisma.committeeMember.create({
        data: { organizationId: o.id, committeeId: c.id, userId: member.id, roleValueId: 'member', isActive: true },
      });
      return { id: c.id, instanceId: instance.id, memberId: m.id };
    };
    return { id: o.id, actorId: actor.id, unitId: unit.id, memberUserId: member.id, committeeAt };
  }

  /** The refusal's body, or 'OK'. */
  const outcome = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => unknown }) => e.getResponse?.() ?? `ERROR ${String(e)}`,
    );

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('a direct edit (ACC-241)', () => {
    it('is allowed in Formation', async () => {
      const o = await org();
      const c = await o.committeeAt('formation');

      expect(await outcome(committees.updateCommittee(c.id, { nameEn: 'Renamed' } as never, o.id, o.actorId))).toBe('OK');
      expect((await prisma.committee.findFirstOrThrow({ where: { id: c.id } })).nameEn).toBe('Renamed');
    });

    it.each(['terms_review', 'active', 'suspended', 'dissolution_pending', 'dissolved'])(
      'is refused in %s: 409 naming the stage, and nothing written or audited',
      async (key) => {
        const o = await org();
        const c = await o.committeeAt(key);
        const stage = COMMITTEE_SEED.stages.find((s) => s.key === key)!;

        expect(await outcome(committees.updateCommittee(c.id, { nameEn: 'Renamed' } as never, o.id, o.actorId))).toEqual({
          statusCode: 409,
          error: 'Conflict',
          code: 'STAGE_ACTION_NOT_ALLOWED',
          action: 'edit_details',
          stageNameEn: stage.nameEn,
          stageNameAr: stage.nameAr,
          message: `This can't be done while the committee is in ${stage.nameEn}.`,
        });
        expect((await prisma.committee.findFirstOrThrow({ where: { id: c.id } })).nameEn).toBe(`Committee ${key}`);
        expect(await prisma.auditLog.count({ where: { objectType: 'Committee', objectId: c.id } })).toBe(0);
      },
    );
  });

  describe('member changes (Q-A)', () => {
    const changes = (o: Org, c: { id: string; memberId: string }, newUserId: string) => ({
      add_member: () => committees.addMember(c.id, { userId: newUserId, roleValueId: 'member' } as never, o.id, o.actorId),
      change_member_role: () => committees.changeMemberRole(c.id, c.memberId, { roleValueId: 'secretary' } as never, o.id, o.actorId),
      remove_member: () => committees.removeMember(c.id, c.memberId, {} as never, o.id, o.actorId),
    });
    const newUser = async (o: Org) =>
      (await prisma.user.create({ data: { organizationId: o.id, email: `${randomUUID()}@example.test`, name: 'New member', status: 'ACTIVE' } })).id;

    it('are refused while the committee is Dissolved — each with its own action, in both languages, and nothing written', async () => {
      const o = await org();
      const c = await o.committeeAt('dissolved');
      const before = await prisma.committeeMember.findMany({ where: { committeeId: c.id }, orderBy: { id: 'asc' } });

      for (const [action, call] of Object.entries(changes(o, c, await newUser(o)))) {
        expect(await outcome(call())).toEqual({
          statusCode: 409,
          error: 'Conflict',
          code: 'STAGE_ACTION_NOT_ALLOWED',
          action,
          stageNameEn: 'Dissolved',
          stageNameAr: 'محلولة',
          message: "Members can't be changed while the committee is Dissolved.",
        });
      }
      expect(await prisma.committeeMember.findMany({ where: { committeeId: c.id }, orderBy: { id: 'asc' } })).toEqual(before);
      expect(await prisma.committeeMembershipEvent.count({ where: { committeeId: c.id } })).toBe(0);
    });

    it.each(['formation', 'terms_review', 'active', 'suspended', 'dissolution_pending'])('are still allowed in %s', async (key) => {
      const o = await org();
      const c = await o.committeeAt(key);
      const run = changes(o, c, await newUser(o));

      expect(await outcome(run.add_member())).toBe('OK');
      expect(await outcome(run.change_member_role())).toBe('OK');
      expect(await outcome(run.remove_member())).toBe('OK');
      expect(await prisma.committeeMembershipEvent.count({ where: { committeeId: c.id } })).toBe(3);
    });

    it('a tenant who allows them again on its own Dissolved stage gets its rule, not ours', async () => {
      const o = await org();
      const c = await o.committeeAt('dissolved');
      const dissolved = await prisma.workflowStage.findFirstOrThrow({
        where: { key: 'dissolved', workflowTemplate: { organizationId: o.id, objectType: 'COMMITTEE' } },
      });
      await prisma.workflowStageRecordAction.create({ data: { organizationId: o.id, stageId: dissolved.id, actionKey: 'remove_member' } });

      expect(await outcome(changes(o, c, await newUser(o)).remove_member())).toBe('OK');
    });
  });

  describe('the lock order (ACC-241, step-238 §7)', () => {
    it('an edit waits for a transition in flight, then answers from the stage it reached', async () => {
      const o = await org();
      const c = await o.committeeAt('formation');
      const termsReview = await prisma.workflowStage.findFirstOrThrow({
        where: { key: 'terms_review', workflowTemplate: { organizationId: o.id, objectType: 'COMMITTEE' } },
      });

      // A transition in flight: it holds the instance's row lock (as the
      // engine does) and moves the committee on when released.
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      const transition = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "WorkflowInstance" WHERE id = ${c.instanceId} FOR UPDATE`;
          locked();
          await released;
          await tx.workflowInstance.update({ where: { id: c.instanceId }, data: { currentStageId: termsReview.id } });
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
      await isLocked;

      let settled = false;
      const edit = outcome(committees.updateCommittee(c.id, { nameEn: 'Renamed' } as never, o.id, o.actorId)).finally(() => (settled = true));
      await new Promise((r) => setTimeout(r, 500));
      expect(settled).toBe(false); // waiting on the instance, FOR SHARE

      release();
      await transition;
      expect(await edit).toMatchObject({ code: 'STAGE_ACTION_NOT_ALLOWED', action: 'edit_details', stageNameEn: 'Terms Review' });
      expect((await prisma.committee.findFirstOrThrow({ where: { id: c.id } })).nameEn).toBe('Committee formation');
    });

    it('an edit and Submit for Approval pressed together always both finish — ten times over', async () => {
      const o = await org();
      const submit = await prisma.workflowTransition.findFirstOrThrow({
        where: { labelEn: 'Submit for Approval', fromStage: { key: 'formation', workflowTemplate: { organizationId: o.id } } },
      });

      for (let round = 0; round < 10; round++) {
        const c = await o.committeeAt('formation');
        const [edit, move] = await Promise.all([
          outcome(committees.updateCommittee(c.id, { nameEn: `Renamed ${round}` } as never, o.id, o.actorId)),
          outcome(workflow.triggerTransition(c.instanceId, { transitionId: submit.id } as never, o.id, o.actorId, ['committees:manage'])),
        ]);

        // The move always lands; the edit lands before it, or is refused by
        // the stage it reached. Never a deadlock, never a timeout.
        expect(move).toBe('OK');
        if (edit !== 'OK') expect(edit).toMatchObject({ code: 'STAGE_ACTION_NOT_ALLOWED', action: 'edit_details', stageNameEn: 'Terms Review' });
        const instance = await prisma.workflowInstance.findFirstOrThrow({ where: { id: c.instanceId } });
        expect((await prisma.workflowStage.findFirstOrThrow({ where: { id: instance.currentStageId! } })).key).toBe('terms_review');
        const name = (await prisma.committee.findFirstOrThrow({ where: { id: c.id } })).nameEn;
        expect(name).toBe(edit === 'OK' ? `Renamed ${round}` : 'Committee formation');
      }
    });
  });

  describe('tenant isolation', () => {
    it("should NOT return records belonging to a different tenant — another organisation's committee is the same 404 as a missing one, and its stage is not read", async () => {
      const mine = await org();
      const theirs = await org();
      const c = await theirs.committeeAt('formation');

      for (const id of [c.id, randomUUID()]) {
        await expect(committees.updateCommittee(id, { nameEn: 'Taken' } as never, mine.id, mine.actorId)).rejects.toThrow(NotFoundException);
        await expect(committees.addMember(id, { userId: mine.memberUserId, roleValueId: 'member' } as never, mine.id, mine.actorId)).rejects.toThrow(
          NotFoundException,
        );
        await expect(committees.removeMember(id, c.memberId, {} as never, mine.id, mine.actorId)).rejects.toThrow(NotFoundException);
      }
      expect((await prisma.committee.findFirstOrThrow({ where: { id: c.id } })).nameEn).toBe('Committee formation');
      expect(await prisma.committeeMember.count({ where: { committeeId: c.id, isActive: true } })).toBe(1);
    });
  });
});
