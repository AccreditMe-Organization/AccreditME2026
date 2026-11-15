/**
 * ACC-286 — a committee's structure rules against a REAL Postgres
 * (npm run test:db): going live, and keeping a required seat filled.
 *
 * Only a database proves:
 *
 *   - a committee enters a stage flagged IN_FORCE from one that is not (on the
 *     seed, Terms Review → Active) only with as many members as its quorum and
 *     every required seat filled, counting ACTIVE users only (Ahmad, 14 Nov,
 *     Q2, Q3), refused 409 naming the numbers or the seats, nothing moved;
 *   - a move between two in-force stages (Active ↔ Suspended), and a move into
 *     a stage that is not in force (Formation → Terms Review), is not going
 *     live and is not checked;
 *   - the check also runs INSIDE the stage-change transaction: a RETURN into
 *     an in-force stage skips the early check and is still refused;
 *   - while a committee is in force, removing or reseating the last ACTIVE
 *     holder of a required seat is refused 409 naming the seat, nothing
 *     written; a second holder, a stage not in force, a seat that is not
 *     required, or a holder who is not ACTIVE, and it is allowed;
 *   - two removals of the two Chairmen at once: exactly one lands, ten times
 *     over (the committee row lock);
 *   - Approve and the removal of the only Chairman at once: never both, ten
 *     times over, and never a deadlock (instance, then committee row);
 *   - another organisation's committee is the same 404 as a missing one.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { LookupService } from '../lookup/lookup.service';
import { TaskService } from '../task/task.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskAssignmentService } from '../task/task-assignment.service';
import { TaskSlaService } from '../task/task-sla.service';
import { TaskClosedNoticeService } from '../task/task-closed-notice.service';
import { WorkflowService } from '../workflow/workflow.service';
import { StageTaskDefinitionService } from '../workflow/stage-task-definition.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { StagePoolService } from '../workflow/stage-pool.service';
import { applyWorkflowSeed } from '../workflow/workflow-seed-apply';
import { writeStartingAssignments } from '../workflow/workflow-who';
import { SYSTEM_WORKFLOW_SEED } from '../workflow/workflow.seed';
import { CommitteesService } from './committees.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(300_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
type Status = 'ACTIVE' | 'INVITED' | 'INACTIVE' | 'SUSPENDED';

describe("A committee's structure rules against a real database (ACC-286)", () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notifications = { create: async () => ({ id: randomUUID() }), createInAppMany: async () => 0 } as unknown as NotificationService;
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const emptyLookups = { getValues: async () => [] } as unknown as LookupService;
  const assignment = new TaskAssignmentService(prisma, authority, emptyLookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla, new TaskClosedNoticeService(prisma, notifications));
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);
  const queue = { add: async () => undefined } as never;
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, queue, stageTasks, new StagePoolService(prisma));
  const committees = new CommitteesService(prisma, audit, workflow, new StageRulesService(prisma));
  const lookups = new LookupService(prisma, audit);
  let seat: Record<string, string> = {};

  interface Committee {
    id: string;
    instanceId: string;
    /** Adds an active membership in `seatKey` for a new user of `status`; the membership's id. */
    seat: (seatKey: string, status?: Status) => Promise<string>;
  }

  interface Org {
    id: string;
    actorId: string;
    templateId: string;
    /** A committee at the seeded stage `key`, with no members. */
    committeeAt: (key: string, quorumCount?: number) => Promise<Committee>;
    transition: (from: string, to: string) => Promise<string>;
  }

  async function org(): Promise<Org> {
    const slug = `acc286-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const actor = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-a@example.test`, name: 'Committee editor', status: 'ACTIVE' } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${slug}` } });
    // ACC-271 — as a new organisation's first admin: the seeded stages start on them.
    await writeStartingAssignments(prisma, o.id, actor.id, actor.id);
    const stageId = async (key: string) => (await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } })).id;

    const committeeAt = async (key: string, quorumCount = 2): Promise<Committee> => {
      const stage = await stageId(key);
      const c = await prisma.committee.create({
        data: { organizationId: o.id, nameEn: `Committee ${key}`, typeValueId: 'type', orgUnitId: unit.id, quorumCount, meetingFrequency: 'MONTHLY' },
      });
      const instance = await prisma.workflowInstance.create({
        data: { organizationId: o.id, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: stage },
      });
      await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage, enteredAt: new Date() } });
      return {
        id: c.id,
        instanceId: instance.id,
        seat: async (seatKey, status = 'ACTIVE') => {
          const u = await prisma.user.create({ data: { organizationId: o.id, email: `${randomUUID()}@example.test`, name: seatKey, status } });
          const m = await prisma.committeeMember.create({
            data: { organizationId: o.id, committeeId: c.id, userId: u.id, roleValueId: seat[seatKey]!, isActive: true },
          });
          return m.id;
        },
      };
    };
    const transition = async (from: string, to: string) =>
      (await prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: await stageId(from), toStageId: await stageId(to) } })).id;
    return { id: o.id, actorId: actor.id, templateId: template.id, committeeAt, transition };
  }

  const outcome = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => unknown }) => e.getResponse?.() ?? `ERROR ${String(e)}`,
    );
  const code = async (p: Promise<unknown>): Promise<string> => {
    const r = await outcome(p);
    return r === 'OK' ? 'OK' : ((r as { code?: string }).code ?? JSON.stringify(r));
  };

  const move = (o: Org, c: Committee, from: string, to: string) =>
    o.transition(from, to).then((transitionId) => workflow.triggerTransition(c.instanceId, { transitionId } as never, o.id, o.actorId, ['committees:view']));
  const stageKey = async (c: Committee) => {
    const { currentStageId } = await prisma.workflowInstance.findFirstOrThrow({ where: { id: c.instanceId } });
    return (await prisma.workflowStage.findFirstOrThrow({ where: { id: currentStageId! } })).key;
  };

  const remove = (o: Org, c: Committee, memberId: string) =>
    committees.removeMember(c.id, memberId, { reason: 'Leaving' } as never, o.id, o.actorId, ['committees:view']);
  const reseat = (o: Org, c: Committee, memberId: string, seatKey: string) =>
    committees.changeMemberRole(c.id, memberId, { roleValueId: seat[seatKey]! } as never, o.id, o.actorId, ['committees:view']);

  beforeAll(async () => {
    await prisma.onModuleInit();
    await lookups.seedSystemData();
    const values = await prisma.lookupValue.findMany({
      where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
      select: { id: true, key: true },
    });
    seat = Object.fromEntries(values.map((v) => [v.key, v.id]));
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('going live: entering a stage flagged IN_FORCE (Q2)', () => {
    it('is refused with fewer members than the quorum, naming both numbers, and nothing moves', async () => {
      const o = await org();
      const c = await o.committeeAt('terms_review', 3);
      await c.seat('chairman');
      await c.seat('secretary');

      expect(await outcome(move(o, c, 'terms_review', 'active'))).toMatchObject({
        statusCode: 409,
        code: 'COMMITTEE_MEMBERS_BELOW_QUORUM',
        quorum: 3,
        members: 2,
      });
      expect(await stageKey(c)).toBe('terms_review');
    });

    it('is refused with a required seat empty, naming every empty seat in seat order', async () => {
      const o = await org();
      const c = await o.committeeAt('terms_review', 2);
      await c.seat('member');
      await c.seat('vice_chairman');

      expect(await outcome(move(o, c, 'terms_review', 'active'))).toMatchObject({
        statusCode: 409,
        code: 'COMMITTEE_REQUIRED_SEATS_EMPTY',
        seats: [
          { id: seat['chairman'], labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
          { id: seat['secretary'], labelEn: 'Secretary', labelAr: 'أمين السر' },
        ],
      });
      expect(await stageKey(c)).toBe('terms_review');
    });

    it('counts ACTIVE users only: an invited Chairman fills nothing and is no member (Q3)', async () => {
      const o = await org();
      const c = await o.committeeAt('terms_review', 2);
      await c.seat('chairman', 'INVITED');
      await c.seat('secretary');
      await c.seat('member');

      expect(await outcome(move(o, c, 'terms_review', 'active'))).toMatchObject({
        code: 'COMMITTEE_REQUIRED_SEATS_EMPTY',
        seats: [{ id: seat['chairman'] }],
      });

      await c.seat('chairman', 'SUSPENDED');
      expect(await code(move(o, c, 'terms_review', 'active'))).toBe('COMMITTEE_REQUIRED_SEATS_EMPTY');
      await c.seat('chairman');
      expect(await code(move(o, c, 'terms_review', 'active'))).toBe('OK');
      expect(await stageKey(c)).toBe('active');
    });

    it('a seat the organisation unticked is not needed', async () => {
      const o = await org();
      await lookups.overrideAttributes(seat['secretary']!, o.id, { attributes: { required: false } }, o.actorId);
      const c = await o.committeeAt('terms_review', 2);
      await c.seat('chairman');
      await c.seat('member');

      expect(await code(move(o, c, 'terms_review', 'active'))).toBe('OK');
    });

    it('moves that are not going live are not checked: Formation → Terms Review, Active → Suspended → Active', async () => {
      const o = await org();
      const forming = await o.committeeAt('formation', 3);
      await forming.seat('member');
      expect(await code(move(o, forming, 'formation', 'terms_review'))).toBe('OK');

      const live = await o.committeeAt('active', 3);
      expect(await code(move(o, live, 'active', 'suspended'))).toBe('OK');
      expect(await code(move(o, live, 'suspended', 'active'))).toBe('OK');
    });

    it('is checked again INSIDE the stage change: a RETURN into an in-force stage skips the early check and is still refused', async () => {
      const o = await org();
      const from = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: o.templateId, key: 'terms_review' } });
      const to = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: o.templateId, key: 'active' } });
      const back = await prisma.workflowTransition.create({
        data: { fromStageId: from.id, toStageId: to.id, labelEn: 'Straight back to Active', kind: 'RETURN', mover: 'PERSON' },
      });
      const c = await o.committeeAt('terms_review', 1);
      await c.seat('member');

      expect(await outcome(workflow.triggerTransition(c.instanceId, { transitionId: back.id } as never, o.id, o.actorId, ['committees:view']))).toMatchObject({
        code: 'COMMITTEE_REQUIRED_SEATS_EMPTY',
      });
      expect(await stageKey(c)).toBe('terms_review');
    });
  });

  describe('keeping a required seat filled while in force (rule 3)', () => {
    it('removing the only Chairman of a committee in force is refused naming the seat, and nothing is written', async () => {
      const o = await org();
      const c = await o.committeeAt('active');
      const chairman = await c.seat('chairman');
      await c.seat('secretary');

      expect(await outcome(remove(o, c, chairman))).toEqual({
        statusCode: 409,
        error: 'Conflict',
        code: 'COMMITTEE_REQUIRED_SEAT_LAST_HOLDER',
        seat: { id: seat['chairman'], labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
        message: 'Appoint another Chairman first: this committee is in force and needs one',
      });
      expect((await prisma.committeeMember.findFirstOrThrow({ where: { id: chairman } })).isActive).toBe(true);
      expect(await prisma.committeeMembershipEvent.count({ where: { committeeId: c.id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { organizationId: o.id, objectType: 'CommitteeMember' } })).toBe(0);
    });

    it('moving the only Secretary to another seat is refused; moving within the same seat is not a change', async () => {
      const o = await org();
      const c = await o.committeeAt('suspended');
      await c.seat('chairman');
      const secretary = await c.seat('secretary');

      expect(await code(reseat(o, c, secretary, 'member'))).toBe('COMMITTEE_REQUIRED_SEAT_LAST_HOLDER');
      expect(await code(reseat(o, c, secretary, 'secretary'))).toBe('OK');
      expect((await prisma.committeeMember.findFirstOrThrow({ where: { id: secretary } })).roleValueId).toBe(seat['secretary']);
    });

    it('is allowed with a second holder, outside an in-force stage, for a seat that is not required, and for a holder who is not ACTIVE', async () => {
      const o = await org();
      const two = await o.committeeAt('active');
      const first = await two.seat('chairman');
      await two.seat('chairman');
      const member = await two.seat('member');
      expect(await code(remove(o, two, first))).toBe('OK');
      expect(await code(remove(o, two, member))).toBe('OK');

      const forming = await o.committeeAt('formation');
      expect(await code(remove(o, forming, await forming.seat('chairman')))).toBe('OK');

      // A deactivated Chairman fills nothing, so clearing them empties nothing.
      const departed = await o.committeeAt('active');
      expect(await code(remove(o, departed, await departed.seat('chairman', 'INACTIVE')))).toBe('OK');
    });

    it('two removals of the two Chairmen at once: exactly one lands — ten times over', async () => {
      for (let round = 0; round < 10; round++) {
        const o = await org();
        const c = await o.committeeAt('active');
        const a = await c.seat('chairman');
        const b = await c.seat('chairman');

        const outcomes = await Promise.all([code(remove(o, c, a)), code(remove(o, c, b))]);

        expect(outcomes.sort()).toEqual(['COMMITTEE_REQUIRED_SEAT_LAST_HOLDER', 'OK']);
        expect(await prisma.committeeMember.count({ where: { committeeId: c.id, isActive: true } })).toBe(1);
      }
    });

    it('Approve and the removal of the only Chairman at once: never both, never a deadlock — ten times over', async () => {
      for (let round = 0; round < 10; round++) {
        const o = await org();
        const c = await o.committeeAt('terms_review', 2);
        const chairman = await c.seat('chairman');
        await c.seat('secretary');
        await c.seat('member');

        const [approve, removal] = await Promise.all([code(move(o, c, 'terms_review', 'active')), code(remove(o, c, chairman))]);

        expect([approve, removal]).not.toEqual(['OK', 'OK']);
        if (approve === 'OK') {
          expect(removal).toBe('COMMITTEE_REQUIRED_SEAT_LAST_HOLDER');
          expect((await prisma.committeeMember.findFirstOrThrow({ where: { id: chairman } })).isActive).toBe(true);
        } else {
          expect([approve, removal]).toEqual(['COMMITTEE_REQUIRED_SEATS_EMPTY', 'OK']);
          expect(await stageKey(c)).toBe('terms_review');
        }
      }
    });

    it("should NOT return records belonging to a different tenant: another organisation's committee is the same 404 as a missing one", async () => {
      const mine = await org();
      const theirs = await org();
      const c = await theirs.committeeAt('active');
      const chairman = await c.seat('chairman');

      const foreign = await outcome(committees.removeMember(c.id, chairman, { reason: 'x' } as never, mine.id, mine.actorId, ['committees:view']));
      const missing = await outcome(committees.removeMember('invented', 'invented', { reason: 'x' } as never, mine.id, mine.actorId, ['committees:view']));
      expect(foreign).toEqual(missing);
      expect((foreign as { statusCode?: number }).statusCode).toBe(404);
      expect((await prisma.committeeMember.findFirstOrThrow({ where: { id: chairman } })).isActive).toBe(true);
    });
  });
});
