/**
 * ACC-239 — committee change requests against a REAL Postgres (npm run test:db).
 *
 * Built on the real engine (WorkflowService, the seeded six-stage template),
 * the real TaskService and the real reference checks. Only a database proves:
 *
 *   - one open request per committee when two creates race (the row lock);
 *   - Approve refuses a committee that drifted since Submit, applying nothing;
 *   - Approve applies every value, the task and the stage move together, or
 *     none of them (the engine's transaction);
 *   - the quorum a committee vote counts against is the entry's snapshot;
 *   - the six-stage template cannot be reshaped;
 *   - another organisation's request is the same 404 as a missing one;
 *   - the backfill's dry run writes nothing, execute seeds, a re-run is a no-op.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { DelegationLabelService } from '../../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { NotificationService } from '../../notification/notification.service';
import { TenantService } from '../../tenant/tenant.service';
import { LookupService } from '../../lookup/lookup.service';
import { TaskService } from '../../task/task.service';
import { TaskAuthorityService } from '../../task/task-authority.service';
import { TaskAssignmentService } from '../../task/task-assignment.service';
import { TaskSlaService } from '../../task/task-sla.service';
import { TaskClosedNoticeService } from '../../task/task-closed-notice.service';
import { WorkflowService } from '../../workflow/workflow.service';
import { WorkflowTemplateService } from '../../workflow/workflow-template.service';
import { StageTaskDefinitionService } from '../../workflow/stage-task-definition.service';
import { applyWorkflowSeed } from '../../workflow/workflow-seed-apply';
import { SYSTEM_WORKFLOW_SEED } from '../../workflow/workflow.seed';
import { itEnforcesTenantIsolation } from '../../../common/testing/tenant-isolation';
import { COMMITTEE_STAGE_KEYS } from '../../workflow/workflow-stage-keys';
import { runBackfill } from '../../../../prisma/backfill-acc239-change-request-workflow';
import { ChangeRequestViewer, CommitteeChangeRequestService } from './committee-change-request.service';
import { StageRulesService } from '../../workflow/stage-rules.service';
import { StagePoolService } from '../../workflow/stage-pool.service';
import { mayDecideAnyChangeRequest } from './change-request-chain';
import { ChangeRequestDepartureService, PreparedDeparture } from './departure/change-request-departure.service';
import { UserService } from '../../user/user.service';
import type { RoleService } from '../../roles/role.service';
import type { OrganizationService } from '../../organization/organization.service';
import type { OrgUnitHeadService } from '../../organization/org-unit-head.service';
import type { OrgPositionService } from '../../org-position/org-position.service';
import type { AuthProvider } from '../../../providers/auth/auth.provider';
import type { CommitteeTransferNoticeService } from '../transfer-notice/committee-transfer-notice.service';
import { TENANT_ADMIN_KEY } from '../../roles/tenant-administrator.invariant';
import { findUnitHeadedBy, findUnitsCoveredBy } from '../../organization/unit-headship';
import { SEAT_ACTIONS } from '../seat-actions';
import { CommitteeSeatDepartureService } from '../../committees/departure/committee-seat-departure.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const VIEW = 'committees:view';
const EDIT = 'committees:edit_details';
const APPROVE = 'committees:approve';
const CR_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE_CHANGE_REQUEST')!;
const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;

describe('Committee change requests against a real database (ACC-239)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notices: { userId: string; titleEn: string; organizationId: string }[] = [];
  const inApp: unknown[] = [];
  const notifications = {
    create: async (dto: { userId: string; titleEn: string }, organizationId: string) => {
      notices.push({ userId: dto.userId, titleEn: dto.titleEn, organizationId });
      return { id: randomUUID() };
    },
    // ACC-283 PR 2b — in-app notices recorded too, so "nothing is sent" can be proved.
    createInAppMany: async (...args: unknown[]) => {
      inApp.push(args);
      return 0;
    },
  } as unknown as NotificationService;
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const assignment = new TaskAssignmentService(prisma, authority, lookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla, new TaskClosedNoticeService(prisma, notifications));
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);
  const queue = { add: async () => undefined } as never;
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, queue, stageTasks, new StagePoolService(prisma));
  const templates = new WorkflowTemplateService(prisma, audit, stageTasks);
  const requests = new CommitteeChangeRequestService(prisma, workflow, tasks, audit, notifications, new StageRulesService(prisma));
  const departure = new ChangeRequestDepartureService(prisma, workflow, tasks, audit);

  interface World {
    org: string;
    slug: string;
    requester: ChangeRequestViewer;
    approver: ChangeRequestViewer;
    approver2: ChangeRequestViewer;
    editor2: ChangeRequestViewer;
    reader: ChangeRequestViewer;
    committee: string;
    other: string;
    unit: string;
    stageOf: Record<string, string>;
  }

  async function permission(module: string, action: string): Promise<string> {
    return (await prisma.permission.upsert({ where: { module_action: { module, action } }, create: { module, action }, update: {} })).id;
  }

  /** An organisation with the seeded change request workflow, a committee lifecycle, and five people. */
  async function world(committeeStage: string = 'active'): Promise<World> {
    const slug = `acc239-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    await applyWorkflowSeed(prisma, org, [CR_SEED]);
    // ACC-283 PR 2 — every bootstrapped organisation has one; the finish task's SLA reads it.
    await calendar.getOrCreate(org);

    // The committee lifecycle, keyed as the seed keys it, with the seed's stage
    // rules — its flags and record actions (ACC-255 PR 2: what a change request
    // may do is read from these, never from the key). No transitions are fired
    // on it here: a committee is put in a stage by pointing its instance.
    const tpl = await prisma.workflowTemplate.create({
      data: { organizationId: org, nameEn: 'Committee', objectType: 'COMMITTEE', isDefault: true, isActive: true },
    });
    const stageOf: Record<string, string> = {};
    for (const [i, key] of COMMITTEE_STAGE_KEYS.entries()) {
      const seeded = COMMITTEE_SEED.stages.find((s) => s.key === key)!;
      stageOf[key] = (
        await prisma.workflowStage.create({
          data: {
            workflowTemplateId: tpl.id,
            key,
            nameEn: key,
            order: (i + 1) * 10,
            isInitial: i === 0,
            isFinal: key === 'dissolved',
            whoMode: seeded.who.mode,
            flags: [...(seeded.flags ?? [])],
            recordActions: { create: (seeded.actions ?? []).map((actionKey) => ({ organizationId: org, actionKey })) },
          },
        })
      ).id;
    }

    const unit = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Root', code: `R-${slug}` } })).id;
    const user = async (name: string) =>
      (await prisma.user.create({ data: { organizationId: org, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE' } })).id;
    const ids = { requester: await user('Requester'), approver: await user('Approver'), approver2: await user('Approver Two'), editor2: await user('Editor Two'), reader: await user('Reader') };

    // committees:approve through a real role. ACC-283 PR 2: it decides nothing any
    // more; the requester keeps it to prove that.
    const role = await prisma.role.create({ data: { organizationId: org, nameEn: 'Approvers', key: `APPROVERS_${slug}` } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: await permission('committees', 'approve') } });
    for (const u of [ids.approver, ids.approver2, ids.requester]) await prisma.userRole.create({ data: { userId: u, roleId: role.id } });
    // ACC-283 PR 2 — the CHAIN decides: both approvers hold the root unit's head
    // position (a successor pending, say), and the committees are owned by the
    // root, so the root step names them both. The requester heads nothing.
    const headPosition = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Director', grade: 10, isUnitHeadPosition: true } });
    await prisma.user.updateMany({
      where: { id: { in: [ids.approver, ids.approver2] }, organizationId: org },
      data: { positionId: headPosition.id, primaryOrgUnitId: unit },
    });

    const committee = async (nameEn: string) => {
      const c = await prisma.committee.create({
        data: { organizationId: org, nameEn, typeValueId: 'type', orgUnitId: unit, quorumCount: 3, meetingFrequency: 'MONTHLY' },
      });
      await prisma.workflowInstance.create({
        data: { organizationId: org, workflowTemplateId: tpl.id, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: stageOf[committeeStage] },
      });
      return c.id;
    };
    return {
      org,
      slug,
      // The requester also holds committees:approve: self-approval is refused by WHO, not by permission.
      requester: { userId: ids.requester, permissions: [VIEW, EDIT, APPROVE] },
      approver: { userId: ids.approver, permissions: [VIEW, APPROVE] },
      approver2: { userId: ids.approver2, permissions: [VIEW, APPROVE] },
      editor2: { userId: ids.editor2, permissions: [VIEW, EDIT] },
      reader: { userId: ids.reader, permissions: [VIEW] },
      committee: await committee('Quality Council'),
      other: await committee('Patient Safety Committee'),
      unit,
      stageOf,
    };
  }

  const outcome = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => string | { code?: string; message?: string } }) => {
        const r = e.getResponse?.();
        if (typeof r === 'string') return r;
        return r?.code ?? r?.message ?? `ERROR ${String(e)}`;
      },
    );
  const body = (p: Promise<unknown>): Promise<unknown> => p.then(() => 'OK', (e: { getResponse?: () => unknown; getStatus?: () => number }) => [e.getStatus?.(), e.getResponse?.()]);

  const setCommitteeStage = (w: World, id: string, key: string) =>
    prisma.workflowInstance.updateMany({ where: { organizationId: w.org, objectType: 'COMMITTEE', objectId: id }, data: { currentStageId: w.stageOf[key] } });

  const submitted = async (w: World, changes: Record<string, unknown> = { quorumCount: 5 }) =>
    requests.create(w.committee, { changes: changes as never, reason: 'Membership grew', submit: true }, w.org, w.requester);

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });
  beforeEach(() => {
    notices.length = 0;
  });

  // ── Who may do what ──────────────────────────────────────────────────────────

  describe('permissions', () => {
    it('raising a request needs committees:edit_details', async () => {
      const w = await world();
      expect(await outcome(requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'r' }, w.org, w.approver))).toBe('CHANGE_REQUEST_NOT_ALLOWED');
      expect(await prisma.committeeChangeRequest.count({ where: { organizationId: w.org } })).toBe(0);
    });

    it('only the requester edits or submits a draft — another editor is refused', async () => {
      const w = await world();
      const draft = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'r' }, w.org, w.requester);
      expect(await outcome(requests.update(draft.id, { reason: 'mine now' }, w.org, w.editor2))).toBe('CHANGE_REQUEST_NOT_REQUESTER');
      expect(await outcome(requests.submit(draft.id, w.org, w.editor2))).toBe('CHANGE_REQUEST_NOT_REQUESTER');
      expect(await outcome(requests.update(draft.id, { reason: 'Clearer reason' }, w.org, w.requester))).toBe('OK');
      expect((await requests.getOne(draft.id, w.org, w.requester)).status).toBe('draft');
    });

    it('the requester can never decide their own request, though they hold committees:approve', async () => {
      const w = await world();
      const r = await submitted(w);
      expect(await outcome(requests.approve(r.id, w.org, w.requester))).toBe('CHANGE_REQUEST_OWN_DECISION');
      expect(await outcome(requests.returnForChanges(r.id, { note: 'n' }, w.org, w.requester))).toBe('CHANGE_REQUEST_OWN_DECISION');
      expect(await outcome(requests.reject(r.id, { reason: 'n' }, w.org, w.requester))).toBe('CHANGE_REQUEST_OWN_DECISION');
      expect((await prisma.committee.findFirstOrThrow({ where: { id: w.committee } })).quorumCount).toBe(3);
      expect((await requests.getOne(r.id, w.org, w.approver)).status).toBe('under_review');
    });

    // ACC-283 PR 2 — the chain decides, never committees:approve.
    it('deciding needs a place in the chain: a reader is told who decides; committees:approve alone decides nothing', async () => {
      const w = await world();
      const r = await submitted(w);
      expect(await outcome(requests.approve(r.id, w.org, w.editor2))).toBe('CHANGE_REQUEST_NOT_DECIDER');
      expect(await body(requests.reject(r.id, { reason: 'n' }, w.org, w.reader))).toEqual([
        403,
        expect.objectContaining({
          code: 'CHANGE_REQUEST_NOT_DECIDER',
          awaitingDecisionBy: { kind: 'UNIT_HEAD', unit: { id: w.unit, nameEn: 'Root', nameAr: null } },
        }),
      ]);
      // A holder of committees:approve outside the chain: refused like anyone else.
      const holder = await prisma.user.create({ data: { organizationId: w.org, email: `${w.slug}-holder@example.test`, name: 'Holder', status: 'ACTIVE' } });
      expect(await outcome(requests.approve(r.id, w.org, { userId: holder.id, permissions: [VIEW, APPROVE] }))).toBe('CHANGE_REQUEST_NOT_DECIDER');
      // Someone who may not even read it: the 404 a missing request gets.
      expect(await outcome(requests.approve(r.id, w.org, { userId: holder.id, permissions: [APPROVE] }))).toBe('Change request not found');
      // A unit head without any committee key decides.
      expect(await outcome(requests.approve(r.id, w.org, { userId: w.approver.userId, permissions: [] }))).toBe('OK');
    });

    // ACC-283 Q8 — nobody but the requester withdraws, at any open stage.
    it('withdraw: only the requester, at any open stage; a decider is refused even for a returned request', async () => {
      const w = await world();
      const r = await submitted(w);
      expect(await outcome(requests.withdraw(r.id, w.org, w.approver))).toBe('CHANGE_REQUEST_NOT_REQUESTER');
      await requests.returnForChanges(r.id, { note: 'Say which members' }, w.org, w.approver);
      expect((await requests.getOne(r.id, w.org, w.approver)).actions.withdraw).toBe(false);
      expect(await outcome(requests.withdraw(r.id, w.org, w.approver2))).toBe('CHANGE_REQUEST_NOT_REQUESTER');
      expect((await requests.getOne(r.id, w.org, w.requester)).actions.withdraw).toBe(true);
      expect(await outcome(requests.withdraw(r.id, w.org, w.requester))).toBe('OK');
      const after = await requests.getOne(r.id, w.org, w.requester);
      expect(after.status).toBe('withdrawn');
      expect(after.withdrawnById).toBe(w.requester.userId);

      const w2 = await world();
      const own = await submitted(w2);
      expect(await outcome(requests.withdraw(own.id, w2.org, w2.requester))).toBe('OK');
      expect(await outcome(requests.withdraw(own.id, w2.org, w2.requester))).toBe('CHANGE_REQUEST_NOT_OPEN');
    });

    it('notices (Q1): Submit tells every approver but the requester; decisions tell the requester; withdrawing your own tells nobody', async () => {
      const w = await world();
      const r = await submitted(w);
      const toReview = notices.filter((n) => n.titleEn.includes('to review')).map((n) => n.userId).sort();
      expect(toReview).toEqual([w.approver.userId, w.approver2.userId].sort());

      notices.length = 0;
      await requests.returnForChanges(r.id, { note: 'Which members?' }, w.org, w.approver);
      expect(notices.filter((n) => n.titleEn.startsWith('Change request')).map((n) => n.userId)).toEqual([w.requester.userId]);

      notices.length = 0;
      await requests.withdraw(r.id, w.org, w.requester);
      expect(notices.filter((n) => n.titleEn.startsWith('Change request'))).toEqual([]);
    });
  });

  // ── One open request ─────────────────────────────────────────────────────────

  describe('one open request per committee', () => {
    it('a draft blocks a second request, and a closed one does not', async () => {
      const w = await world();
      const first = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'r' }, w.org, w.requester);
      expect(await outcome(requests.create(w.committee, { changes: { quorumCount: 6 }, reason: 'r' }, w.org, w.editor2))).toBe('CHANGE_REQUEST_ALREADY_OPEN');
      await requests.withdraw(first.id, w.org, w.requester);
      const second = await requests.create(w.committee, { changes: { quorumCount: 6 }, reason: 'r' }, w.org, w.editor2);
      expect(second.number).toBe(2);
    });

    it('a request in a stage with no key counts as open', async () => {
      const w = await world();
      const r = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'r' }, w.org, w.requester);
      await prisma.workflowStage.updateMany({ where: { workflowTemplate: { organizationId: w.org, objectType: 'COMMITTEE_CHANGE_REQUEST' }, key: 'draft' }, data: { key: null } });
      expect(await outcome(requests.create(w.committee, { changes: { quorumCount: 6 }, reason: 'r' }, w.org, w.editor2))).toBe('CHANGE_REQUEST_ALREADY_OPEN');
      expect(r.number).toBe(1);
    });

    it('two creates pressed at the same moment: exactly one is made — ten times over', async () => {
      for (let round = 0; round < 10; round++) {
        const w = await world();
        const results = await Promise.all([
          outcome(requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'a' }, w.org, w.requester)),
          outcome(requests.create(w.committee, { changes: { quorumCount: 6 }, reason: 'b' }, w.org, w.editor2)),
        ]);
        expect([...results].sort()).toEqual(['CHANGE_REQUEST_ALREADY_OPEN', 'OK']);
        expect(await prisma.committeeChangeRequest.count({ where: { committeeId: w.committee } })).toBe(1);
        expect(await prisma.workflowInstance.count({ where: { organizationId: w.org, objectType: 'COMMITTEE_CHANGE_REQUEST' } })).toBe(1);
      }
    });
  });

  // ── The committee's stage ────────────────────────────────────────────────────

  describe('the committee stage', () => {
    it.each([
      ['formation', 'CHANGE_REQUEST_STAGE_NOT_ALLOWED'],
      ['terms_review', 'CHANGE_REQUEST_STAGE_NOT_ALLOWED'],
      ['dissolution_pending', 'CHANGE_REQUEST_COMMITTEE_DISSOLVING'],
      ['dissolved', 'CHANGE_REQUEST_COMMITTEE_DISSOLVING'],
      ['active', 'OK'],
      ['suspended', 'OK'],
    ])('a committee in %s: %s', async (stage, expected) => {
      const w = await world(stage);
      expect(await outcome(requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'r' }, w.org, w.requester))).toBe(expected);
    });

    it('a committee being dissolved: its open request can only be rejected or withdrawn', async () => {
      const w = await world();
      const r = await submitted(w);
      await setCommitteeStage(w, w.committee, 'dissolution_pending');
      expect(await outcome(requests.approve(r.id, w.org, w.approver))).toBe('CHANGE_REQUEST_COMMITTEE_DISSOLVING');
      expect(await outcome(requests.returnForChanges(r.id, { note: 'n' }, w.org, w.approver))).toBe('CHANGE_REQUEST_COMMITTEE_DISSOLVING');
      expect(await outcome(requests.reject(r.id, { reason: 'The committee is closing' }, w.org, w.approver))).toBe('OK');
      expect((await requests.getOne(r.id, w.org, w.requester)).status).toBe('rejected');

      const w2 = await world();
      const draft = await requests.create(w2.committee, { changes: { quorumCount: 4 }, reason: 'r' }, w2.org, w2.requester);
      await setCommitteeStage(w2, w2.committee, 'dissolution_pending');
      expect(await outcome(requests.update(draft.id, { reason: 'x' }, w2.org, w2.requester))).toBe('CHANGE_REQUEST_COMMITTEE_DISSOLVING');
      expect(await outcome(requests.submit(draft.id, w2.org, w2.requester))).toBe('CHANGE_REQUEST_COMMITTEE_DISSOLVING');
      expect(await outcome(requests.withdraw(draft.id, w2.org, w2.requester))).toBe('OK');
    });
  });

  // ── Approve ──────────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('applies every value, with one committee audit row, the terms task for the requester, and the move', async () => {
      const w = await world();
      const r = await submitted(w, {
        nameEn: 'Quality and Safety Council',
        purpose: 'Oversee quality and safety',
        quorumCount: 5,
        meetingFrequency: 'QUARTERLY',
        reportingToCommitteeId: w.other,
      });
      expect(r.fromValues).toEqual({ nameEn: 'Quality Council', purpose: null, quorumCount: 3, meetingFrequency: 'MONTHLY', reportingToCommitteeId: null });

      const done = await requests.approve(r.id, w.org, w.approver);

      expect(done.status).toBe('approved');
      const c = await prisma.committee.findFirstOrThrow({ where: { id: w.committee } });
      expect(c).toMatchObject({ nameEn: 'Quality and Safety Council', purpose: 'Oversee quality and safety', quorumCount: 5, meetingFrequency: 'QUARTERLY', reportingToCommitteeId: w.other });
      const committeeAudits = await prisma.auditLog.findMany({ where: { objectType: 'Committee', objectId: w.committee, action: 'UPDATE' } });
      expect(committeeAudits).toHaveLength(1);
      expect(committeeAudits[0]!.metadata).toMatchObject({ changeRequestId: r.id });
      const task = await prisma.task.findFirstOrThrow({ where: { id: done.termsTaskId! }, include: { assignees: true } });
      expect(task).toMatchObject({ organizationId: w.org, sourceType: 'COMMITTEE', sourceId: w.committee, title: 'Revise the terms of reference', createdById: w.approver.userId });
      expect(task.assignees.map((a) => a.userId)).toEqual([w.requester.userId]);
      expect(done).toMatchObject({ decidedById: w.approver.userId });
      expect(done.appliedAt).not.toBeNull();
    });

    it("ACC-255 §4.3: lands in the stage flagged APPLIES_APPROVED_CHANGE, found by its flag — and with none, refuses and applies nothing", async () => {
      const w = await world();
      const r = await submitted(w, { quorumCount: 5 });
      const approved = await prisma.workflowStage.findFirstOrThrow({
        where: { key: 'approved', workflowTemplate: { organizationId: w.org, objectType: 'COMMITTEE_CHANGE_REQUEST' } },
      });
      expect(approved.flags).toEqual(['APPLIES_APPROVED_CHANGE']);

      await prisma.workflowStage.update({ where: { id: approved.id }, data: { flags: [] } });
      expect(await outcome(requests.approve(r.id, w.org, w.approver))).toBe('CHANGE_REQUEST_STAGE_NOT_ALLOWED');
      expect((await prisma.committee.findFirstOrThrow({ where: { id: w.committee } })).quorumCount).toBe(3);
      expect((await requests.getOne(r.id, w.org, w.approver)).status).toBe('under_review');

      await prisma.workflowStage.update({ where: { id: approved.id }, data: { flags: ['APPLIES_APPROVED_CHANGE'] } });
      expect((await requests.approve(r.id, w.org, w.approver)).status).toBe('approved');
    });

    it('DRIFT (Q11): a committee changed since Submit is refused with 409, and nothing is applied', async () => {
      const w = await world();
      const r = await submitted(w, { quorumCount: 5, nameEn: 'Renamed' });
      // Changed since Submit, by some other path.
      await prisma.committee.update({ where: { id: w.committee }, data: { quorumCount: 4 } });

      expect(await body(requests.approve(r.id, w.org, w.approver))).toEqual([
        409,
        // The quorum drifted; the name, still as it was at Submit, did not.
        expect.objectContaining({ code: 'CHANGE_REQUEST_COMMITTEE_CHANGED', fields: ['quorumCount'] }),
      ]);

      const c = await prisma.committee.findFirstOrThrow({ where: { id: w.committee } });
      expect(c).toMatchObject({ quorumCount: 4, nameEn: 'Quality Council' });
      expect((await requests.getOne(r.id, w.org, w.approver)).status).toBe('under_review');
      // No terms task (the requester's finish task, completed at Submit, is not one).
      expect(await prisma.task.count({ where: { organizationId: w.org, sourceId: w.committee, title: 'Revise the terms of reference' } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { objectType: 'Committee', objectId: w.committee } })).toBe(0);
    });

    it('is all or nothing: a failure while creating the task leaves the committee and the request as they were', async () => {
      const w = await world();
      const r = await submitted(w, { quorumCount: 5 });
      const spy = jest.spyOn(tasks, 'insertPrepared').mockRejectedValueOnce(new Error('task write failed'));
      try {
        expect(await outcome(requests.approve(r.id, w.org, w.approver))).toMatch(/task write failed/);
      } finally {
        spy.mockRestore();
      }
      expect((await prisma.committee.findFirstOrThrow({ where: { id: w.committee } })).quorumCount).toBe(3);
      const after = await requests.getOne(r.id, w.org, w.approver);
      expect(after).toMatchObject({ status: 'under_review', appliedAt: null, termsTaskId: null });
    });

    it('runs the reference checks: a Reports to the committee itself is refused at Submit', async () => {
      const w = await world();
      expect(await outcome(submitted(w, { reportingToCommitteeId: w.committee }))).toBe('COMMITTEE_REPORTS_TO_ITSELF');
    });
  });

  // ── Quorum snapshot ──────────────────────────────────────────────────────────

  describe('the quorum snapshot', () => {
    async function voteStage(w: World) {
      const tpl = await prisma.workflowTemplate.create({
        data: { organizationId: w.org, nameEn: 'Vote', objectType: 'MEETING', isDefault: true, isActive: true },
      });
      // ACC-271 PR 6a — a Committee vote stage on this committee.
      const stage = await prisma.workflowStage.create({
        data: {
          workflowTemplateId: tpl.id,
          nameEn: 'Committee vote',
          order: 10,
          isInitial: true,
          whoMode: 'COMMITTEE_VOTE',
          assignees: { create: { organizationId: w.org, order: 1, kind: 'COMMITTEE', committeeId: w.committee } },
        },
      });
      return { tpl, stage };
    }
    // ACC-284 — the threshold is a MOVE's. These votes name no move (written as
    // before ACC-284), so they count for the stage's ADVANCE: ask about one.
    const thresholdMet = (stage: unknown, entry: unknown, org: string, instance: unknown): Promise<boolean> =>
      (workflow as unknown as { isApprovalThresholdMet: (...a: unknown[]) => Promise<boolean> }).isApprovalThresholdMet(stage, entry, org, instance, {
        id: 'the-advance',
        kind: 'ADVANCE',
      });

    it('is saved when a record enters a committee-approval stage, and the vote counts against it — not the live quorum', async () => {
      const w = await world();
      const { stage } = await voteStage(w);
      const instance = await workflow.startInstance('MEETING', `meeting-${randomUUID()}`, w.org, w.approver.userId);
      const entry = await prisma.workflowInstanceStage.findFirstOrThrow({ where: { workflowInstanceId: instance.id } });
      expect(entry.quorumCount).toBe(3);

      for (const u of [w.approver.userId, w.approver2.userId]) {
        await prisma.workflowApproval.create({ data: { workflowInstanceStageId: entry.id, approverId: u, decision: 'APPROVED' } });
      }
      const live = await prisma.workflowInstance.findFirstOrThrow({ where: { id: instance.id } });
      expect(await thresholdMet(stage, entry, w.org, live)).toBe(false); // 2 of 3
      await prisma.committee.update({ where: { id: w.committee }, data: { quorumCount: 2 } });
      expect(await thresholdMet(stage, entry, w.org, live)).toBe(false); // still 3: the snapshot
    });

    it('an entry made before ACC-239 has no snapshot and keeps the live read', async () => {
      const w = await world();
      const { stage } = await voteStage(w);
      const instance = await workflow.startInstance('MEETING', `meeting-${randomUUID()}`, w.org, w.approver.userId);
      const entry = await prisma.workflowInstanceStage.update({
        where: { id: (await prisma.workflowInstanceStage.findFirstOrThrow({ where: { workflowInstanceId: instance.id } })).id },
        data: { quorumCount: null },
      });
      for (const u of [w.approver.userId, w.approver2.userId]) {
        await prisma.workflowApproval.create({ data: { workflowInstanceStageId: entry.id, approverId: u, decision: 'APPROVED' } });
      }
      const live = await prisma.workflowInstance.findFirstOrThrow({ where: { id: instance.id } });
      expect(await thresholdMet(stage, entry, w.org, live)).toBe(false);
      await prisma.committee.update({ where: { id: w.committee }, data: { quorumCount: 2 } });
      expect(await thresholdMet(stage, entry, w.org, live)).toBe(true);
    });
  });

  // ── The fixed template (Q15) ─────────────────────────────────────────────────

  describe('the workflow editor', () => {
    async function crTemplate(w: World) {
      const tpl = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: w.org, objectType: 'COMMITTEE_CHANGE_REQUEST' } });
      const stages = await prisma.workflowStage.findMany({ where: { workflowTemplateId: tpl.id } });
      const transition = await prisma.workflowTransition.findFirstOrThrow({ where: { fromStage: { workflowTemplateId: tpl.id } } });
      const action = await prisma.workflowTransitionAction.findFirstOrThrow({ where: { workflowTransitionId: transition.id } });
      return { tpl, stages, transition, action, stage: (key: string) => stages.find((s) => s.key === key)! };
    }
    const edit = async (p: Promise<unknown>): Promise<string> =>
      p.then(
        () => 'OK',
        (e: { getResponse?: () => { code?: string; edit?: string } }) => `${e.getResponse?.()?.code}:${e.getResponse?.()?.edit}`,
      );

    it('refuses every reshaping, with the protected code and what was refused', async () => {
      const w = await world();
      const t = await crTemplate(w);
      const a = w.approver.userId;
      const P = 'WORKFLOW_TEMPLATE_PROTECTED';
      expect(await edit(templates.createTemplate({ nameEn: 'Second', objectType: 'COMMITTEE_CHANGE_REQUEST' } as never, w.org, a))).toBe(`${P}:CREATE_TEMPLATE`);
      expect(await edit(templates.updateTemplate(t.tpl.id, { isDefault: false } as never, w.org, a))).toBe(`${P}:REPLACE_DEFAULT`);
      expect(await edit(templates.updateTemplate(t.tpl.id, { objectType: 'DOCUMENT' } as never, w.org, a))).toBe(`${P}:CHANGE_TYPE`);
      expect(await edit(templates.deactivateTemplate(t.tpl.id, w.org, a))).toBe(`${P}:DEACTIVATE`);
      expect(await edit(templates.addStage(t.tpl.id, { nameEn: 'Legal review', order: 22 } as never, w.org, a))).toBe(`${P}:ADD_STAGE`);
      expect(await edit(templates.removeStage(t.stage('returned').id, w.org, a))).toBe(`${P}:REMOVE_STAGE`);
      expect(await edit(templates.updateStage(t.stage('under_review').id, { order: 99 } as never, w.org, a))).toBe(`${P}:STAGE_FIELD`);
      expect(
        await edit(templates.addTransition({ fromStageId: t.stage('draft').id, toStageId: t.stage('approved').id, labelEn: 'Skip' } as never, w.org, a)),
      ).toBe(`${P}:TRANSITION`);
      expect(await edit(templates.updateTransition(t.transition.id, { labelEn: 'Go' } as never, w.org, a))).toBe(`${P}:TRANSITION`);
      expect(await edit(templates.removeTransition(t.transition.id, w.org, a))).toBe(`${P}:TRANSITION`);
      expect(await edit(templates.addTransitionAction(t.transition.id, { actionType: 'SEND_NOTIFICATION', order: 5 } as never, w.org, a))).toBe(`${P}:TRANSITION`);
      expect(await edit(templates.updateTransitionAction(t.action.id, { isEnabled: false } as never, w.org, a))).toBe(`${P}:TRANSITION`);
      expect(await edit(templates.removeTransitionAction(t.action.id, w.org, a))).toBe(`${P}:TRANSITION`);
      expect(
        await edit(
          stageTasks.create(t.stage('under_review').id, { titleEn: 'Legal check', isMandatory: true, priority: 'MEDIUM', assignKind: 'RECORD_UNIT_POSITION' } as never, w.org, a),
        ),
      ).toBe(`${P}:STAGE_TASKS`);

      // Nothing moved.
      const after = await crTemplate(w);
      expect(after.tpl).toMatchObject({ isDefault: true, isActive: true, objectType: 'COMMITTEE_CHANGE_REQUEST' });
      expect(after.stages).toHaveLength(6);
    });

    it('a type change TO the protected type, and a second default via another template, are refused too', async () => {
      const w = await world();
      const other = await prisma.workflowTemplate.create({ data: { organizationId: w.org, nameEn: 'Docs', objectType: 'DOCUMENT', isDefault: true, isActive: true } });
      expect(await edit(templates.updateTemplate(other.id, { objectType: 'COMMITTEE_CHANGE_REQUEST' } as never, w.org, w.approver.userId))).toBe(
        'WORKFLOW_TEMPLATE_PROTECTED:CHANGE_TYPE',
      );
    });

    it('renaming a stage, giving it a deadline and re-sending its unchanged fields are allowed', async () => {
      const w = await world();
      const t = await crTemplate(w);
      const stage = t.stage('under_review');
      expect(
        await edit(
          templates.updateStage(
            stage.id,
            { nameEn: 'Quality review', nameAr: 'مراجعة الجودة', slaWorkingHours: 16, order: stage.order, isFinal: stage.isFinal } as never,
            w.org,
            w.approver.userId,
          ),
        ),
      ).toBe('OK');
      expect(await prisma.workflowStage.findFirstOrThrow({ where: { id: stage.id } })).toMatchObject({ nameEn: 'Quality review', slaWorkingHours: 16, key: 'under_review' });
      expect(await edit(templates.updateTemplate(t.tpl.id, { nameEn: 'Committee changes' } as never, w.org, w.approver.userId))).toBe('OK');
    });
  });

  // ── The stage outcomes the app's moves record (ACC-202) ───────────────────────

  // ACC-202 — the app's own moves record the outcome of their KIND, as a
  // person's press does: there is no outcome option any more. Before ACC-202
  // withdraw recorded SKIPPED and return and reject REJECTED.
  describe('stage outcomes (ACC-202)', () => {
    /** The request's stage entries, oldest first, as "key:outcome". */
    const trail = async (w: World, requestId: string): Promise<string[]> => {
      const instance = await prisma.workflowInstance.findFirstOrThrow({
        where: { organizationId: w.org, objectType: 'COMMITTEE_CHANGE_REQUEST', objectId: requestId },
      });
      const entries = await prisma.workflowInstanceStage.findMany({
        where: { workflowInstanceId: instance.id },
        orderBy: { enteredAt: 'asc' },
        select: { outcome: true, stage: { select: { key: true } } },
      });
      return entries.map((e) => `${e.stage.key}:${e.outcome}`);
    };

    it('submit is APPROVED, return RETURNED, submit again APPROVED, reject EXITED', async () => {
      const w = await world();
      const r = await submitted(w);
      await requests.returnForChanges(r.id, { note: 'Say which members' }, w.org, w.approver);
      await requests.submit(r.id, w.org, w.requester);
      await requests.reject(r.id, { reason: 'Not needed' }, w.org, w.approver);
      expect(await trail(w, r.id)).toEqual([
        'draft:APPROVED',
        'under_review:RETURNED',
        'returned:APPROVED',
        'under_review:EXITED',
        'rejected:PENDING',
      ]);
    });

    it('approve is APPROVED, and withdraw is EXITED', async () => {
      const w = await world();
      const r = await submitted(w);
      await requests.approve(r.id, w.org, w.approver);
      expect(await trail(w, r.id)).toEqual(['draft:APPROVED', 'under_review:APPROVED', 'approved:PENDING']);

      const w2 = await world();
      const draft = await requests.create(w2.committee, { changes: { quorumCount: 4 } as never, reason: 'Grew' }, w2.org, w2.requester);
      await requests.withdraw(draft.id, w2.org, w2.requester);
      expect(await trail(w2, draft.id)).toEqual(['draft:EXITED', 'withdrawn:PENDING']);
    });
  });

  // ── Another organisation ─────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it("should NOT return records belonging to a different tenant — another organisation's change request is the same 404 as a missing one", async () => {
      const w = await world();
      const r = await submitted(w);
      const other = await world();
      const invented = randomUUID();
      const asOther = other.approver;
      const pairs: [string, (id: string) => Promise<unknown>][] = [
        ['getOne', (id) => requests.getOne(id, other.org, asOther)],
        ['update', (id) => requests.update(id, { reason: 'x' }, other.org, other.requester)],
        ['submit', (id) => requests.submit(id, other.org, other.requester)],
        ['withdraw', (id) => requests.withdraw(id, other.org, asOther)],
        ['approve', (id) => requests.approve(id, other.org, asOther)],
        ['return', (id) => requests.returnForChanges(id, { note: 'n' }, other.org, asOther)],
        ['reject', (id) => requests.reject(id, { reason: 'n' }, other.org, asOther)],
      ];
      for (const [, call] of pairs) {
        const real = await body(call(r.id));
        expect(real).toEqual(await body(call(invented)));
        expect(real).toEqual([404, expect.objectContaining({ message: 'Change request not found' })]);
      }
      // Committee-scoped: the list, the banner, the preview and raising one.
      for (const call of [
        (id: string) => requests.list(id, {}, other.org, asOther),
        (id: string) => requests.openSummary(id, other.org, asOther),
        (id: string) => requests.preview(id, { quorumCount: 9 }, other.org, { userId: 'viewer-1', permissions: ['committees:view'] }),
        (id: string) => requests.create(id, { changes: { quorumCount: 9 }, reason: 'r' }, other.org, other.requester),
      ]) {
        const real = await body(call(w.committee));
        expect(real).toEqual(await body(call(invented)));
        expect(real).toEqual([404, expect.objectContaining({ message: 'Committee not found' })]);
      }
      expect(await requests.awaitingDecision(other.org, asOther)).toEqual([]);
      expect((await prisma.committee.findFirstOrThrow({ where: { id: w.committee } })).quorumCount).toBe(3);
      expect((await requests.getOne(r.id, w.org, w.approver)).status).toBe('under_review');
    });
  });

  // ── ACC-281 — members of THIS committee (Ahmad, 7 Nov) ───────────────────────
  //
  // A member without committees:view reads every request of their committee, and
  // raises, edits, submits and withdraws with the action's own permission.
  // Deciding (approve, return, reject) is not opened to them: those routes keep
  // committees:view at the route (pinned in committee-change-request.controller
  // .spec.ts with the real guard). Four callers on each: an active member, a
  // former member, a non-member (none holding committees:view), and a view holder.

  describe('ACC-281 — members of the committee', () => {
    interface People {
      member: ChangeRequestViewer;
      former: ChangeRequestViewer;
      stranger: ChangeRequestViewer;
    }

    async function people(w: World): Promise<People> {
      const make = async (name: string, active: boolean | null) => {
        const id = (await prisma.user.create({ data: { organizationId: w.org, email: `${w.slug}-${name}@example.test`, name, status: 'ACTIVE' } })).id;
        if (active !== null) {
          await prisma.committeeMember.create({
            data: { organizationId: w.org, committeeId: w.committee, userId: id, roleValueId: 'seat', isActive: active, leftAt: active ? null : new Date() },
          });
        }
        return { userId: id, permissions: [EDIT] };
      };
      return { member: await make('Member', true), former: await make('Former', false), stranger: await make('Stranger', null) };
    }

    const READ_REFUSED = [403, expect.objectContaining({ message: 'Required permission: committees:view' })];

    it('reads: a member and a view holder read; a former member and a stranger get the identical 403', async () => {
      const w = await world();
      const p = await people(w);
      const r = await submitted(w);
      const reads: [string, (v: ChangeRequestViewer, id: string) => Promise<unknown>][] = [
        ['list', (v, id) => requests.list(id, {}, w.org, v)],
        ['open', (v, id) => requests.openSummary(id, w.org, v)],
        ['preview', (v, id) => requests.preview(id, { quorumCount: 4 }, w.org, v)],
      ];
      for (const [name, read] of reads) {
        expect([name, await outcome(read(p.member, w.committee))]).toEqual([name, 'OK']);
        expect([name, await outcome(read(w.reader, w.committee))]).toEqual([name, 'OK']);
        expect([name, await body(read(p.former, w.committee))]).toEqual([name, READ_REFUSED]);
        expect([name, await body(read(p.stranger, w.committee))]).toEqual([name, READ_REFUSED]);
        expect([name, await body(read(p.stranger, randomUUID()))]).toEqual([name, READ_REFUSED]);
      }
      // One request by id: the same, and identical for an invented id.
      expect(await outcome(requests.getOne(r.id, w.org, p.member))).toBe('OK');
      expect(await body(requests.getOne(r.id, w.org, p.former))).toEqual(READ_REFUSED);
      expect(await body(requests.getOne(r.id, w.org, p.stranger))).toEqual(READ_REFUSED);
      expect(await body(requests.getOne(randomUUID(), w.org, p.stranger))).toEqual(READ_REFUSED);
    });

    it('raise, edit and submit: a member with edit_details does; a former member and a stranger get the 404 a missing committee gets', async () => {
      const w = await world();
      const p = await people(w);
      const raise = (v: ChangeRequestViewer, id = w.committee) => requests.create(id, { changes: { quorumCount: 4 }, reason: 'r' }, w.org, v);
      expect(await body(raise(p.former))).toEqual([404, expect.objectContaining({ message: 'Committee not found' })]);
      expect(await body(raise(p.stranger))).toEqual([404, expect.objectContaining({ message: 'Committee not found' })]);
      expect(await body(raise(p.stranger, randomUUID()))).toEqual(await body(raise(p.stranger)));

      const draft = await raise(p.member);
      expect(draft.status).toBe('draft');
      expect(await outcome(requests.update(draft.id, { reason: 'Clearer' }, w.org, p.member))).toBe('OK');

      // Someone else's request: a stranger gets the 404 a missing request gets, before "not the requester".
      const missing = await body(requests.update(randomUUID(), { reason: 'x' }, w.org, p.stranger));
      expect(missing).toEqual([404, expect.objectContaining({ message: 'Change request not found' })]);
      expect(await body(requests.update(draft.id, { reason: 'x' }, w.org, p.stranger))).toEqual(missing);
      expect(await body(requests.submit(draft.id, w.org, p.stranger))).toEqual(missing);

      expect(await outcome(requests.submit(draft.id, w.org, p.member))).toBe('OK');
      // Every refusal code is kept: without edit_details, a member is refused by the action's key.
      expect(await outcome(raise({ userId: p.member.userId, permissions: [] }, w.other))).toBe('CHANGE_REQUEST_NOT_ALLOWED');
    });

    it('withdraw: the member who raised it withdraws; once they leave the committee, the request is the 404 a missing one gets', async () => {
      const w = await world();
      const p = await people(w);
      const draft = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'r' }, w.org, p.member);
      await prisma.committeeMember.updateMany({ where: { committeeId: w.committee, userId: p.member.userId }, data: { isActive: false, leftAt: new Date() } });
      expect(await body(requests.withdraw(draft.id, w.org, p.member))).toEqual([404, expect.objectContaining({ message: 'Change request not found' })]);
      await prisma.committeeMember.updateMany({ where: { committeeId: w.committee, userId: p.member.userId }, data: { isActive: true, leftAt: null } });
      expect(await outcome(requests.withdraw(draft.id, w.org, p.member))).toBe('OK');
    });

    itEnforcesTenantIsolation('change requests for a member of another organisation\'s committee', async () => {
      const w = await world();
      const p = await people(w);
      const r = await submitted(w);
      const other = await world();
      // The member of w's committee, asking inside other's organisation.
      expect(await body(requests.getOne(r.id, other.org, p.member))).toEqual(READ_REFUSED);
      expect(await body(requests.list(w.committee, {}, other.org, p.member))).toEqual(READ_REFUSED);
      expect(await body(requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'r' }, other.org, p.member))).toEqual([
        404,
        expect.objectContaining({ message: 'Committee not found' }),
      ]);
    });
  });

  // ── ACC-281 — the awaiting-decision list, filtered in the query, capped at 200 ──

  describe('ACC-281 — awaiting decision', () => {
    it('returns exactly the requests awaitsDecision() keeps — newest instance wins, the viewer\'s own left out — oldest submitted first', async () => {
      const w = await world();
      // Under review, by the requester: the approver sees it.
      const waiting = await submitted(w);
      // A draft, a returned one and a withdrawn one: none waits.
      const draft = await requests.create(w.other, { changes: { quorumCount: 4 }, reason: 'draft' }, w.org, w.requester);
      const returnedOne = await requests.create(w.other, { changes: { quorumCount: 5 }, reason: 'r' }, w.org, w.requester).catch(() => null);
      expect(returnedOne).toBeNull(); // one open request per committee: the draft holds the place
      await requests.withdraw(draft.id, w.org, w.requester);

      const rows = await requests.awaitingDecision(w.org, w.approver);
      expect(rows.map((r) => r.id)).toEqual([waiting.id]);
      // The requester never decides their own, so it is not waiting on them.
      expect(await requests.awaitingDecision(w.org, w.requester)).toEqual([]);
      // Returned: no longer waiting.
      await requests.returnForChanges(waiting.id, { note: 'more detail' }, w.org, w.approver);
      expect(await requests.awaitingDecision(w.org, w.approver)).toEqual([]);
    });

    it('is capped at 200, oldest submitted first — and the stage filter is in the query, not after it', async () => {
      const w = await world();
      // 201 requests standing in Under review, written directly (the engine would
      // allow one open request per committee): each with its own committee and
      // its own instance pointed at the seeded under_review stage.
      const tpl = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: w.org, objectType: 'COMMITTEE_CHANGE_REQUEST' } });
      const underReview = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: tpl.id, key: 'under_review' } });
      const withdrawn = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: tpl.id, key: 'withdrawn' } });
      const base = Date.UTC(2026, 9, 1);
      // 50 OLDER requests that were submitted and then withdrawn. If the query did
      // not filter by stage, they would take 50 of the 200 places and the guard
      // after it would drop them, leaving 150: so 200 proves the filter is in SQL.
      for (let i = 0; i < 50; i++) {
        const c = await prisma.committee.create({ data: { organizationId: w.org, nameEn: `W${i}`, typeValueId: 'type', orgUnitId: w.unit } });
        const r = await prisma.committeeChangeRequest.create({
          data: { organizationId: w.org, committeeId: c.id, number: 1, requestedById: w.requester.userId, reason: 'r', changes: { quorumCount: 4 }, submittedAt: new Date(base - (i + 1) * 60_000) },
        });
        await prisma.workflowInstance.create({
          data: { organizationId: w.org, workflowTemplateId: tpl.id, objectType: 'COMMITTEE_CHANGE_REQUEST', objectId: r.id, status: 'COMPLETED', currentStageId: withdrawn.id },
        });
      }
      for (let i = 0; i < 201; i++) {
        const c = await prisma.committee.create({ data: { organizationId: w.org, nameEn: `C${i}`, typeValueId: 'type', orgUnitId: w.unit } });
        const r = await prisma.committeeChangeRequest.create({
          data: {
            organizationId: w.org,
            committeeId: c.id,
            number: 1,
            requestedById: w.requester.userId,
            reason: 'r',
            changes: { quorumCount: 4 },
            submittedAt: new Date(base + i * 60_000),
          },
        });
        await prisma.workflowInstance.create({
          data: { organizationId: w.org, workflowTemplateId: tpl.id, objectType: 'COMMITTEE_CHANGE_REQUEST', objectId: r.id, status: 'IN_PROGRESS', currentStageId: underReview.id },
        });
      }
      const rows = await requests.awaitingDecision(w.org, w.approver);
      expect(rows).toHaveLength(200);
      const times = rows.map((r) => new Date(r.submittedAt!).getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times[0]).toBe(base);
    });

    itEnforcesTenantIsolation('awaiting decision filtered in the query', async () => {
      const w = await world();
      await submitted(w);
      const other = await world();
      expect(await requests.awaitingDecision(other.org, other.approver)).toEqual([]);
      expect(await requests.awaitingDecision(w.org, w.approver)).toHaveLength(1);
    });
  });

  // ── Reads ────────────────────────────────────────────────────────────────────

  describe('reads', () => {
    it('the list sorts by number, status and requested, and the banner shows the open one', async () => {
      const w = await world();
      const first = await submitted(w, { quorumCount: 5 });
      await requests.reject(first.id, { reason: 'No' }, w.org, w.approver);
      const second = await requests.create(w.committee, { changes: { quorumCount: 6 }, reason: 'Again' }, w.org, w.requester);

      const page = await requests.list(w.committee, { sort: 'number', dir: 'asc' }, w.org, w.reader);
      expect(page).toMatchObject({ total: 2, matching: 2 });
      expect(page.items.map((i) => i.number)).toEqual([1, 2]);
      expect((await requests.list(w.committee, { sort: 'status', dir: 'asc' }, w.org, w.reader)).items.map((i) => i.status)).toEqual(['draft', 'rejected']);
      expect((await requests.list(w.committee, { q: '#2' }, w.org, w.reader)).items.map((i) => i.id)).toEqual([second.id]);
      expect((await requests.openSummary(w.committee, w.org, w.reader)).request?.id).toBe(second.id);
      expect((await requests.getOne(second.id, w.org, w.reader)).actions).toEqual({
        edit: false,
        submit: false,
        withdraw: false,
        approve: false,
        return: false,
        reject: false,
        approveNow: false,
      });
    });

    it('awaiting decision lists requests under review that the viewer did not raise', async () => {
      const w = await world();
      const r = await submitted(w);
      expect((await requests.awaitingDecision(w.org, w.approver)).map((i) => i.id)).toEqual([r.id]);
      expect(await requests.awaitingDecision(w.org, w.requester)).toEqual([]);
    });

    it('the preview names what approval would change, and how many votes keep their quorum', async () => {
      const w = await world();
      const preview = await requests.preview(w.committee, { quorumCount: 5, nameEn: 'New name', meetingFrequency: 'MONTHLY' }, w.org, { userId: 'viewer-1', permissions: ['committees:view'] });
      expect(preview.changedFields).toEqual(['nameEn', 'quorumCount']);
      expect(preview.impacts).toEqual([{ code: 'QUORUM', from: 3, to: 5, inProgress: 0 }, { code: 'NAME' }, { code: 'TERMS_TASK' }]);
    });

    // ACC-271 PR 6a — "votes that keep their quorum" are the open entries of
    // Committee vote stages (whoMode COMMITTEE_VOTE) whose vote committee is this
    // one: the stage's Committee entry's own committee, else the record's. A
    // Committee entry alone does not make a vote: the mode does.
    describe('open votes the preview counts', () => {
      /** A stage made a Committee vote, on `committeeId` (null: the record's own). */
      const voteStage = async (w: World, key: string, committeeId: string | null) => {
        await prisma.workflowStage.update({ where: { id: w.stageOf[key] }, data: { whoMode: 'COMMITTEE_VOTE' } });
        await prisma.workflowStageAssignee.create({ data: { organizationId: w.org, stageId: w.stageOf[key]!, order: 1, kind: 'COMMITTEE', committeeId } });
      };
      const instanceOf = async (w: World, committeeId: string) =>
        (await prisma.workflowInstance.findFirstOrThrow({ where: { organizationId: w.org, objectType: 'COMMITTEE', objectId: committeeId } })).id;
      const openEntry = async (w: World, committeeId: string, key: string, exitedAt: Date | null = null) =>
        prisma.workflowInstanceStage.create({ data: { workflowInstanceId: await instanceOf(w, committeeId), stageId: w.stageOf[key]!, exitedAt } });

      it("counts a vote on this committee 1, a vote on another committee 0, and a closed entry 0", async () => {
        const w = await world();
        await voteStage(w, 'terms_review', null); // the record's own committee
        await voteStage(w, 'formation', w.other); // always the other committee
        // A stage worked by this committee that is NOT a vote (Any one of them): not counted.
        // ACC-278 — this was an old approvalMode COMMITTEE decoy; PR B dropped that column.
        await prisma.workflowStage.update({ where: { id: w.stageOf['dissolution_pending'] }, data: { whoMode: 'ANY_ONE' } });
        await prisma.workflowStageAssignee.create({ data: { organizationId: w.org, stageId: w.stageOf['dissolution_pending']!, order: 1, kind: 'COMMITTEE', committeeId: null } });

        await openEntry(w, w.committee, 'terms_review'); // this committee's own vote: 1
        await openEntry(w, w.committee, 'terms_review', new Date()); // closed: 0
        await openEntry(w, w.other, 'terms_review'); // the other committee's own vote
        await openEntry(w, w.committee, 'formation'); // this record, but the vote is the other committee's
        await openEntry(w, w.committee, 'dissolution_pending'); // not a Committee vote stage

        const preview = await requests.preview(w.committee, { quorumCount: 5 }, w.org, { userId: 'viewer-1', permissions: ['committees:view'] });
        expect(preview.impacts.find((i) => i.code === 'QUORUM')).toEqual({ code: 'QUORUM', from: 3, to: 5, inProgress: 1 });
        expect(await workflow.countOpenCommitteeVotes(w.org, w.committee)).toBe(1);
        expect(await workflow.countOpenCommitteeVotes(w.org, w.other)).toBe(2);
      });

      itEnforcesTenantIsolation("the open-vote count never counts another organisation's entries", async () => {
        const a = await world();
        const b = await world();
        await voteStage(b, 'terms_review', null);
        await openEntry(b, b.committee, 'terms_review');

        expect(await workflow.countOpenCommitteeVotes(b.org, b.committee)).toBe(1);
        expect(await workflow.countOpenCommitteeVotes(a.org, b.committee)).toBe(0);
        expect(await workflow.countOpenCommitteeVotes(a.org, a.committee)).toBe(0);
      });
    });
  });

  // ── ACC-240: the reads the screens need ─────────────────────────────────────

  describe('ACC-240 — canRaise agrees with create, case by case', () => {
    type Setup = (w: World) => Promise<ChangeRequestViewer>;
    const asRequester: Setup = async (w) => w.requester;
    const inStage = (key: string): Setup => async (w) => {
      await setCommitteeStage(w, w.committee, key);
      return w.requester;
    };
    const withRequestIn = (stage: 'draft' | 'under_review' | 'returned' | 'approved' | 'rejected' | 'withdrawn'): Setup => async (w) => {
      const r = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'r' }, w.org, w.editor2);
      if (stage === 'draft') return w.requester;
      if (stage === 'withdrawn') {
        await requests.withdraw(r.id, w.org, w.editor2);
        return w.requester;
      }
      await requests.submit(r.id, w.org, w.editor2);
      if (stage === 'returned') await requests.returnForChanges(r.id, { note: 'n' }, w.org, w.approver);
      if (stage === 'approved') await requests.approve(r.id, w.org, w.approver);
      if (stage === 'rejected') await requests.reject(r.id, { reason: 'n' }, w.org, w.approver);
      return w.requester;
    };

    // [case, setup, what create answers]
    const CASES: [string, Setup, string][] = [
      ['Active, no request, committees:edit_details', asRequester, 'OK'],
      ['Suspended, no request', inStage('suspended'), 'OK'],
      ['without committees:edit_details (an approver)', async (w) => w.approver, 'CHANGE_REQUEST_NOT_ALLOWED'],
      ['with committees:view only', async (w) => w.reader, 'CHANGE_REQUEST_NOT_ALLOWED'],
      ['Formation', inStage('formation'), 'CHANGE_REQUEST_STAGE_NOT_ALLOWED'],
      ['Terms Review', inStage('terms_review'), 'CHANGE_REQUEST_STAGE_NOT_ALLOWED'],
      ['Dissolution Pending', inStage('dissolution_pending'), 'CHANGE_REQUEST_COMMITTEE_DISSOLVING'],
      ['Dissolved', inStage('dissolved'), 'CHANGE_REQUEST_COMMITTEE_DISSOLVING'],
      [
        // ACC-255 PR 2: the key is never read — a stage keeps its rules without it.
        'a committee stage with no key, which allows request_change',
        async (w) => {
          await prisma.workflowStage.update({ where: { id: w.stageOf['active']! }, data: { key: null } });
          return w.requester;
        },
        'OK',
      ],
      [
        'a committee stage that does not allow request_change',
        async (w) => {
          await prisma.workflowStageRecordAction.deleteMany({ where: { organizationId: w.org, stageId: w.stageOf['active']! } });
          return w.requester;
        },
        'CHANGE_REQUEST_STAGE_NOT_ALLOWED',
      ],
      ['an open draft (someone else\'s)', withRequestIn('draft'), 'CHANGE_REQUEST_ALREADY_OPEN'],
      ['an open request under review', withRequestIn('under_review'), 'CHANGE_REQUEST_ALREADY_OPEN'],
      ['an open request returned for changes', withRequestIn('returned'), 'CHANGE_REQUEST_ALREADY_OPEN'],
      [
        'an open request in a stage with no key',
        async (w) => {
          await withRequestIn('draft')(w);
          await prisma.workflowStage.updateMany({ where: { workflowTemplate: { organizationId: w.org, objectType: 'COMMITTEE_CHANGE_REQUEST' }, key: 'draft' }, data: { key: null } });
          return w.requester;
        },
        'CHANGE_REQUEST_ALREADY_OPEN',
      ],
      ['only a withdrawn request', withRequestIn('withdrawn'), 'OK'],
      ['only a rejected request', withRequestIn('rejected'), 'OK'],
      ['only an approved request', withRequestIn('approved'), 'OK'],
    ];

    it.each(CASES)('%s: create answers %s, and canRaise says the same', async (_case, setup, expected) => {
      const w = await world();
      const viewer = await setup(w);
      const before = await requests.openSummary(w.committee, w.org, viewer);
      const created = await outcome(requests.create(w.committee, { changes: { quorumCount: 9 }, reason: 'r' }, w.org, viewer));
      // Non-vacuity first: create really answered what this case is about.
      expect(created).toBe(expected);
      expect(before.canRaise).toBe(created === 'OK');
    });

    it('covers every refusal create can make for a valid proposal, and the success', () => {
      const codes = new Set(CASES.map(([, , code]) => code));
      expect([...codes].sort()).toEqual(
        ['CHANGE_REQUEST_ALREADY_OPEN', 'CHANGE_REQUEST_COMMITTEE_DISSOLVING', 'CHANGE_REQUEST_NOT_ALLOWED', 'CHANGE_REQUEST_STAGE_NOT_ALLOWED', 'OK'].sort(),
      );
    });

    it('the banner still names the open request beside canRaise false', async () => {
      const w = await world();
      const r = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'r' }, w.org, w.editor2);
      const open = await requests.openSummary(w.committee, w.org, w.requester);
      expect({ id: open.request?.id, canRaise: open.canRaise }).toEqual({ id: r.id, canRaise: false });
    });
  });

  describe('ACC-240 — who returned, decided and withdrew it', () => {
    it('names the decider after a return, a reject and an approval, and the withdrawer — from this organisation only', async () => {
      const w = await world();
      const r = await submitted(w);
      expect((await requests.getOne(r.id, w.org, w.reader)).decidedBy).toBeNull();
      await requests.returnForChanges(r.id, { note: 'Say which members' }, w.org, w.approver);
      expect((await requests.getOne(r.id, w.org, w.reader)).decidedBy).toEqual({ id: w.approver.userId, name: 'Approver' });
      await requests.submit(r.id, w.org, w.requester);
      await requests.reject(r.id, { reason: 'No' }, w.org, w.approver2);
      expect((await requests.getOne(r.id, w.org, w.reader)).decidedBy).toEqual({ id: w.approver2.userId, name: 'Approver Two' });

      const second = await submitted(w, { quorumCount: 6 });
      await requests.approve(second.id, w.org, w.approver);
      const approved = (await requests.list(w.committee, {}, w.org, w.reader)).items.find((i) => i.id === second.id)!;
      expect(approved.decidedBy).toEqual({ id: w.approver.userId, name: 'Approver' });
      expect(approved.withdrawnBy).toBeNull();

      const third = await requests.create(w.committee, { changes: { quorumCount: 7 }, reason: 'r' }, w.org, w.requester);
      await requests.withdraw(third.id, w.org, w.requester);
      expect((await requests.getOne(third.id, w.org, w.reader)).withdrawnBy).toEqual({ id: w.requester.userId, name: 'Requester' });
    });
  });

  describe('ACC-240 — labels for the id-valued fields', () => {
    /** A committee_type value in `org` (the system category, created once if this database lacks it). */
    async function typeValue(org: string, labelEn: string, labelAr: string | null, isActive = true): Promise<string> {
      const category =
        (await prisma.lookupCategory.findFirst({ where: { key: 'committee_type', organizationId: null } })) ??
        (await prisma.lookupCategory.create({ data: { key: 'committee_type', labelEn: 'Committee type', labelAr: 'نوع اللجنة' } as never }));
      return (
        await prisma.lookupValue.create({
          data: { organizationId: org, categoryId: category.id, key: `t-${randomUUID().slice(0, 8)}`, labelEn, labelAr, layer: 'TENANT', isActive } as never,
        })
      ).id;
    }

    it('names the type, unit and committees a request names — inactive values too — in both languages', async () => {
      const w = await world();
      const oldType = await typeValue(w.org, 'Standing committee', 'لجنة دائمة');
      const newType = await typeValue(w.org, 'Task force', null, false);
      await prisma.committee.update({ where: { id: w.committee }, data: { typeValueId: oldType } });
      const unit2 = (await prisma.orgUnit.create({ data: { organizationId: w.org, nameEn: 'Pharmacy', nameAr: 'الصيدلية', code: `P-${w.slug}`, parentId: w.unit } })).id;
      await prisma.committee.update({ where: { id: w.other }, data: { nameAr: 'لجنة سلامة المرضى' } });

      const r = await submitted(w, { typeValueId: newType, orgUnitId: unit2, reportingToCommitteeId: w.other });
      // Deactivated after it was proposed: a closed request still names it.
      await prisma.orgUnit.update({ where: { id: unit2 }, data: { isActive: false } });
      const read = await requests.getOne(r.id, w.org, w.reader);
      expect(read.labels).toEqual({
        [oldType]: { en: 'Standing committee', ar: 'لجنة دائمة' },
        [newType]: { en: 'Task force', ar: null },
        [w.unit]: { en: 'Root', ar: null },
        [unit2]: { en: 'Pharmacy', ar: 'الصيدلية' },
        [w.other]: { en: 'Patient Safety Committee', ar: 'لجنة سلامة المرضى' },
      });

      const preview = await requests.preview(w.committee, { reportingToCommitteeId: w.other }, w.org, { userId: 'viewer-1', permissions: ['committees:view'] });
      expect(preview.labels).toEqual({ [w.other]: { en: 'Patient Safety Committee', ar: 'لجنة سلامة المرضى' } });
    });

    it("should NOT return records belonging to a different tenant — another organisation's type, unit, committee and person ids never resolve", async () => {
      const a = await world();
      const b = await world();
      const bType = await typeValue(b.org, 'Their type', 'نوعهم');
      const aType = await typeValue(a.org, 'Our type', 'نوعنا');
      const r = await submitted(a, { quorumCount: 6 });
      // A request naming B's ids, as a corrupt row would: the labels stay A's.
      await prisma.committeeChangeRequest.update({
        where: { id: r.id },
        data: {
          changes: { typeValueId: bType, orgUnitId: b.unit, parentCommitteeId: b.committee, reportingToCommitteeId: a.other },
          fromValues: { typeValueId: aType },
          // And people from B, as a corrupt row would name them: never named.
          decidedById: b.approver.userId,
          withdrawnById: b.requester.userId,
        },
      });
      const read = await requests.getOne(r.id, a.org, a.reader);
      expect({ decidedBy: read.decidedBy, withdrawnBy: read.withdrawnBy }).toEqual({ decidedBy: null, withdrawnBy: null });
      // Non-vacuity: A's own ids in the same request do resolve.
      expect(read.labels[aType]).toEqual({ en: 'Our type', ar: 'نوعنا' });
      expect(read.labels[a.other]).toEqual({ en: 'Patient Safety Committee', ar: null });
      for (const foreign of [bType, b.unit, b.committee]) expect(read.labels[foreign]).toBeUndefined();
      expect(Object.keys(read.labels).sort()).toEqual([aType, a.other].sort());
    });
  });

  // ── ACC-283 PR 2: the chain of authority, Approve now, the finish task ──────
  //
  // In this world both approvers hold the root unit's head position and the
  // committees are owned by the root, so the chain's root step names them both.

  describe('ACC-283 PR 2 — the chain decides', () => {
    const FINISH = 'Finish or withdraw the change request';
    const finishTasks = (w: World) =>
      prisma.task.findMany({ where: { organizationId: w.org, sourceId: w.committee, title: FINISH }, orderBy: { createdAt: 'asc' } });
    const noHead = (w: World, ...userIds: string[]) =>
      prisma.user.updateMany({ where: { id: { in: userIds }, organizationId: w.org }, data: { positionId: null } });

    it('the finish task: made on create for the requester, completed on Submit, made again on Return, cancelled on Withdraw', async () => {
      const w = await world();
      const draft = await requests.create(w.committee, { changes: { quorumCount: 5 }, reason: 'r' }, w.org, w.requester);
      let tasks = await finishTasks(w);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ titleAr: 'إكمال طلب التغيير أو سحبه', sourceType: 'COMMITTEE', status: 'PENDING', createdById: w.requester.userId });
      expect(draft.finishTaskId).toBe(tasks[0]!.id);
      expect(await prisma.taskAssignee.findMany({ where: { taskId: tasks[0]!.id }, select: { userId: true } })).toEqual([{ userId: w.requester.userId }]);
      // The requester made it themselves: no "assigned to you" notice.
      expect(notices.filter((n) => n.userId === w.requester.userId && n.titleEn === 'New task assigned')).toEqual([]);

      await requests.submit(draft.id, w.org, w.requester);
      expect((await finishTasks(w))[0]).toMatchObject({ status: 'COMPLETED', completedById: w.requester.userId });

      await requests.returnForChanges(draft.id, { note: 'Which members?' }, w.org, w.approver);
      tasks = await finishTasks(w);
      expect(tasks.map((t) => t.status)).toEqual(['COMPLETED', 'PENDING']);
      expect((await requests.getOne(draft.id, w.org, w.requester)).finishTaskId).toBe(tasks[1]!.id);

      await requests.withdraw(draft.id, w.org, w.requester);
      expect((await finishTasks(w)).map((t) => t.status)).toEqual(['COMPLETED', 'CANCELLED']);
    });

    it('Submit tells the deciders; each decision records its authority, the step that decided', async () => {
      const w = await world();
      const r = await submitted(w);
      expect(notices.filter((n) => n.titleEn.includes('to review')).map((n) => n.userId).sort()).toEqual([w.approver.userId, w.approver2.userId].sort());
      const read = await requests.getOne(r.id, w.org, w.reader);
      expect(read.awaitingDecisionBy).toEqual({ kind: 'UNIT_HEAD', unit: { id: w.unit, nameEn: 'Root', nameAr: null } });
      await requests.approve(r.id, w.org, w.approver);
      const row = await prisma.auditLog.findFirstOrThrow({ where: { objectId: r.id, action: 'APPROVE' } });
      expect((row.metadata as { authority: unknown }).authority).toEqual({ kind: 'UNIT_HEAD', unitId: w.unit, isRoot: true });
    });

    it('a re-route: once a head leaves the position, they decide nothing; the other still does', async () => {
      const w = await world();
      const r = await submitted(w);
      await noHead(w, w.approver2.userId);
      expect((await requests.getOne(r.id, w.org, w.approver2)).actions.approve).toBe(false);
      expect(await outcome(requests.approve(r.id, w.org, w.approver2))).toBe('CHANGE_REQUEST_NOT_DECIDER');
      expect(await outcome(requests.approve(r.id, w.org, w.approver))).toBe('OK');
    });

    it('a decider with no committee key reads the request by id and finds it awaiting them; a stranger does neither', async () => {
      const w = await world();
      const r = await submitted(w);
      const bare = { userId: w.approver.userId, permissions: [] as string[] };
      expect(await outcome(requests.getOne(r.id, w.org, bare))).toBe('OK');
      expect((await requests.awaitingDecision(w.org, bare)).map((x) => x.id)).toEqual([r.id]);
      const stranger = await prisma.user.create({ data: { organizationId: w.org, email: `${w.slug}-x@example.test`, name: 'X', status: 'ACTIVE' } });
      expect(await outcome(requests.getOne(r.id, w.org, { userId: stranger.id, permissions: [] }))).toBe('Required permission: committees:view');
      expect(await requests.awaitingDecision(w.org, { userId: stranger.id, permissions: [APPROVE] })).toEqual([]);
    });

    it('a root that is already headless: Submit is refused with CHANGE_REQUEST_NO_DECIDER, and the request stays a draft', async () => {
      const w = await world();
      await noHead(w, w.approver.userId, w.approver2.userId);
      const draft = await requests.create(w.committee, { changes: { quorumCount: 5 }, reason: 'r' }, w.org, w.requester);
      expect((await requests.getOne(draft.id, w.org, w.requester)).actions).toMatchObject({ submit: false, approveNow: false });
      expect(await body(requests.submit(draft.id, w.org, w.requester))).toEqual([409, expect.objectContaining({ code: 'CHANGE_REQUEST_NO_DECIDER' })]);
      expect(await body(requests.submit(draft.id, w.org, w.requester))).not.toEqual([409, expect.objectContaining({ approveNow: true })]);
      expect((await requests.getOne(draft.id, w.org, w.requester)).status).toBe('draft');
    });

    describe('Approve now (Q4)', () => {
      const asRootHead = (w: World) => ({ userId: w.approver.userId, permissions: [VIEW, EDIT] });

      it('the ONLY root head: no Send for decision, only Approve now; Submit says so; Approve now applies it as their own', async () => {
        const w = await world();
        await noHead(w, w.approver2.userId);
        const me = asRootHead(w);
        const draft = await requests.create(w.committee, { changes: { quorumCount: 5 }, reason: 'r' }, w.org, me);
        expect(draft.actions).toMatchObject({ submit: false, approveNow: true });
        expect(await body(requests.submit(draft.id, w.org, me))).toEqual([409, expect.objectContaining({ code: 'CHANGE_REQUEST_NO_DECIDER', approveNow: true })]);

        notices.length = 0;
        const done = await requests.approveNow(draft.id, w.org, me);
        expect(done.status).toBe('approved');
        expect((await prisma.committee.findFirstOrThrow({ where: { id: w.committee } })).quorumCount).toBe(5);
        const row = await prisma.auditLog.findFirstOrThrow({ where: { objectId: draft.id, action: 'APPROVE' } });
        expect((row.metadata as { authority: unknown }).authority).toEqual({ kind: 'ROOT_HEAD_OWN' });
        expect((await finishTasks(w))[0]!.status).toBe('COMPLETED');
        expect(await prisma.task.count({ where: { organizationId: w.org, sourceId: w.committee, title: 'Revise the terms of reference' } })).toBe(1);
        expect(notices.filter((n) => n.titleEn.startsWith('Change request'))).toEqual([]);
      });

      it('with a second root head: both moves offered; once sent for decision, Approve now is not offered again', async () => {
        const w = await world();
        const me = asRootHead(w);
        const draft = await requests.create(w.committee, { changes: { quorumCount: 6 }, reason: 'r' }, w.org, me);
        expect(draft.actions).toMatchObject({ submit: true, approveNow: true });
        await requests.submit(draft.id, w.org, me);
        expect(notices.filter((n) => n.titleEn.includes('to review')).map((n) => n.userId)).toEqual([w.approver2.userId]);
        expect((await requests.getOne(draft.id, w.org, me)).actions.approveNow).toBe(false);
        expect(await outcome(requests.approveNow(draft.id, w.org, me))).toBe('CHANGE_REQUEST_APPROVE_NOW_NOT_ALLOWED');
        expect(await outcome(requests.approve(draft.id, w.org, w.approver2))).toBe('OK');
      });

      it('nobody else gets it: a requester who does not head the root, and a root head on someone else\'s request', async () => {
        const w = await world();
        const draft = await requests.create(w.committee, { changes: { quorumCount: 5 }, reason: 'r' }, w.org, w.requester);
        expect(draft.actions.approveNow).toBe(false);
        expect(await outcome(requests.approveNow(draft.id, w.org, w.requester))).toBe('CHANGE_REQUEST_APPROVE_NOW_NOT_ALLOWED');
        expect(await outcome(requests.approveNow(draft.id, w.org, asRootHead(w)))).toBe('CHANGE_REQUEST_APPROVE_NOW_NOT_ALLOWED');
        expect((await requests.getOne(draft.id, w.org, w.requester)).status).toBe('draft');
      });

      it('a reference that would fail is refused while still a draft: nothing is submitted', async () => {
        const w = await world();
        await noHead(w, w.approver2.userId);
        const me = asRootHead(w);
        const draft = await requests.create(w.committee, { changes: { reportingToCommitteeId: w.other }, reason: 'r' }, w.org, me);
        await prisma.committee.update({ where: { id: w.other }, data: { isActive: false } });
        expect(await outcome(requests.approveNow(draft.id, w.org, me))).not.toBe('OK');
        expect((await requests.getOne(draft.id, w.org, me)).status).toBe('draft');
      });
    });

    itEnforcesTenantIsolation("the chain of authority — another organisation's root head neither decides nor reads a request here", async () => {
      const w = await world();
      const other = await world();
      const r = await submitted(w);
      expect(await outcome(requests.approve(r.id, w.org, { userId: other.approver.userId, permissions: [] }))).toBe('Change request not found');
      expect(await outcome(requests.getOne(r.id, w.org, { userId: other.approver.userId, permissions: [] }))).toBe('Required permission: committees:view');
      expect(await outcome(requests.approve(r.id, other.org, other.approver))).toBe('Change request not found');
      expect(await requests.awaitingDecision(other.org, other.approver)).toEqual([]);
    });
  });

  // ── The backfill ─────────────────────────────────────────────────────────────

  describe('backfill-acc239-change-request-workflow', () => {
    async function bareOrg(): Promise<string> {
      const slug = `acc239b-${randomUUID().slice(0, 8)}`;
      return (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    }
    const isFixture = () => true;

    it('dry run writes nothing; execute seeds the template with one audit row; a re-run is a no-op', async () => {
      const org = await bareOrg();
      const count = () => prisma.workflowTemplate.count({ where: { organizationId: org, objectType: 'COMMITTEE_CHANGE_REQUEST' } });
      const audits = () => prisma.auditLog.count({ where: { organizationId: org, objectType: 'WorkflowTemplate' } });

      const dry = await runBackfill(prisma, { execute: false, organizationIds: [org], isFixture });
      expect(dry.plans).toEqual([expect.objectContaining({ organizationId: org, existingTemplates: 0, seed: true })]);
      expect(await count()).toBe(0);
      expect(await audits()).toBe(0);

      const run = await runBackfill(prisma, { execute: true, organizationIds: [org], isFixture });
      expect(run.seeded).toHaveLength(1);
      expect(await count()).toBe(1);
      const stages = await prisma.workflowStage.findMany({ where: { workflowTemplate: { organizationId: org } }, orderBy: { order: 'asc' } });
      expect(stages.map((s) => s.key)).toEqual(['draft', 'under_review', 'returned', 'approved', 'rejected', 'withdrawn']);
      expect(await audits()).toBe(1);

      const again = await runBackfill(prisma, { execute: true, organizationIds: [org], isFixture });
      expect(again.plans[0]).toMatchObject({ existingTemplates: 1, seed: false });
      expect(again.seeded).toEqual([]);
      expect(await count()).toBe(1);
      expect(await audits()).toBe(1);
    });

    it('refuses a customer organisation, writing nothing', async () => {
      const org = await bareOrg();
      const run = await runBackfill(prisma, { execute: true, organizationIds: [org] });
      expect(run.refusedCustomers).toHaveLength(1);
      expect(await prisma.workflowTemplate.count({ where: { organizationId: org } })).toBe(0);
    });
  });
  // ── Prompt 85: awaiting-decision costs a non-decider ONE query ──────────────
  describe('awaiting decision — one query for someone who decides nothing (Prompt 85)', () => {
    const DAY = 24 * 60 * 60 * 1000;

    /** The service over a Prisma that counts every query it is asked for. */
    const countedRequests = () => {
      const log: string[] = [];
      const counting = new Proxy(prisma, {
        get(t, k) {
          const v = (t as unknown as Record<string | symbol, unknown>)[k];
          if (k === '$queryRaw') return (...a: unknown[]) => (log.push('$queryRaw'), (v as (...x: unknown[]) => unknown).apply(t, a));
          if (typeof k === 'string' && !k.startsWith('$') && v && typeof v === 'object') {
            return new Proxy(v as object, {
              get(d, m) {
                const f = (d as Record<string | symbol, unknown>)[m];
                return typeof f === 'function' ? (...a: unknown[]) => (log.push(`${k}.${String(m)}`), (f as (...x: unknown[]) => unknown).apply(d, a)) : f;
              },
            });
          }
          return v;
        },
      }) as unknown as PrismaService;
      return { svc: new CommitteeChangeRequestService(counting, workflow, tasks, audit, notifications, new StageRulesService(counting)), log };
    };

    const person = async (w: World, name: string, data: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { organizationId: w.org, email: `${w.slug}-${name}@example.test`, name, status: 'ACTIVE', ...data } })).id;
    const viewerOf = (userId: string): ChangeRequestViewer => ({ userId, permissions: [VIEW] });
    const cover = (w: World, userId: string, data: Record<string, unknown> = {}) =>
      prisma.orgUnitHeadAssignment.create({
        data: { organizationId: w.org, orgUnitId: w.unit, userId, kind: 'ACTING', reason: 'ABSENCE', validFrom: new Date(Date.now() - DAY), createdById: w.approver.userId, ...data },
      });

    it('someone who heads, covers and holds no deciding seat costs exactly ONE query, and gets []', async () => {
      const w = await world();
      await submitted(w);
      const { svc, log } = countedRequests();
      expect(await svc.awaitingDecision(w.org, w.reader)).toEqual([]);
      expect(log).toEqual(['$queryRaw']);
    });

    it('a decider as a HEAD holder still gets the list', async () => {
      const w = await world();
      const waiting = await submitted(w);
      const { svc } = countedRequests();
      expect((await svc.awaitingDecision(w.org, w.approver)).map((r) => r.id)).toEqual([waiting.id]);
    });

    it('a decider as the acting COVER in force still gets the list', async () => {
      const w = await world();
      const waiting = await submitted(w);
      const actingId = await person(w, 'Acting');
      await cover(w, actingId);
      const { svc } = countedRequests();
      expect((await svc.awaitingDecision(w.org, viewerOf(actingId))).map((r) => r.id)).toEqual([waiting.id]);
    });

    it('a decider through a deciding SEAT on the Reports-to committee still gets the list', async () => {
      const w = await world();
      // The committee reports to the other one, which is in force; its deciding seat decides.
      await prisma.committee.update({ where: { id: w.committee }, data: { reportingToCommitteeId: w.other } });
      const holder = await person(w, 'Seat Holder');
      await prisma.committeeSeatAction.create({ data: { organizationId: w.org, committeeId: w.other, roleValueId: 'seat-decide', actionKey: SEAT_ACTIONS.DECIDE_REPORTING_CHANGES } });
      await prisma.committeeMember.create({ data: { organizationId: w.org, committeeId: w.other, userId: holder, roleValueId: 'seat-decide' } });
      const waiting = await submitted(w);
      const { svc } = countedRequests();
      expect((await svc.awaitingDecision(w.org, viewerOf(holder))).map((r) => r.id)).toEqual([waiting.id]);
      // The root heads are not this request's deciders any more.
      expect(await svc.awaitingDecision(w.org, w.approver)).toEqual([]);
    });

    it("the one query agrees with unit-headship.ts's rules, person by person", async () => {
      const w = await world();
      const head = await prisma.orgPosition.findFirstOrThrow({ where: { organizationId: w.org, isUnitHeadPosition: true } });
      const closedHead = await prisma.orgPosition.create({ data: { organizationId: w.org, nameEn: 'Old Director', grade: 10, isUnitHeadPosition: true, isActive: false } });
      const plain = await prisma.orgPosition.create({ data: { organizationId: w.org, nameEn: 'Officer', grade: 5 } });
      const now = new Date();
      const cases: Record<string, string> = {
        'head holder': await person(w, 'h1', { positionId: head.id, primaryOrgUnitId: w.unit }),
        'head position, no unit': await person(w, 'h2', { positionId: head.id }),
        'head holder, inactive': await person(w, 'h3', { positionId: head.id, primaryOrgUnitId: w.unit, status: 'INACTIVE' }),
        'head position inactive': await person(w, 'h4', { positionId: closedHead.id, primaryOrgUnitId: w.unit }),
        'not a head position': await person(w, 'h5', { positionId: plain.id, primaryOrgUnitId: w.unit }),
        'cover, open-ended': await person(w, 'c1'),
        'cover, ends later': await person(w, 'c2'),
        'cover, ended': await person(w, 'c3'),
        'cover, not started': await person(w, 'c4'),
        'cover, lapsed': await person(w, 'c5'),
        'substantive, not a cover': await person(w, 'c6'),
      };
      await cover(w, cases['cover, open-ended']!);
      await cover(w, cases['cover, ends later']!, { validTo: new Date(now.getTime() + DAY) });
      await cover(w, cases['cover, ended']!, { endedAt: new Date(now.getTime() - 1000) });
      await cover(w, cases['cover, not started']!, { validFrom: new Date(now.getTime() + DAY) });
      await cover(w, cases['cover, lapsed']!, { validTo: new Date(now.getTime() - 1000) });
      await cover(w, cases['substantive, not a cover']!, { kind: 'SUBSTANTIVE' });

      const seen: Record<string, [boolean, boolean]> = {};
      for (const [name, id] of Object.entries(cases)) {
        const rules = (await findUnitHeadedBy(prisma, w.org, id)) !== null || (await findUnitsCoveredBy(prisma, w.org, id, now)).length > 0;
        seen[name] = [await mayDecideAnyChangeRequest(prisma, w.org, id, now), rules];
      }
      for (const [name, [sql, rules]] of Object.entries(seen)) expect([name, sql]).toEqual([name, rules]);
      // Non-vacuous: both answers occur.
      expect(seen['head holder']).toEqual([true, true]);
      expect(seen['cover, ends later']).toEqual([true, true]);
      expect(seen['cover, lapsed']).toEqual([false, false]);
    });

    itEnforcesTenantIsolation("the one query never counts another organisation's cover, membership or seat", async () => {
      const w = await world();
      const other = await world();
      const id = await person(w, 'Plain');
      // Rows filed under the other organisation, naming THIS person.
      await prisma.orgUnitHeadAssignment.create({
        data: { organizationId: other.org, orgUnitId: other.unit, userId: id, kind: 'ACTING', reason: 'ABSENCE', validFrom: new Date(Date.now() - DAY), createdById: other.approver.userId },
      });
      await prisma.committeeSeatAction.create({ data: { organizationId: other.org, committeeId: other.other, roleValueId: 'seat-x', actionKey: SEAT_ACTIONS.DECIDE_REPORTING_CHANGES } });
      await prisma.committeeMember.create({ data: { organizationId: other.org, committeeId: other.other, userId: id, roleValueId: 'seat-x' } });
      expect(await mayDecideAnyChangeRequest(prisma, w.org, id, new Date())).toBe(false);
      // Control: THIS organisation's own cover does count.
      await cover(w, id);
      expect(await mayDecideAnyChangeRequest(prisma, w.org, id, new Date())).toBe(true);
    });
  });
  // ── ACC-283 PR 2b: a leaver's unfinished requests are withdrawn ─────────────
  describe('the departure withdrawal (ACC-283 PR 2b)', () => {
    const DEACTIVATION_TX = { maxWait: 10_000, timeout: 20_000 };

    /** What UserService.deactivate() does around the withdrawal: prepare, the flip and the withdrawal in one transaction, then finish. */
    async function deactivate(w: World, leaverId: string, actorId: string, between?: () => Promise<unknown>): Promise<PreparedDeparture> {
      const prepared = await departure.prepare(w.org, leaverId, actorId);
      await between?.();
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: leaverId }, data: { status: 'INACTIVE' } });
        await departure.withdrawInTx(tx, prepared);
      }, DEACTIVATION_TX);
      await departure.finish(prepared);
      return prepared;
    }

    const stageKey = async (w: World, requestId: string) => {
      const i = await prisma.workflowInstance.findFirstOrThrow({ where: { organizationId: w.org, objectType: 'COMMITTEE_CHANGE_REQUEST', objectId: requestId }, orderBy: { createdAt: 'desc' } });
      return (await prisma.workflowStage.findFirstOrThrow({ where: { id: i.currentStageId! } })).key;
    };

    it("withdraws the leaver's draft and returned requests inside the transaction, cancels their finish tasks, audits them, and sends NOTHING", async () => {
      const w = await world();
      const draft = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'draft' }, w.org, w.requester);
      const sent = await requests.create(w.other, { changes: { quorumCount: 5 }, reason: 'sent' } as never, w.org, w.requester);
      await requests.submit(sent.id, w.org, w.requester);
      await requests.returnForChanges(sent.id, { note: 'more detail' }, w.org, w.approver);
      expect(await stageKey(w, draft.id)).toBe('draft');
      expect(await stageKey(w, sent.id)).toBe('returned');
      notices.length = 0;
      inApp.length = 0;

      const prepared = await deactivate(w, w.requester.userId, w.approver.userId);

      expect(prepared.applied.map((a) => a.withdrawal.requestId).sort()).toEqual([draft.id, sent.id].sort());
      for (const id of [draft.id, sent.id]) {
        expect(await stageKey(w, id)).toBe('withdrawn');
        const row = await prisma.committeeChangeRequest.findFirstOrThrow({ where: { id, organizationId: w.org } });
        // The person deactivating withdrew it: the leaver did not.
        expect(row).toMatchObject({ withdrawnById: w.approver.userId });
        expect(row.withdrawnAt).not.toBeNull();
        const task = await prisma.task.findFirstOrThrow({ where: { id: row.finishTaskId!, organizationId: w.org } });
        expect(task.status).toBe('CANCELLED');
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: w.org, objectType: 'CommitteeChangeRequest', objectId: id, actorId: w.approver.userId } , orderBy: { createdAt: 'desc' } });
        expect(audit.metadata).toMatchObject({ decision: 'WITHDRAWN', cause: 'departure', leaverId: w.requester.userId });
      }
      // Nothing sent, to the leaver or anyone: no notice, no in-app batch (stage-exit
      // or task-closed notices), and no pool told about the Withdrawn stage.
      expect(notices).toEqual([]);
      expect(inApp).toEqual([]);
    });

    // ── ACC-216 (CC-301, CC-302): the REAL UserService.deactivate(), whose one
    // transaction (DEACTIVATION_TX) now also ends the leaver's sign-ins
    // (endEverySessionInTx). The withdrawal and the session ending commit
    // together and roll back together.
    describe('with the session ending (ACC-216)', () => {
      const users = new UserService(
        prisma,
        audit,
        notifications,
        { getUserPermissions: async () => [] } as unknown as RoleService,
        tasks,
        { resolveActingHeadForOrgUnit: async () => [], refreshOrgUnitHeadVacancy: async () => undefined } as unknown as OrganizationService,
        { invalidateUserSessions: async () => undefined } as unknown as AuthProvider,
        {} as OrgUnitHeadService,
        {} as OrgPositionService,
        new StagePoolService(prisma),
        { schedule: () => Promise.resolve() } as unknown as CommitteeTransferNoticeService,
        departure,
        // ACC-306 — the real seat ending: these people hold no committee seat ended here.
        new CommitteeSeatDepartureService(prisma, audit, new LookupService(prisma, audit), notifications),
      );
      const signIn = (w: World, userId: string) =>
        prisma.refreshToken.create({
          data: { userId, organizationId: w.org, tokenHash: randomUUID(), tokenVersion: 0, expiresAt: new Date(Date.now() + 3_600_000) },
        });
      const live = (w: World, userId: string) => prisma.refreshToken.count({ where: { userId, organizationId: w.org, revokedAt: null } });

      it("commit together: the leaver's draft is withdrawn AND every sign-in ends", async () => {
        const w = await world();
        const draft = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'draft' }, w.org, w.requester);
        await signIn(w, w.requester.userId);
        await signIn(w, w.requester.userId);
        const version = (await prisma.user.findFirstOrThrow({ where: { id: w.requester.userId } })).tokenVersion;

        await users.deactivate(w.requester.userId, w.org, w.approver.userId);

        expect(await stageKey(w, draft.id)).toBe('withdrawn');
        expect(await live(w, w.requester.userId)).toBe(0);
        const leaver = await prisma.user.findFirstOrThrow({ where: { id: w.requester.userId } });
        expect(leaver).toMatchObject({ status: 'INACTIVE', tokenVersion: version + 1 });
      });

      it('roll back together: a refusal later in the transaction (the last administrator) keeps the draft AND the sign-ins', async () => {
        const w = await world();
        const draft = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'draft' }, w.org, w.requester);
        await signIn(w, w.requester.userId);
        // The leaver is the organisation's only active administrator: the
        // invariant refuses AFTER the ending and the withdrawal ran in the transaction.
        const role = await prisma.role.create({ data: { organizationId: w.org, key: TENANT_ADMIN_KEY, nameEn: 'Organization Administrator', isSystem: true } });
        await prisma.userRole.create({ data: { userId: w.requester.userId, roleId: role.id } });
        const version = (await prisma.user.findFirstOrThrow({ where: { id: w.requester.userId } })).tokenVersion;

        await expect(users.deactivate(w.requester.userId, w.org, w.approver.userId)).rejects.toThrow();

        expect(await stageKey(w, draft.id)).toBe('draft');
        expect(await live(w, w.requester.userId)).toBe(1);
        const leaver = await prisma.user.findFirstOrThrow({ where: { id: w.requester.userId } });
        expect(leaver).toMatchObject({ status: 'ACTIVE', tokenVersion: version });
      });
    });

    it('leaves a request already sent for decision to its deciders', async () => {
      const w = await world();
      const waiting = await submitted(w);
      const prepared = await deactivate(w, w.requester.userId, w.approver.userId);
      expect(prepared.withdrawals).toEqual([]);
      expect(await stageKey(w, waiting.id)).toBe('under_review');
    });

    it('a request that moved between prepare and lock is skipped, and the deactivation still commits', async () => {
      const w = await world();
      const draft = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'draft' }, w.org, w.requester);
      // The leaver presses Send a moment after the departure read their draft.
      const prepared = await deactivate(w, w.requester.userId, w.approver.userId, () => requests.submit(draft.id, w.org, w.requester));
      expect(prepared.withdrawals).toHaveLength(1);
      expect(prepared.applied).toEqual([]);
      expect(await stageKey(w, draft.id)).toBe('under_review');
      expect((await prisma.user.findFirstOrThrow({ where: { id: w.requester.userId } })).status).toBe('INACTIVE');
    });

    it('a leaver with no unfinished request costs exactly ONE query, and the withdrawal and the follow-up none', async () => {
      const w = await world();
      const log: string[] = [];
      const counting = new Proxy(prisma, {
        get(t, k) {
          const v = (t as unknown as Record<string | symbol, unknown>)[k];
          if (typeof v === 'function') return (...a: unknown[]) => (log.push(String(k)), (v as (...x: unknown[]) => unknown).apply(t, a));
          if (typeof k === 'string' && !k.startsWith('$') && v && typeof v === 'object') {
            return new Proxy(v as object, {
              get(d, m) {
                const f = (d as Record<string | symbol, unknown>)[m];
                return typeof f === 'function' ? (...a: unknown[]) => (log.push(`${k}.${String(m)}`), (f as (...x: unknown[]) => unknown).apply(d, a)) : f;
              },
            });
          }
          return v;
        },
      }) as unknown as PrismaService;
      const counted = new ChangeRequestDepartureService(counting, workflow, tasks, audit);
      const prepared = await counted.prepare(w.org, w.reader.userId, w.approver.userId);
      expect(log).toEqual(['$queryRaw']);
      await counted.withdrawInTx(counting as never, prepared);
      await counted.finish(prepared);
      expect(log).toEqual(['$queryRaw']);
      expect(prepared).toMatchObject({ withdrawals: [], applied: [] });
    });

    itEnforcesTenantIsolation("the departure's read never finds another organisation's requests", async () => {
      const w = await world();
      const other = await world();
      await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'here' }, w.org, w.requester);
      await requests.create(other.committee, { changes: { quorumCount: 4 }, reason: 'there' }, other.org, other.requester);
      // This organisation's leaver, asked about the other organisation, and the reverse.
      expect((await departure.prepare(other.org, w.requester.userId, other.approver.userId)).withdrawals).toEqual([]);
      expect((await departure.prepare(w.org, other.requester.userId, w.approver.userId)).withdrawals).toEqual([]);
      // Control: their own draft is found.
      expect((await departure.prepare(w.org, w.requester.userId, w.approver.userId)).withdrawals).toHaveLength(1);
    });
  });
  // ── ACC-283 PR 5: seat actions as ONE change-request field (Q12) ────────────
  describe('seat actions in a change request (ACC-283 PR 5)', () => {
    const realLookups = new LookupService(prisma, audit);
    let seat: Record<string, string> = {};

    beforeAll(async () => {
      await realLookups.seedSystemData();
      const values = await prisma.lookupValue.findMany({
        where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
        select: { id: true, key: true },
      });
      seat = Object.fromEntries(values.map((v) => [v.key, v.id]));
    });

    const stageKeyOf = async (w: World, requestId: string) => {
      const i = await prisma.workflowInstance.findFirstOrThrow({
        where: { organizationId: w.org, objectType: 'COMMITTEE_CHANGE_REQUEST', objectId: requestId },
        orderBy: { createdAt: 'desc' },
      });
      return (await prisma.workflowStage.findFirstOrThrow({ where: { id: i.currentStageId! } })).key;
    };

    const stored = async (w: World, committeeId: string) =>
      (await prisma.committeeSeatAction.findMany({ where: { organizationId: w.org, committeeId }, orderBy: [{ roleValueId: 'asc' }, { actionKey: 'asc' }] })).map(
        (r) => `${r.roleValueId}:${r.actionKey}`,
      );

    it('previews the whole map as one field, in canonical order, with the seats named', async () => {
      const w = await world();
      const preview = await requests.preview(
        w.committee,
        { seatActions: [{ roleValueId: seat['member']!, actions: ['decide_reporting_changes', 'add_member'] }] },
        w.org,
        w.requester,
      );
      expect(preview.changedFields).toEqual(['seatActions']);
      expect(preview.impacts).toEqual([
        { code: 'SEAT_ACTIONS', from: {}, to: { [seat['member']!]: ['add_member', 'decide_reporting_changes'] } },
        { code: 'TERMS_TASK' },
      ]);
      expect(preview.labels[seat['member']!]).toEqual({ en: 'Member', ar: 'عضو' });
    });

    it('refuses an action off the list, a seat the organisation does not use, and a map equal to the stored one', async () => {
      const w = await world();
      const make = (seatActions: { roleValueId: string; actions: string[] }[]) =>
        outcome(requests.create(w.committee, { changes: { seatActions }, reason: 'seats' }, w.org, w.requester));
      expect(await make([{ roleValueId: seat['member']!, actions: ['fly'] }])).toBe('SEAT_ACTION_UNKNOWN');
      expect(await make([{ roleValueId: 'no-such-seat', actions: ['add_member'] }])).toBe('SEAT_ACTION_SEAT_UNKNOWN');
      // Nothing stored and nothing proposed: no change.
      expect(await make([{ roleValueId: seat['member']!, actions: [] }])).toBe('CHANGE_REQUEST_NO_CHANGES');
    });

    it('stores the map at Submit as it stands, then applies it on approval by the one writer, with the audit naming both', async () => {
      const w = await world();
      await prisma.committeeSeatAction.create({ data: { organizationId: w.org, committeeId: w.committee, roleValueId: seat['secretary']!, actionKey: 'add_member' } });
      const before = await prisma.committee.findFirstOrThrow({ where: { id: w.committee, organizationId: w.org } });

      const request = await requests.create(
        w.committee,
        {
          changes: {
            quorumCount: 5,
            seatActions: [
              { roleValueId: seat['member']!, actions: ['request_change'] },
              { roleValueId: seat['secretary']!, actions: [] },
            ],
          },
          reason: 'seats and quorum',
          submit: true,
        },
        w.org,
        w.requester,
      );
      expect(request.changes).toEqual({ quorumCount: 5, seatActions: { [seat['member']!]: ['request_change'] } });
      expect(request.fromValues).toEqual({ quorumCount: 3, seatActions: { [seat['secretary']!]: ['add_member'] } });
      expect(request.labels[seat['member']!]?.en).toBe('Member');
      expect(request.labels[seat['secretary']!]?.en).toBe('Secretary');

      await requests.approve(request.id, w.org, w.approver);

      expect(await stored(w, w.committee)).toEqual([`${seat['member']!}:request_change`]);
      const after = await prisma.committee.findFirstOrThrow({ where: { id: w.committee, organizationId: w.org } });
      expect(after.quorumCount).toBe(5);
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      const row = await prisma.auditLog.findFirstOrThrow({
        where: { organizationId: w.org, objectType: 'Committee', objectId: w.committee, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      });
      expect(row.before).toEqual({ quorumCount: 3, seatActions: { [seat['secretary']!]: ['add_member'] } });
      expect(row.after).toEqual({ quorumCount: 5, seatActions: { [seat['member']!]: ['request_change'] } });
    });

    it('a seat-actions-only change also makes a stale Formation save stale (updatedAt moves)', async () => {
      const w = await world();
      const before = await prisma.committee.findFirstOrThrow({ where: { id: w.committee, organizationId: w.org } });
      const request = await requests.create(
        w.committee,
        { changes: { seatActions: [{ roleValueId: seat['member']!, actions: ['add_member'] }] }, reason: 'seats', submit: true },
        w.org,
        w.requester,
      );
      await requests.approve(request.id, w.org, w.approver);
      expect(await stored(w, w.committee)).toEqual([`${seat['member']!}:add_member`]);
      const after = await prisma.committee.findFirstOrThrow({ where: { id: w.committee, organizationId: w.org } });
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      expect(after.quorumCount).toBe(before.quorumCount);
    });

    it('an edit of a draft can add the seat actions', async () => {
      const w = await world();
      const draft = await requests.create(w.committee, { changes: { quorumCount: 4 }, reason: 'draft' }, w.org, w.requester);
      const edited = await requests.update(
        draft.id,
        { changes: { quorumCount: 4, seatActions: [{ roleValueId: seat['chairman']!, actions: ['decide_reporting_changes'] }] } },
        w.org,
        w.requester,
      );
      expect(edited.changes).toEqual({ quorumCount: 4, seatActions: { [seat['chairman']!]: ['decide_reporting_changes'] } });
    });

    it('DRIFT: seat actions changed since Submit refuse the whole approval, and nothing is applied', async () => {
      const w = await world();
      const request = await requests.create(
        w.committee,
        { changes: { quorumCount: 5, seatActions: [{ roleValueId: seat['member']!, actions: ['add_member'] }] }, reason: 'seats', submit: true },
        w.org,
        w.requester,
      );
      // Someone changes the stored map after Submit (as a Formation edit would).
      await prisma.committeeSeatAction.create({ data: { organizationId: w.org, committeeId: w.committee, roleValueId: seat['secretary']!, actionKey: 'remove_member' } });

      expect(await body(requests.approve(request.id, w.org, w.approver))).toEqual([
        409,
        expect.objectContaining({ code: 'CHANGE_REQUEST_COMMITTEE_CHANGED', fields: ['seatActions'] }),
      ]);
      expect(await stored(w, w.committee)).toEqual([`${seat['secretary']!}:remove_member`]);
      expect((await prisma.committee.findFirstOrThrow({ where: { id: w.committee, organizationId: w.org } })).quorumCount).toBe(3);
      expect(await stageKeyOf(w, request.id)).toBe('under_review');
    });

    it('DRIFT: a proposed seat the organisation no longer uses refuses the approval, so nothing is written for it', async () => {
      const w = await world();
      const own = await realLookups.addValue('committee_member_role', w.org, { key: `observer-${w.slug}`, labelEn: 'Observer', sortOrder: 90 } as never, w.requester.userId);
      const request = await requests.create(
        w.committee,
        { changes: { seatActions: [{ roleValueId: own.id, actions: ['request_change'] }] }, reason: 'observer', submit: true },
        w.org,
        w.requester,
      );
      await prisma.lookupValue.update({ where: { id: own.id }, data: { isActive: false } });
      expect(await outcome(requests.approve(request.id, w.org, w.approver))).toBe('CHANGE_REQUEST_COMMITTEE_CHANGED');
      expect(await stored(w, w.committee)).toEqual([]);
    });

    it('a request that changes only the committee\'s own fields reads no seat actions', async () => {
      const w = await world();
      const reads = jest.spyOn(prisma.committeeSeatAction, 'findMany');
      try {
        const request = await requests.create(w.committee, { changes: { quorumCount: 5 }, reason: 'quorum', submit: true }, w.org, w.requester);
        await requests.approve(request.id, w.org, w.approver);
        expect(reads).not.toHaveBeenCalled();
        // Non-vacuous: the same spy sees a request that does name seat actions.
        await requests.preview(w.committee, { seatActions: [{ roleValueId: seat['member']!, actions: ['add_member'] }] }, w.org, w.requester);
        expect(reads).toHaveBeenCalled();
      } finally {
        reads.mockRestore();
      }
    });

    itEnforcesTenantIsolation("a change request never takes another organisation's seat, nor counts its seat-action rows", async () => {
      const w = await world();
      const other = await world();
      const theirs = await realLookups.addValue('committee_member_role', other.org, { key: `theirs-${other.slug}`, labelEn: 'Theirs', sortOrder: 90 } as never, other.requester.userId);
      expect(
        await outcome(requests.create(w.committee, { changes: { seatActions: [{ roleValueId: theirs.id, actions: ['add_member'] }] }, reason: 'x' }, w.org, w.requester)),
      ).toBe('SEAT_ACTION_SEAT_UNKNOWN');
      // A row filed under the other organisation against THIS committee is not part of its map.
      await prisma.committeeSeatAction.create({ data: { organizationId: other.org, committeeId: w.committee, roleValueId: seat['member']!, actionKey: 'add_member' } });
      const preview = await requests.preview(w.committee, { seatActions: [{ roleValueId: seat['member']!, actions: ['add_member'] }] }, w.org, w.requester);
      expect(preview.impacts[0]).toEqual({ code: 'SEAT_ACTIONS', from: {}, to: { [seat['member']!]: ['add_member'] } });
    });
  });
});
