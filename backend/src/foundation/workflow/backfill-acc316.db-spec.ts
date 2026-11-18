/**
 * ACC-316 PR 2 — the three backfills, against a REAL Postgres (npm run test:db):
 * backfill-acc316-meeting-keys, -seat-defaults and -meeting-workflow.
 *
 * Each: a dry run writes nothing; --execute writes only where the value is
 * still the seed's, and ONE audit row per organisation it changes; a second
 * dry run plans nothing; a customer organisation with anything to change is
 * refused. The spec's organisations stand in for the fixtures (`isFixture`):
 * the real guard rightly calls them customers.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { LookupService } from '../lookup/lookup.service';
import { MEETINGS_PERMISSIONS } from '../../common/constants/permissions';
import { SEAT_ACTIONS } from '../committees/seat-actions';
import { COMMITTEE_ACTIONS, STAGE_FLAG } from './record-registry';
import { runBackfill as runKeys } from '../../../prisma/backfill-acc316-meeting-keys';
import { runBackfill as runSeats } from '../../../prisma/backfill-acc316-seat-defaults';
import { runBackfill as runWorkflow } from '../../../prisma/backfill-acc316-meeting-workflow';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

describe('ACC-316 backfills against a real database', () => {
  const prisma = new PrismaService();
  const lookups = new LookupService(prisma, new AuditLogService(prisma));
  let seat: Record<string, string> = {};
  const ours = new Set<string>();
  const isFixture = (slug: string) => ours.has(slug);

  async function org(): Promise<{ id: string; slug: string; actorId: string; unitId: string }> {
    const slug = `acc316b-${randomUUID().slice(0, 8)}`;
    ours.add(slug);
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const actor = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-a@example.test`, name: 'Admin', status: 'ACTIVE' } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${slug}` } });
    return { id: o.id, slug, actorId: actor.id, unitId: unit.id };
  }

  async function permissionId(key: string): Promise<string> {
    const [module, action] = key.split(':') as [string, string];
    return (await prisma.permission.upsert({ where: { module_action: { module, action } }, create: { module, action }, update: {} })).id;
  }

  const audits = (organizationId: string, source: string) =>
    prisma.auditLog.count({ where: { organizationId, metadata: { path: ['source'], equals: source } } });

  beforeAll(async () => {
    await prisma.onModuleInit();
    await lookups.seedSystemData();
    const seats = await prisma.lookupValue.findMany({
      where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
      select: { id: true, key: true },
    });
    seat = Object.fromEntries(seats.map((s) => [s.key, s.id]));
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('backfill-acc316-meeting-keys', () => {
    it("grants the seeded share to a system role that still holds meetings:manage, withholds it from one that doesn't, then plans nothing", async () => {
      const o = await org();
      const role = async (key: string, keys: string[]) =>
        prisma.role.create({
          data: {
            organizationId: o.id,
            key,
            nameEn: key,
            isSystem: true,
            rolePermissions: { create: await Promise.all(keys.map(async (k) => ({ permissionId: await permissionId(k) }))) },
          },
        });
      const admin = await role('TENANT_ADMIN', [MEETINGS_PERMISSIONS.VIEW, MEETINGS_PERMISSIONS.MANAGE]);
      await role('QUALITY_MANAGER', [MEETINGS_PERMISSIONS.VIEW]); // its organisation took meetings:manage away
      await role('VIEWER', [MEETINGS_PERMISSIONS.VIEW]);

      const dry = await runKeys(prisma, { execute: false, organizationIds: [o.id], isFixture });
      const plan = dry.plans[0]!;
      expect(plan.grants.map((g) => `${g.roleKey} ${g.permission}`).sort()).toEqual([
        'TENANT_ADMIN meetings:approve_subunits',
        // PR 3a — the four meeting task keys.
        'TENANT_ADMIN meetings:create_tasks',
        'TENANT_ADMIN meetings:manage_tasks',
        'TENANT_ADMIN meetings:schedule',
        'TENANT_ADMIN meetings:schedule_subunits',
        'TENANT_ADMIN meetings:view_all_tasks',
        'TENANT_ADMIN meetings:view_unit_tasks',
        // Quality Manager still holds meetings:view, so the view task key follows it.
        'QUALITY_MANAGER meetings:view_all_tasks',
      ].sort());
      // The rest of Quality Manager's share needs meetings:manage: the three keys, create and manage tasks.
      expect(plan.withheld.map((w) => `${w.roleKey} ${w.permission}`).sort()).toEqual(
        [
          'QUALITY_MANAGER meetings:approve_subunits',
          'QUALITY_MANAGER meetings:create_tasks',
          'QUALITY_MANAGER meetings:manage_tasks',
          'QUALITY_MANAGER meetings:schedule',
          'QUALITY_MANAGER meetings:schedule_subunits',
        ],
      );
      expect(await audits(o.id, 'backfill-acc316-meeting-keys')).toBe(0);

      // The real guard: a customer organisation is refused, and nothing is written.
      const refused = await runKeys(prisma, { execute: true, organizationIds: [o.id] });
      expect(refused.refusedCustomers).toEqual([o.slug]);
      expect(await audits(o.id, 'backfill-acc316-meeting-keys')).toBe(0);

      const done = await runKeys(prisma, { execute: true, organizationIds: [o.id], isFixture });
      expect(done.changed).toEqual([{ slug: o.slug, grants: 8 }]);
      const held = await prisma.rolePermission.findMany({ where: { roleId: admin.id }, select: { permission: { select: { module: true, action: true } } } });
      expect(held.map((h) => `${h.permission.module}:${h.permission.action}`).sort()).toEqual(
        [
          'meetings:approve_subunits',
          'meetings:create_tasks',
          'meetings:manage',
          'meetings:manage_tasks',
          'meetings:schedule',
          'meetings:schedule_subunits',
          'meetings:view',
          'meetings:view_all_tasks',
          'meetings:view_unit_tasks',
        ].sort(),
      );
      expect(await audits(o.id, 'backfill-acc316-meeting-keys')).toBe(1);

      const again = await runKeys(prisma, { execute: false, organizationIds: [o.id], isFixture });
      expect(again.plans[0]!.grants).toEqual([]);
    });
  });

  describe('backfill-acc316-seat-defaults', () => {
    it("writes the defaults for each new action a committee has no row for, leaves a configured one, then plans nothing", async () => {
      const o = await org();
      const fresh = await prisma.committee.create({ data: { organizationId: o.id, nameEn: 'Fresh', typeValueId: 'type', orgUnitId: o.unitId } });
      const configured = await prisma.committee.create({ data: { organizationId: o.id, nameEn: 'Configured', typeValueId: 'type', orgUnitId: o.unitId } });
      // This committee's seats were already set for scheduling: only the Chair schedules.
      await prisma.committeeSeatAction.create({
        data: { organizationId: o.id, committeeId: configured.id, roleValueId: seat['chairman']!, actionKey: SEAT_ACTIONS.SCHEDULE_MEETING },
      });

      const dry = await runSeats(prisma, { execute: false, organizationIds: [o.id], isFixture });
      const rows = dry.plans[0]!.rows.map((r) => `${r.committeeId === fresh.id ? 'fresh' : 'configured'} ${r.roleValueId === seat['chairman'] ? 'chairman' : 'secretary'} ${r.actionKey}`);
      expect(rows.sort()).toEqual(
        [
          'fresh chairman schedule_meeting',
          'fresh secretary schedule_meeting',
          'fresh secretary record_minutes',
          'configured secretary record_minutes',
        ].sort(),
      );

      const refused = await runSeats(prisma, { execute: true, organizationIds: [o.id] });
      expect(refused.refusedCustomers).toEqual([o.slug]);
      expect(await prisma.committeeSeatAction.count({ where: { organizationId: o.id } })).toBe(1);

      const done = await runSeats(prisma, { execute: true, organizationIds: [o.id], isFixture });
      expect(done.changed).toEqual([{ slug: o.slug, committees: 2, rows: 4 }]);
      // The configured committee kept its own scheduling choice.
      const configuredSchedule = await prisma.committeeSeatAction.findMany({
        where: { organizationId: o.id, committeeId: configured.id, actionKey: SEAT_ACTIONS.SCHEDULE_MEETING },
      });
      expect(configuredSchedule.map((r) => r.roleValueId)).toEqual([seat['chairman']]);
      expect(await audits(o.id, 'backfill-acc316-seat-defaults')).toBe(1);

      const again = await runSeats(prisma, { execute: false, organizationIds: [o.id], isFixture });
      expect(again.plans[0]!.rows).toEqual([]);
    });
  });

  describe('backfill-acc316-meeting-workflow', () => {
    /** The Meeting workflow as the OLD seed made it, and a committee workflow with an in-force stage. */
    async function oldWorkflows(o: { id: string; actorId: string }, plannedWho: 'CREATOR' | 'SPECIFIC_USER' = 'CREATOR') {
      const t = await prisma.workflowTemplate.create({ data: { organizationId: o.id, nameEn: 'Meeting Management', objectType: 'MEETING', isDefault: true } });
      const stage = (nameEn: string, nameAr: string, order: number, extra: Record<string, unknown> = {}) =>
        prisma.workflowStage.create({ data: { workflowTemplateId: t.id, nameEn, nameAr, order, whoMode: 'ANY_ONE', ...extra } });
      const planned = await stage('Planned', 'مجدول', 10, { isInitial: true });
      const agenda = await stage('Agenda Ready', 'الأجندة جاهزة', 20);
      const draft = await stage('Minutes Draft', 'مسودة المحضر', 30);
      const review = await stage('Minutes Review', 'مراجعة المحضر', 40, { whoMode: 'ALL' });
      const approved = await stage('Minutes Approved', 'اعتماد المحضر', 50, { isFinal: true });
      const cancelled = await stage('Cancelled', 'ملغى', 60, { isFinal: true });
      for (const s of [planned, agenda, draft]) {
        await prisma.workflowStageAssignee.create({
          data:
            s.id === planned.id && plannedWho === 'SPECIFIC_USER'
              ? { organizationId: o.id, stageId: s.id, order: 1, kind: 'SPECIFIC_USER', userId: o.actorId }
              : { organizationId: o.id, stageId: s.id, order: 1, kind: 'CREATOR' },
        });
      }
      await prisma.workflowStageAssignee.create({
        data: { organizationId: o.id, stageId: review.id, order: 1, kind: 'SPECIFIC_USER', userId: o.actorId, isStartingAssignment: true },
      });
      const move = (from: string, to: string, labelEn: string, labelAr: string, extra: Record<string, unknown> = {}) =>
        prisma.workflowTransition.create({ data: { fromStageId: from, toStageId: to, labelEn, labelAr, mover: 'PERSON', ...extra } });
      await move(planned.id, agenda.id, 'Prepare Agenda', 'إعداد الأجندة');
      await move(planned.id, cancelled.id, 'Cancel Meeting', 'إلغاء الاجتماع', { kind: 'EXIT' });
      await move(agenda.id, draft.id, 'Record Minutes', 'تسجيل المحضر');
      const distribute = await move(draft.id, review.id, 'Distribute Minutes', 'توزيع المحضر');
      await move(review.id, approved.id, 'Approve Minutes', 'اعتماد المحضر', { isApprovalPath: true });
      const ret = await move(review.id, draft.id, 'Return for Correction', 'إعادة للتصحيح', { kind: 'RETURN' });
      const loop = await move(draft.id, draft.id, 'Return for Correction', 'إعادة للتصحيح', { kind: 'RETURN' });
      await prisma.workflowTransitionAction.create({ data: { workflowTransitionId: loop.id, actionType: 'LOG_AUDIT', order: 20 } });

      const ct = await prisma.workflowTemplate.create({ data: { organizationId: o.id, nameEn: 'Committee', objectType: 'COMMITTEE', isDefault: true } });
      const active = await prisma.workflowStage.create({
        data: {
          workflowTemplateId: ct.id,
          key: 'active',
          nameEn: 'Active',
          order: 30,
          whoMode: 'ANY_ONE',
          flags: [STAGE_FLAG.IN_FORCE],
          recordActions: { create: [{ organizationId: o.id, actionKey: COMMITTEE_ACTIONS.REQUEST_CHANGE }] },
        },
      });
      return { t, planned, agenda, draft, review, approved, cancelled, distribute, ret, loop, active };
    }

    it("makes the old Meeting workflow the decided one where it is still the seed's, then plans nothing", async () => {
      const o = await org();
      const w = await oldWorkflows(o);

      const dry = await runWorkflow(prisma, { execute: false, organizationIds: [o.id], isFixture });
      expect(dry.plans[0]!.left).toEqual([]);
      expect(dry.plans[0]!.ops.length).toBeGreaterThan(0);
      expect(await prisma.workflowStage.count({ where: { workflowTemplateId: w.t.id, key: { not: null } } })).toBe(0);

      const refused = await runWorkflow(prisma, { execute: true, organizationIds: [o.id] });
      expect(refused.refusedCustomers).toEqual([o.slug]);

      await runWorkflow(prisma, { execute: true, organizationIds: [o.id], isFixture });

      const stages = await prisma.workflowStage.findMany({
        where: { workflowTemplateId: w.t.id },
        orderBy: { order: 'asc' },
        select: {
          key: true,
          nameEn: true,
          nameAr: true,
          whoMode: true,
          flags: true,
          recordActions: { select: { actionKey: true } },
          assignees: { orderBy: { order: 'asc' }, select: { kind: true, committeeRoleValueId: true, isStartingAssignment: true } },
        },
      });
      expect(stages.map((s) => [s.key, s.nameEn, s.nameAr])).toEqual([
        ['planned', 'Planned', 'مجدول'],
        ['agenda_ready', 'Agenda Issued', 'الأجندة مُصدَرة'],
        ['minutes_draft', 'Minutes Draft', 'مسودة المحضر'],
        ['minutes_review', 'Minutes Review', 'مراجعة المحضر'],
        ['minutes_approved', 'Minutes Approved', 'اعتماد المحضر'],
        ['cancelled', 'Cancelled', 'ملغى'],
      ]);
      const by = Object.fromEntries(stages.map((s) => [s.key!, s]));
      expect(by['planned']!.assignees.map((a) => a.kind)).toEqual(['MEETING_SCHEDULERS']);
      expect(by['agenda_ready']!.assignees.map((a) => a.kind)).toEqual(['MEETING_SCHEDULERS', 'MEETING_RECORDERS']);
      expect(by['minutes_draft']!.assignees.map((a) => a.kind)).toEqual(['MEETING_RECORDERS']);
      expect(by['minutes_review']!.whoMode).toBe('ANY_ONE');
      expect(by['minutes_review']!.assignees).toEqual([
        { kind: 'COMMITTEE', committeeRoleValueId: seat['chairman'], isStartingAssignment: false },
        { kind: 'MEETING_APPROVERS', committeeRoleValueId: null, isStartingAssignment: false },
      ]);
      expect(by['agenda_ready']!.flags).toEqual([STAGE_FLAG.AGENDA_ISSUED]);
      expect(by['minutes_approved']!.flags).toEqual([STAGE_FLAG.MINUTES_FINAL]);
      expect(by['cancelled']!.flags).toEqual([STAGE_FLAG.MEETING_CANCELLED]);
      expect(by['minutes_review']!.recordActions.map((a) => a.actionKey).sort()).toEqual(['apply_suggestions', 'change_action_dates', 'suggest_correction']);

      const moves = await prisma.workflowTransition.findMany({ where: { fromStage: { workflowTemplateId: w.t.id } }, select: { id: true, labelEn: true, mover: true } });
      expect(moves.find((m) => m.id === w.distribute.id)!.mover).toBe('APP');
      expect(moves.find((m) => m.id === w.ret.id)!.mover).toBe('APP');
      expect(moves.some((m) => m.id === w.loop.id)).toBe(false);
      expect(moves.some((m) => m.labelEn === 'Issue Agenda')).toBe(true);
      expect(
        await prisma.workflowStageRecordAction.count({ where: { stageId: w.active.id, actionKey: COMMITTEE_ACTIONS.SCHEDULE_MEETING } }),
      ).toBe(1);
      expect(await audits(o.id, 'backfill-acc316-meeting-workflow')).toBe(1);

      const again = await runWorkflow(prisma, { execute: false, organizationIds: [o.id], isFixture });
      expect(again.plans[0]!.ops).toEqual([]);
      expect(again.plans[0]!.left).toEqual([]);
    });

    it("leaves who works a stage when the organisation configured it, and reports it", async () => {
      const o = await org();
      const w = await oldWorkflows(o, 'SPECIFIC_USER');

      const dry = await runWorkflow(prisma, { execute: false, organizationIds: [o.id], isFixture });
      expect(dry.plans[0]!.left).toEqual(['Planned: who works it was configured']);
      await runWorkflow(prisma, { execute: true, organizationIds: [o.id], isFixture });

      const planned = await prisma.workflowStageAssignee.findMany({ where: { stageId: w.planned.id }, select: { kind: true, userId: true } });
      expect(planned).toEqual([{ kind: 'SPECIFIC_USER', userId: o.actorId }]);
      // The rest still changed.
      expect((await prisma.workflowStage.findUniqueOrThrow({ where: { id: w.agenda.id } })).nameEn).toBe('Agenda Issued');
    });
  });
});
