/**
 * ACC-255 — stage rules against a REAL Postgres (npm run test:db).
 *
 * The unit specs fake every database answer. Only a database can prove:
 *
 *   1. a NEW organisation gets the rules from the shared workflow seed
 *      (applyWorkflowSeed), so nobody depends on the backfill (plan §16.3);
 *   2. the backfill: dry run writes nothing, execute writes exactly what is
 *      missing with one audit row, a second dry run plans 0, a stage a tenant
 *      configured is left alone, and a customer organisation is refused;
 *   3. the migration's constraints: one row per stage and action, and the
 *      rows go with their stage;
 *   4. the engine's answer read from real rows, its share lock, and that
 *      another organisation's committee gets nothing;
 *   5. a stage save writes its rules and an audit row naming what changed,
 *      and cannot reach another organisation's stage.
 *
 * The parity check that compared these rules with the old keyed maps went
 * with the maps (ACC-255 PR 2).
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import { applyWorkflowSeed } from './workflow-seed-apply';
import { StageRulesService } from './stage-rules.service';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { WorkflowTemplateService } from './workflow-template.service';
import { planBackfill, runBackfill } from '../../../prisma/backfill-acc255-stage-rules';
import { CommitteesService } from '../committees/committees.service';
import { CHANGE_REQUEST_ACTIONS, committeeAllowsRequestMove } from '../committees/change-requests/change-request-policy';
import type { WorkflowService } from './workflow.service';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const SEEDS = SYSTEM_WORKFLOW_SEED.filter((w) => w.objectType === 'COMMITTEE' || w.objectType === 'COMMITTEE_CHANGE_REQUEST');
const MEMBERS = ['add_member', 'change_member_role', 'remove_member'];

/** The plan's §4.1 table: today's rules, by stage key. */
const EXPECTED_COMMITTEE = {
  formation: { actions: ['edit_details', ...MEMBERS].sort(), flags: [] as string[] },
  terms_review: { actions: MEMBERS, flags: [] as string[] },
  active: { actions: [...MEMBERS, 'request_change'].sort(), flags: ['IN_FORCE'] },
  suspended: { actions: [...MEMBERS, 'request_change'].sort(), flags: ['IN_FORCE'] },
  dissolution_pending: { actions: MEMBERS, flags: ['DISSOLVING'] },
  // ACC-255 PR 2 (Q-A): a dissolved committee's members can't be changed.
  dissolved: { actions: [] as string[], flags: ['DISSOLVING'] },
};

describe('Stage rules against a real database (ACC-255)', () => {
  const prisma = new PrismaService();
  const stageRules = new StageRulesService(prisma);
  const templates = new WorkflowTemplateService(prisma, new AuditLogService(prisma), {} as StageTaskDefinitionService);

  /** A new organisation, with the roles the two seeds name and both workflows seeded exactly as bootstrap does. */
  async function org(): Promise<{ id: string; slug: string; actorId: string }> {
    const slug = `acc255-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const roleKeys = new Set<string>();
    for (const w of SEEDS) {
      for (const s of w.stages) if (s.assigneeRoleKey) roleKeys.add(s.assigneeRoleKey);
      for (const t of w.transitions) if (t.triggerRoleKey) roleKeys.add(t.triggerRoleKey);
    }
    for (const key of roleKeys) await prisma.role.create({ data: { organizationId: o.id, key, nameEn: key, isSystem: true } });
    await applyWorkflowSeed(prisma, o.id, SEEDS);
    const actor = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}@example.test`, name: 'Workflow admin' } });
    return { id: o.id, slug, actorId: actor.id };
  }

  async function rulesByKey(organizationId: string, objectType: 'COMMITTEE' | 'COMMITTEE_CHANGE_REQUEST') {
    const stages = await prisma.workflowStage.findMany({
      where: { workflowTemplate: { organizationId, objectType, isDefault: true } },
      select: { key: true, flags: true, recordActions: { select: { actionKey: true } } },
    });
    return Object.fromEntries(
      stages.map((s) => [s.key ?? '(none)', { actions: s.recordActions.map((r) => r.actionKey).sort(), flags: s.flags }]),
    );
  }

  /** An organisation as it stood before ACC-255: its stages carry no rules. */
  async function stripRules(organizationId: string): Promise<void> {
    await prisma.workflowStageRecordAction.deleteMany({ where: { organizationId } });
    await prisma.workflowStage.updateMany({ where: { workflowTemplate: { organizationId } }, data: { flags: [] } });
  }

  async function stageId(organizationId: string, objectType: 'COMMITTEE' | 'COMMITTEE_CHANGE_REQUEST', key: string): Promise<string> {
    return (
      await prisma.workflowStage.findFirstOrThrow({
        where: { key, workflowTemplate: { organizationId, objectType, isDefault: true } },
        select: { id: true },
      })
    ).id;
  }

  /** A committee standing at `key`. */
  async function committeeAt(organizationId: string, key: string): Promise<string> {
    const unit = await prisma.orgUnit.create({ data: { organizationId, nameEn: 'Root', code: `R-${randomUUID().slice(0, 6)}` } });
    const committee = await prisma.committee.create({
      data: { organizationId, nameEn: `Committee ${key}`, typeValueId: 'type', orgUnitId: unit.id },
    });
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId, objectType: 'COMMITTEE', isDefault: true } });
    await prisma.workflowInstance.create({
      data: {
        organizationId,
        workflowTemplateId: template.id,
        objectType: 'COMMITTEE',
        objectId: committee.id,
        currentStageId: await stageId(organizationId, 'COMMITTEE', key),
      },
    });
    return committee.id;
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('a new organisation (plan §16.3)', () => {
    it("gets today's rules from the shared workflow seed, and the backfill finds nothing to write", async () => {
      const o = await org();

      expect(await rulesByKey(o.id, 'COMMITTEE')).toEqual(EXPECTED_COMMITTEE);
      const request = await rulesByKey(o.id, 'COMMITTEE_CHANGE_REQUEST');
      expect(Object.entries(request).filter(([, r]) => r.flags.length > 0)).toEqual([['approved', { actions: [], flags: ['APPLIES_APPROVED_CHANGE'] }]]);
      expect(Object.values(request).every((r) => r.actions.length === 0)).toBe(true);

      const [plan] = await planBackfill(prisma, [o.id], () => true);
      expect(plan).toMatchObject({ writes: [], alreadyConfigured: 7 });
    });

    it('applying the seed again changes no rule a tenant set', async () => {
      const o = await org();
      const active = await stageId(o.id, 'COMMITTEE', 'active');
      await prisma.workflowStageRecordAction.deleteMany({ where: { stageId: active, actionKey: 'request_change' } });
      await applyWorkflowSeed(prisma, o.id, SEEDS);
      expect((await rulesByKey(o.id, 'COMMITTEE'))['active']!.actions).toEqual(MEMBERS);
    });
  });

  describe('the backfill', () => {
    it('dry run writes nothing; execute writes what is missing with one audit row; a second dry run plans 0', async () => {
      const o = await org();
      await stripRules(o.id);
      // A stage the organisation added: no key, gets the member actions only.
      const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
      const added = await prisma.workflowStage.create({
        data: { workflowTemplateId: template.id, nameEn: 'Board review', order: 25, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
      });
      // A stage the organisation configured first: left exactly as it is.
      const suspended = await stageId(o.id, 'COMMITTEE', 'suspended');
      await prisma.workflowStageRecordAction.create({ data: { organizationId: o.id, stageId: suspended, actionKey: 'add_member' } });

      const dry = await runBackfill(prisma, { execute: false, organizationIds: [o.id], isFixture: () => true });
      const plan = dry.plans[0]!;
      expect(plan.writes.map((w) => w.key ?? '(added)').sort()).toEqual(
        ['(added)', 'active', 'approved', 'dissolution_pending', 'dissolved', 'formation', 'terms_review'].sort(),
      );
      expect(plan.alreadyConfigured).toBe(1);
      expect(plan.writes.find((w) => w.stageId === added.id)).toMatchObject({ actions: ['add_member', 'remove_member', 'change_member_role'], flags: [] });
      expect(await prisma.workflowStageRecordAction.count({ where: { organizationId: o.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { organizationId: o.id, metadata: { path: ['ticket'], equals: 'ACC-255' } } })).toBe(0);

      const run = await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture: () => true });
      expect(run.written).toEqual([{ slug: o.slug, stages: 7 }]);

      const after = await rulesByKey(o.id, 'COMMITTEE');
      const { suspended: suspendedRules, ...others } = EXPECTED_COMMITTEE;
      expect(after).toMatchObject(others);
      expect(after['suspended']).toEqual({ actions: ['add_member'], flags: [] });
      expect(suspendedRules.actions).toContain('request_change');
      expect(after['(none)']).toEqual({ actions: MEMBERS, flags: [] });
      expect((await rulesByKey(o.id, 'COMMITTEE_CHANGE_REQUEST'))['approved']).toEqual({ actions: [], flags: ['APPLIES_APPROVED_CHANGE'] });

      const audit = await prisma.auditLog.findMany({ where: { organizationId: o.id, metadata: { path: ['ticket'], equals: 'ACC-255' } } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorId: null, action: 'UPDATE', objectType: 'WorkflowTemplate' });
      expect(audit[0]!.metadata).toMatchObject({ source: 'backfill-acc255-stage-rules', stagesWritten: 7 });

      const again = await runBackfill(prisma, { execute: false, organizationIds: [o.id], isFixture: () => true });
      expect(again.plans[0]).toMatchObject({ writes: [], alreadyConfigured: 8 });
    });

    it('refuses a customer organisation and writes nothing', async () => {
      const o = await org();
      await stripRules(o.id);
      const run = await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture: () => false });
      expect(run.refusedCustomers).toEqual([o.slug]);
      expect(run.written).toEqual([]);
      expect(await prisma.workflowStageRecordAction.count({ where: { organizationId: o.id } })).toBe(0);
    });

    it("never writes another organisation's stages", async () => {
      const a = await org();
      const b = await org();
      await stripRules(a.id);
      await stripRules(b.id);
      await runBackfill(prisma, { execute: true, organizationIds: [a.id], isFixture: () => true });
      expect(await prisma.workflowStageRecordAction.count({ where: { organizationId: a.id } })).toBeGreaterThan(0);
      expect(await prisma.workflowStageRecordAction.count({ where: { organizationId: b.id } })).toBe(0);
    });
  });

  describe("the migration's constraints", () => {
    it('one row per stage and action; the rows go with their stage', async () => {
      const o = await org();
      const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
      const stage = await prisma.workflowStage.create({
        data: { workflowTemplateId: template.id, nameEn: 'Temporary', order: 99, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' },
      });
      await prisma.workflowStageRecordAction.create({ data: { organizationId: o.id, stageId: stage.id, actionKey: 'add_member' } });
      await expect(
        prisma.workflowStageRecordAction.create({ data: { organizationId: o.id, stageId: stage.id, actionKey: 'add_member' } }),
      ).rejects.toThrow();
      await prisma.workflowStage.delete({ where: { id: stage.id } });
      expect(await prisma.workflowStageRecordAction.count({ where: { stageId: stage.id } })).toBe(0);
    });
  });

  describe("the engine's answer", () => {
    it.each(Object.entries(EXPECTED_COMMITTEE))("a committee at %s is allowed exactly the seed's actions", async (key, expected) => {
      const o = await org();
      const committee = await committeeAt(o.id, key);
      const rules = await stageRules.currentStageRules('COMMITTEE', committee, o.id);
      expect(Object.keys(rules.actions).filter((a) => rules.actions[a]).sort()).toEqual(expected.actions);
      expect(rules.flags).toEqual(expected.flags);
      expect((await stageRules.stageRulesFor(o.id, 'COMMITTEE', [committee])).get(committee)).toEqual(rules);
    });

    it('reads under a share lock inside a transaction, and refuses with the stage names', async () => {
      const o = await org();
      const committee = await committeeAt(o.id, 'terms_review');
      await prisma.$transaction(async (tx) => {
        await expect(stageRules.stageAllows('COMMITTEE', committee, 'add_member', o.id, tx, { lock: 'share' })).resolves.toBe(true);
        const refusal = await stageRules.assertStageAllows('COMMITTEE', committee, 'edit_details', o.id, tx, { lock: 'share' }).catch((e: unknown) => e);
        expect((refusal as { getResponse(): unknown }).getResponse()).toMatchObject({
          code: 'STAGE_ACTION_NOT_ALLOWED',
          action: 'edit_details',
          stageNameEn: 'Terms Review',
        });
      });
    });

    it('should NOT return records belonging to a different tenant — another organisation asking about a committee is allowed nothing', async () => {
      const a = await org();
      const b = await org();
      const committee = await committeeAt(a.id, 'active');
      const rules = await stageRules.currentStageRules('COMMITTEE', committee, b.id);
      expect(rules.stageId).toBeNull();
      expect(Object.values(rules.actions).some(Boolean)).toBe(false);
      expect((await stageRules.stageRulesFor(b.id, 'COMMITTEE', [committee])).get(committee)?.stageId).toBeNull();
    });
  });

  describe('D14 — a committee with no workflow instance allows nothing (§13 count 7 is 0 on the shared database)', () => {
    const NOTHING = { edit_details: false, add_member: false, remove_member: false, change_member_role: false, request_change: false };

    it("is allowed none of the five actions and has no flags: in the engine's answer, the committee read and the list", async () => {
      const o = await org();
      const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${randomUUID().slice(0, 6)}` } });
      const committee = await prisma.committee.create({
        data: { organizationId: o.id, nameEn: 'Committee with no workflow', typeValueId: 'type', orgUnitId: unit.id },
      });
      expect(await prisma.workflowInstance.count({ where: { objectType: 'COMMITTEE', objectId: committee.id } })).toBe(0);

      const rules = await stageRules.currentStageRules('COMMITTEE', committee.id, o.id);
      expect(rules).toEqual({ stageId: null, stageNameEn: null, stageNameAr: null, flags: [], actions: NOTHING });
      for (const action of Object.keys(NOTHING)) {
        const refusal = await stageRules.assertStageAllows('COMMITTEE', committee.id, action, o.id).catch((e: { getResponse(): unknown }) => e.getResponse());
        expect(refusal).toMatchObject({ code: 'STAGE_ACTION_NOT_ALLOWED', action, stageNameEn: null });
      }

      const committees = new CommitteesService(prisma, new AuditLogService(prisma), {} as WorkflowService, stageRules);
      expect((await committees.getCommitteeDetail(committee.id, o.id)).stageRules).toEqual({ actions: NOTHING, flags: [] });
      const row = (await committees.listCommittees(o.id)).find((c) => c.id === committee.id);
      expect(row?.stageRules).toEqual({ actions: NOTHING, flags: [] });

      // An open change request on it keeps the moves an unkeyed stage gave:
      // with no flags, the §4.2 derivation allows edit, withdraw and reject.
      expect(CHANGE_REQUEST_ACTIONS.filter((a) => committeeAllowsRequestMove(rules, a))).toEqual(['edit', 'withdraw', 'reject']);
    });
  });

  describe('stage saves', () => {
    it('write the rules and one audit row naming exactly what changed', async () => {
      const o = await org();
      const active = await stageId(o.id, 'COMMITTEE', 'active');

      const saved = await templates.updateStage(active, { actions: ['add_member'], flags: ['IN_FORCE'] } as never, o.id, o.actorId);

      expect(saved).toMatchObject({ actions: ['add_member'], flags: ['IN_FORCE'] });
      expect((await rulesByKey(o.id, 'COMMITTEE'))['active']).toEqual({ actions: ['add_member'], flags: ['IN_FORCE'] });
      const rows = await prisma.auditLog.findMany({ where: { organizationId: o.id, objectType: 'WorkflowStage', objectId: active } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: o.actorId,
        action: 'UPDATE',
        before: { actions: ['add_member', 'remove_member', 'change_member_role', 'request_change'] },
        after: { actions: ['add_member'] },
      });

      // The same save again changes nothing and writes no row.
      await templates.updateStage(active, { actions: ['add_member'], flags: ['IN_FORCE'] } as never, o.id, o.actorId);
      expect(await prisma.auditLog.count({ where: { organizationId: o.id, objectType: 'WorkflowStage', objectId: active } })).toBe(1);
    });

    it("add and remove audit the whole stage, its rules included", async () => {
      const o = await org();
      const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
      const added = await templates.addStage(
        template.id,
        { nameEn: 'Board review', order: 25, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' } as never,
        o.id,
        o.actorId,
      );
      expect(added.actions).toEqual(['add_member', 'remove_member', 'change_member_role']);
      await templates.removeStage(added.id, o.id, o.actorId);

      const rows = await prisma.auditLog.findMany({ where: { organizationId: o.id, objectId: added.id }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => r.action)).toEqual(['CREATE', 'DELETE']);
      expect(rows[0]!.after).toMatchObject({ nameEn: 'Board review', actions: ['add_member', 'remove_member', 'change_member_role'], flags: [] });
      expect(rows[1]!.before).toMatchObject({ nameEn: 'Board review', actions: ['add_member', 'remove_member', 'change_member_role'], flags: [] });
      expect(await prisma.workflowStageRecordAction.count({ where: { stageId: added.id } })).toBe(0);
    });

    it("should NOT return records belonging to a different tenant — a save cannot reach another organisation's stage", async () => {
      const a = await org();
      const b = await org();
      const active = await stageId(a.id, 'COMMITTEE', 'active');
      await expect(templates.updateStage(active, { actions: [] } as never, b.id, b.actorId)).rejects.toThrow(NotFoundException);
      await expect(templates.removeStage(active, b.id, b.actorId)).rejects.toThrow(NotFoundException);
      expect((await rulesByKey(a.id, 'COMMITTEE'))['active']).toEqual(EXPECTED_COMMITTEE.active);
    });
  });
});
