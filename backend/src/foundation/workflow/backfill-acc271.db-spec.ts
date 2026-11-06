/**
 * ACC-271 PR 2 — backfill:acc271-stage-assignees and
 * backfill:acc271-transition-movers against a REAL Postgres (npm run test:db).
 *
 * They must: on a dry run write nothing; on --execute write exactly plan §6.1 /
 * §6.2's mapping, with one audit row per organisation; plan 0 on a second run
 * and write nothing again; refuse a customer organisation and a count that is
 * not plan §6.4's; put the forward move of an "All of them" stage on its
 * approval path; reset what is in flight on an open record (Q8, as Ahmad
 * changed it); and never touch another organisation.
 *
 * An organisation here is built as it stood BEFORE PR 2: the whole seed, then
 * the PR 2 shape taken off (no whoMode, no entries, no movers), and an ACTIVE
 * tenant admin.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import { applyWorkflowSeed } from './workflow-seed-apply';
import {
  EXPECTED as STAGE_EXPECTED,
  runBackfill as runStages,
  SCRIPT_NAME as STAGES_SCRIPT,
  type StageCounts,
} from '../../../prisma/backfill-acc271-stage-assignees';
import {
  EXPECTED as MOVER_EXPECTED,
  runBackfill as runMovers,
  SCRIPT_NAME as MOVERS_SCRIPT,
} from '../../../prisma/backfill-acc271-transition-movers';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(240_000);

const SECTION_6_4 = STAGE_EXPECTED['al-nakheel']!;
const MOVERS_6_4 = MOVER_EXPECTED['al-nakheel']!;

describe('backfill:acc271-stage-assignees and -transition-movers, on a real database (ACC-271 PR 2)', () => {
  const prisma = new PrismaService();
  const isFixture = () => true;

  interface Org {
    id: string;
    slug: string;
    adminId: string;
  }

  /**
   * ACC-271 PR 6b — the old who columns as the seed wrote them before 6b (dev
   * 1c68fea): [approvalMode, parallelThreshold, assigneeStrategy] per stage key,
   * [triggerCondition, requiredPermission] per move. The seed no longer writes
   * them, and these backfills read nothing else, so the fixture restores them.
   * Kept in this spec on purpose: the permissions-in-use scan skips specs, and
   * these strings check nothing. 6c deletes it with the backfills.
   */
  const LEGACY_COLUMNS: Record<string, { stages: Record<string, [string, string | null, string]>; transitions: Record<string, [string, string | null]> }> = {
  DOCUMENT_REQUEST: {
    stages: {
      submitted: ['SINGLE',null,'SELF'],
      unit_manager_review: ['SINGLE',null,'ORG_UNIT_HEAD'],
      quality_review: ['SINGLE',null,'ROLE'],
      approved: ['SINGLE',null,'ROLE'],
      rejected: ['SINGLE',null,'ROLE'],
    },
    transitions: {
      'submitted>unit_manager_review': ['ANY_AUTHENTICATED',null],
      'unit_manager_review>quality_review': ['ROLE_BASED','org:manage'],
      'unit_manager_review>rejected': ['ROLE_BASED','org:manage'],
      'quality_review>approved': ['ROLE_BASED','documents:approve'],
      'quality_review>rejected': ['ROLE_BASED','documents:approve'],
    },
  },
  DOCUMENT: {
    stages: {
      drafting: ['SINGLE',null,'SELF'],
      owners_review: ['PARALLEL','ALL','ROLE'],
      stakeholders_review: ['PARALLEL','ALL','ROLE'],
      final_approval: ['PARALLEL','ALL','ROLE'],
      publish_approval: ['SINGLE',null,'ROLE'],
      published: ['SINGLE',null,'ROLE'],
      obsolete: ['SINGLE',null,'ROLE'],
    },
    transitions: {
      'drafting>owners_review': ['ROLE_BASED','documents:submit'],
      'owners_review>stakeholders_review': ['ROLE_BASED','documents:review'],
      'owners_review>drafting': ['ROLE_BASED','documents:review'],
      'stakeholders_review>final_approval': ['ROLE_BASED','documents:review'],
      'stakeholders_review>drafting': ['ROLE_BASED','documents:review'],
      'final_approval>publish_approval': ['ROLE_BASED','documents:approve'],
      'final_approval>drafting': ['ROLE_BASED','documents:approve'],
      'publish_approval>published': ['ROLE_BASED','documents:publish'],
      'publish_approval>drafting': ['ROLE_BASED','documents:publish'],
      'published>obsolete': ['ROLE_BASED','documents:manage_templates'],
    },
  },
  INCIDENT: {
    stages: {
      reported: ['SINGLE',null,'ROLE'],
      investigating: ['SINGLE',null,'ROLE'],
      root_cause_identified: ['SINGLE',null,'ROLE'],
      closed: ['SINGLE',null,'ROLE'],
      cancelled: ['SINGLE',null,'ROLE'],
    },
    transitions: {
      'reported>investigating': ['ROLE_BASED','incidents:investigate'],
      'investigating>root_cause_identified': ['ROLE_BASED','incidents:investigate'],
      'investigating>closed': ['ROLE_BASED','incidents:close'],
      'root_cause_identified>closed': ['ROLE_BASED','incidents:close'],
      'reported>cancelled': ['ROLE_BASED','incidents:manage'],
      'investigating>cancelled': ['ROLE_BASED','incidents:manage'],
    },
  },
  AUDIT: {
    stages: {
      planning: ['SINGLE',null,'ROLE'],
      announced: ['SINGLE',null,'ROLE'],
      fieldwork: ['SINGLE',null,'ROLE'],
      findings_draft: ['SINGLE',null,'ROLE'],
      auditee_response: ['SINGLE',null,'ROLE'],
      report_review: ['SINGLE',null,'ROLE'],
      report_approved: ['SINGLE',null,'ROLE'],
      corrective_action: ['SINGLE',null,'ROLE'],
      verification: ['SINGLE',null,'ROLE'],
      closed: ['SINGLE',null,'ROLE'],
    },
    transitions: {
      'planning>announced': ['ROLE_BASED','audits:create'],
      'announced>fieldwork': ['ROLE_BASED','audits:execute'],
      'fieldwork>findings_draft': ['ROLE_BASED','audits:execute'],
      'findings_draft>auditee_response': ['ROLE_BASED','audits:report'],
      'auditee_response>report_review': ['ROLE_BASED','audits:execute'],
      'auditee_response>findings_draft': ['ROLE_BASED','audits:execute'],
      'report_review>report_approved': ['ROLE_BASED','audits:report'],
      'report_review>findings_draft': ['ROLE_BASED','audits:report'],
      'report_approved>corrective_action': ['ROLE_BASED','audits:close'],
      'corrective_action>verification': ['ROLE_BASED','audits:execute'],
      'verification>closed': ['ROLE_BASED','audits:close'],
      'verification>corrective_action': ['ROLE_BASED','audits:execute'],
    },
  },
  CORRECTIVE_ACTION: {
    stages: {
      detection: ['SINGLE',null,'ROLE'],
      investigation: ['SINGLE',null,'ROLE'],
      root_cause_approved: ['SINGLE',null,'ROLE'],
      action_planning: ['SINGLE',null,'ROLE'],
      plan_approved: ['SINGLE',null,'ROLE'],
      implementation: ['SINGLE',null,'ROLE'],
      implementation_verified: ['SINGLE',null,'ROLE'],
      effectiveness_check: ['SINGLE',null,'ROLE'],
      effectiveness_approved: ['SINGLE',null,'ROLE'],
      closed: ['SINGLE',null,'ROLE'],
    },
    transitions: {
      'detection>investigation': ['ROLE_BASED','capa:investigate'],
      'investigation>root_cause_approved': ['ROLE_BASED','capa:investigate'],
      'root_cause_approved>action_planning': ['ROLE_BASED','capa:approve'],
      'root_cause_approved>investigation': ['ROLE_BASED','capa:approve'],
      'action_planning>plan_approved': ['ROLE_BASED','capa:investigate'],
      'plan_approved>implementation': ['ROLE_BASED','capa:approve'],
      'plan_approved>action_planning': ['ROLE_BASED','capa:approve'],
      'implementation>implementation_verified': ['ROLE_BASED','capa:investigate'],
      'implementation_verified>effectiveness_check': ['ROLE_BASED','capa:investigate'],
      'implementation_verified>implementation': ['ROLE_BASED','capa:investigate'],
      'effectiveness_check>effectiveness_approved': ['ROLE_BASED','capa:investigate'],
      'effectiveness_approved>closed': ['ROLE_BASED','capa:close'],
      'effectiveness_approved>implementation': ['ROLE_BASED','capa:approve'],
    },
  },
  MEETING: {
    stages: {
      planned: ['SINGLE',null,'SELF'],
      agenda_ready: ['SINGLE',null,'SELF'],
      minutes_draft: ['SINGLE',null,'SELF'],
      minutes_review: ['PARALLEL','ALL','ROLE'],
      minutes_approved: ['SINGLE',null,'ROLE'],
      cancelled: ['SINGLE',null,'ROLE'],
    },
    transitions: {
      'planned>agenda_ready': ['ROLE_BASED','meetings:manage'],
      'planned>cancelled': ['ROLE_BASED','meetings:manage'],
      'agenda_ready>minutes_draft': ['ROLE_BASED','meetings:manage'],
      'agenda_ready>cancelled': ['ROLE_BASED','meetings:manage'],
      'minutes_draft>minutes_review': ['ROLE_BASED','meetings:manage'],
      'minutes_review>minutes_approved': ['ROLE_BASED','meetings:approve_minutes'],
      'minutes_review>minutes_draft': ['ROLE_BASED','meetings:manage'],
      'minutes_draft>minutes_draft': ['ROLE_BASED','meetings:manage'],
    },
  },
  COMMITTEE: {
    stages: {
      formation: ['SINGLE',null,'ROLE'],
      terms_review: ['SINGLE',null,'ROLE'],
      active: ['SINGLE',null,'ROLE'],
      suspended: ['SINGLE',null,'ROLE'],
      dissolution_pending: ['SINGLE',null,'ROLE'],
      dissolved: ['SINGLE',null,'ROLE'],
    },
    transitions: {
      'formation>terms_review': ['ROLE_BASED','committees:manage'],
      'terms_review>active': ['ROLE_BASED','committees:approve'],
      'terms_review>formation': ['ROLE_BASED','committees:manage'],
      'active>suspended': ['ROLE_BASED','committees:manage'],
      'suspended>active': ['ROLE_BASED','committees:manage'],
      'active>dissolution_pending': ['ROLE_BASED','committees:manage'],
      'suspended>dissolution_pending': ['ROLE_BASED','committees:manage'],
      'dissolution_pending>dissolved': ['ROLE_BASED','committees:approve'],
    },
  },
  COMMITTEE_CHANGE_REQUEST: {
    stages: {
      draft: ['SINGLE',null,'SELF'],
      under_review: ['SINGLE',null,'SELF'],
      returned: ['SINGLE',null,'SELF'],
      approved: ['SINGLE',null,'SELF'],
      rejected: ['SINGLE',null,'SELF'],
      withdrawn: ['SINGLE',null,'SELF'],
    },
    transitions: {
      'draft>under_review': ['SYSTEM_AUTOMATIC',null],
      'returned>under_review': ['SYSTEM_AUTOMATIC',null],
      'under_review>approved': ['SYSTEM_AUTOMATIC',null],
      'under_review>returned': ['SYSTEM_AUTOMATIC',null],
      'under_review>rejected': ['SYSTEM_AUTOMATIC',null],
      'draft>withdrawn': ['SYSTEM_AUTOMATIC',null],
      'under_review>withdrawn': ['SYSTEM_AUTOMATIC',null],
      'returned>withdrawn': ['SYSTEM_AUTOMATIC',null],
    },
  },
  CHANGE_REQUEST: {
    stages: {
      submitted: ['SINGLE',null,'SELF'],
      unit_manager_review: ['SINGLE',null,'ORG_UNIT_HEAD'],
      quality_review: ['SINGLE',null,'ROLE'],
      approved: ['SINGLE',null,'ROLE'],
      rejected: ['SINGLE',null,'ROLE'],
    },
    transitions: {
      'submitted>unit_manager_review': ['ANY_AUTHENTICATED',null],
      'unit_manager_review>quality_review': ['ROLE_BASED','org:manage'],
      'unit_manager_review>rejected': ['ROLE_BASED','org:manage'],
      'quality_review>approved': ['ROLE_BASED','documents:approve'],
      'quality_review>rejected': ['ROLE_BASED','documents:approve'],
    },
  },
  };

  /** An organisation as it stood before PR 2, with one ACTIVE tenant admin. */
  async function legacyOrg(): Promise<Org> {
    const slug = `acc271b-${randomUUID().slice(0, 8)}`;
    const id = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const roleKeys = new Set<string>(['TENANT_ADMIN']);
    for (const key of roleKeys) await prisma.role.create({ data: { organizationId: id, key, nameEn: key, isSystem: true } });
    await applyWorkflowSeed(prisma, id, SYSTEM_WORKFLOW_SEED);
    // The old columns, as the seed wrote them before PR 6b.
    // Stages are found by name: only keyed templates store the seed's key.
    for (const [objectType, legacy] of Object.entries(LEGACY_COLUMNS)) {
      const seed = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === objectType)!;
      const rows = await prisma.workflowStage.findMany({ where: { workflowTemplate: { organizationId: id, objectType: objectType as never, isDefault: true } } });
      const stageIdOf = (key: string) => rows.find((r) => r.nameEn === seed.stages.find((st) => st.key === key)!.nameEn)!.id;
      for (const [key, [approvalMode, parallelThreshold, assigneeStrategy]] of Object.entries(legacy.stages)) {
        await prisma.workflowStage.update({ where: { id: stageIdOf(key) }, data: { approvalMode, parallelThreshold, assigneeStrategy } as never });
      }
      for (const [move, [triggerCondition, requiredPermission]] of Object.entries(legacy.transitions)) {
        const [from, to] = move.split('>') as [string, string];
        await prisma.workflowTransition.updateMany({
          where: { fromStageId: stageIdOf(from), toStageId: stageIdOf(to) },
          data: { triggerCondition, requiredPermission } as never,
        });
      }
    }
    // Take PR 2's shape off again.
    await prisma.workflowStageAssignee.deleteMany({ where: { organizationId: id } });
    await prisma.workflowStage.updateMany({ where: { workflowTemplate: { organizationId: id } }, data: { whoMode: null } });
    await prisma.workflowTransition.updateMany({ where: { fromStage: { workflowTemplate: { organizationId: id } } }, data: { mover: null } });
    const adminId = await person(id, slug, 'ACTIVE', true);
    return { id, slug, adminId };
  }

  async function person(organizationId: string, slug: string, status: 'ACTIVE' | 'INVITED' | 'INACTIVE', admin: boolean): Promise<string> {
    const u = await prisma.user.create({ data: { organizationId, email: `${slug}-${randomUUID().slice(0, 6)}@example.test`, name: 'Person', status } });
    if (admin) {
      const role = await prisma.role.findFirstOrThrow({ where: { organizationId, key: 'TENANT_ADMIN' } });
      await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
    }
    return u.id;
  }

  const expectFor = (o: Org, counts: StageCounts = SECTION_6_4) => ({ [o.slug]: counts });
  const stagesScope = (o: Org) => ({ workflowTemplate: { organizationId: o.id } });
  const audits = (organizationId: string, source: string) =>
    prisma.auditLog.count({ where: { organizationId, metadata: { path: ['source'], equals: source } } });
  const stageAt = (o: Org, objectType: 'COMMITTEE' | 'DOCUMENT', key: string) =>
    prisma.workflowStage.findFirstOrThrow({ where: { key, workflowTemplate: { organizationId: o.id, objectType } } }).catch(() => null);

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('stages', () => {
    it('a dry run plans plan §6.4 exactly and writes nothing', async () => {
      const o = await legacyOrg();

      const result = await runStages(prisma, { execute: false, organizationIds: [o.id], isFixture, expected: expectFor(o) });

      expect(result.refused).toEqual([]);
      expect(result.plans[0]!.counts).toEqual(SECTION_6_4);
      expect(await prisma.workflowStageAssignee.count({ where: { organizationId: o.id } })).toBe(0);
      expect(await prisma.workflowStage.count({ where: { ...stagesScope(o), whoMode: null } })).toBe(60);
      expect(await audits(o.id, STAGES_SCRIPT)).toBe(0);
    });

    it('execute writes exactly the mapping with one audit row; a second dry run plans 0 and a second execute writes nothing', async () => {
      const o = await legacyOrg();

      const first = await runStages(prisma, { execute: true, organizationIds: [o.id], isFixture, expected: expectFor(o) });

      expect(first.refused).toEqual([]);
      expect(first.changed).toEqual([{ slug: o.slug, counts: SECTION_6_4 }]);
      const entries = await prisma.workflowStageAssignee.findMany({ where: { organizationId: o.id } });
      const byKind = (kind: string) => entries.filter((e) => e.kind === kind);
      expect(byKind('SPECIFIC_USER')).toHaveLength(48);
      expect(byKind('SPECIFIC_USER').every((e) => e.userId === o.adminId && e.isStartingAssignment && e.order === 1)).toBe(true);
      expect(byKind('CREATOR')).toHaveLength(12);
      expect(byKind('ORG_UNIT_HEAD')).toHaveLength(0);
      expect(entries).toHaveLength(60);
      expect(await prisma.workflowStage.count({ where: { ...stagesScope(o), whoMode: 'ANY_ONE' } })).toBe(56);
      expect(await prisma.workflowStage.count({ where: { ...stagesScope(o), whoMode: 'ALL' } })).toBe(4);
      expect(await prisma.workflowStage.count({ where: { ...stagesScope(o), whoMode: null } })).toBe(0);
      // A Role stage starts on the admin; a creator's stage is the creator.
      const formation = (await stageAt(o, 'COMMITTEE', 'formation'))!;
      expect(entries.filter((e) => e.stageId === formation.id).map((e) => e.kind)).toEqual(['SPECIFIC_USER']);
      expect(await audits(o.id, STAGES_SCRIPT)).toBe(1);

      const again = await runStages(prisma, { execute: false, organizationIds: [o.id], isFixture, expected: expectFor(o) });
      expect(again.plans[0]!.counts.stages).toBe(0);
      const executedAgain = await runStages(prisma, { execute: true, organizationIds: [o.id], isFixture, expected: expectFor(o) });
      expect(executedAgain.changed).toEqual([]);
      expect(await prisma.workflowStageAssignee.count({ where: { organizationId: o.id } })).toBe(60);
      expect(await audits(o.id, STAGES_SCRIPT)).toBe(1);
    });

    // Ahmad, 29 Oct — an Org unit head stage becomes "the head of the record's
    // unit" only where the record type can name its unit (RECORD_ROUTES);
    // elsewhere it starts on the tenant admin, as the seed gives a new one.
    describe("Org unit head stages", () => {
      it("on a record type with no unit route (document requests): the tenant admin's starting assignment", async () => {
        const o = await legacyOrg();
        const unitManager = await prisma.workflowStage.findFirstOrThrow({
          where: { nameEn: 'Unit Manager Review', workflowTemplate: { organizationId: o.id, objectType: 'DOCUMENT_REQUEST' } },
        });
        expect(unitManager.assigneeStrategy).toBe('ORG_UNIT_HEAD');

        await runStages(prisma, { execute: true, organizationIds: [o.id], isFixture, expected: expectFor(o) });

        const entries = await prisma.workflowStageAssignee.findMany({ where: { stageId: unitManager.id } });
        expect(entries.map((e) => [e.kind, e.userId, e.isStartingAssignment])).toEqual([['SPECIFIC_USER', o.adminId, true]]);
      });

      it("on a record type with a unit route (committees): the head of the record's unit", async () => {
        const o = await legacyOrg();
        const terms = (await stageAt(o, 'COMMITTEE', 'terms_review'))!;
        await prisma.workflowStage.update({ where: { id: terms.id }, data: { assigneeStrategy: 'ORG_UNIT_HEAD', assigneeRoleId: null } });

        const result = await runStages(prisma, {
          execute: true,
          organizationIds: [o.id],
          isFixture,
          expected: expectFor(o, { ...SECTION_6_4, startingAssignments: 47, entries: { ...SECTION_6_4.entries, ORG_UNIT_HEAD: 1 } }),
        });

        expect(result.refused).toEqual([]);
        const entries = await prisma.workflowStageAssignee.findMany({ where: { stageId: terms.id } });
        expect(entries.map((e) => [e.kind, e.orgUnitId, e.isStartingAssignment])).toEqual([['ORG_UNIT_HEAD', null, false]]);
      });
    });

    it('starts the stages on the earliest-assigned ACTIVE tenant admin: an earlier INVITED or INACTIVE one does not count', async () => {
      const slug = `acc271e-${randomUUID().slice(0, 8)}`;
      const o = await legacyOrg();
      // Make the org's own admin the latest of three, behind an INVITED and an INACTIVE one assigned earlier.
      const role = await prisma.role.findFirstOrThrow({ where: { organizationId: o.id, key: 'TENANT_ADMIN' } });
      await prisma.userRole.updateMany({ where: { roleId: role.id }, data: { createdAt: new Date(Date.now() + 60_000) } });
      const invited = await person(o.id, slug, 'INVITED', true);
      const inactive = await person(o.id, slug, 'INACTIVE', true);
      await prisma.userRole.updateMany({ where: { roleId: role.id, userId: { in: [invited, inactive] } }, data: { createdAt: new Date(Date.now() - 60_000) } });

      await runStages(prisma, { execute: true, organizationIds: [o.id], isFixture, expected: expectFor(o) });

      const starting = await prisma.workflowStageAssignee.findMany({ where: { organizationId: o.id, isStartingAssignment: true }, select: { userId: true } });
      expect(new Set(starting.map((s) => s.userId))).toEqual(new Set([o.adminId]));
    });

    it('refuses a customer organisation, and writes nothing', async () => {
      const o = await legacyOrg();

      const result = await runStages(prisma, { execute: true, organizationIds: [o.id], isFixture: () => false, expected: expectFor(o) });

      expect(result.refused).toEqual([{ slug: o.slug, reason: 'a customer organisation (ACC-101)' }]);
      expect(await prisma.workflowStageAssignee.count({ where: { organizationId: o.id } })).toBe(0);
      expect(await prisma.workflowStage.count({ where: { ...stagesScope(o), whoMode: null } })).toBe(60);
    });

    it('refuses a count that is not plan §6.4, and writes nothing', async () => {
      const o = await legacyOrg();

      const result = await runStages(prisma, { execute: true, organizationIds: [o.id], isFixture, expected: expectFor(o, { ...SECTION_6_4, stages: 59 }) });

      expect(result.refused).toHaveLength(1);
      expect(result.refused[0]!.reason).toMatch(/^counts differ from plan §6\.4/);
      expect(await prisma.workflowStageAssignee.count({ where: { organizationId: o.id } })).toBe(0);
    });

    it("puts an All of them stage's forward move on its approval path when it is not", async () => {
      const o = await legacyOrg();
      const owners = (await stageAt(o, 'DOCUMENT', 'owners_review')) ?? (await prisma.workflowStage.findFirstOrThrow({ where: { nameEn: 'Owners Review', ...stagesScope(o) } }));
      const advance = await prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: owners.id, kind: 'ADVANCE' } });
      await prisma.workflowTransition.update({ where: { id: advance.id }, data: { isApprovalPath: false } });

      const result = await runStages(prisma, { execute: true, organizationIds: [o.id], isFixture, expected: expectFor(o, { ...SECTION_6_4, approvalPathMarks: 1 }) });

      expect(result.refused).toEqual([]);
      expect((await prisma.workflowTransition.findUniqueOrThrow({ where: { id: advance.id } })).isApprovalPath).toBe(true);
    });

    it('resets what is in flight on an open record: its approvals removed, its open stage tasks cancelled, counted', async () => {
      const o = await legacyOrg();
      const formation = (await stageAt(o, 'COMMITTEE', 'formation'))!;
      const instance = await prisma.workflowInstance.create({
        data: { organizationId: o.id, workflowTemplateId: formation.workflowTemplateId, objectType: 'COMMITTEE', objectId: randomUUID(), status: 'IN_PROGRESS', currentStageId: formation.id },
      });
      const entry = await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: formation.id, actorId: o.adminId } });
      await prisma.workflowApproval.create({ data: { workflowInstanceStageId: entry.id, approverId: o.adminId, decision: 'APPROVED', decidedAt: new Date() } });
      const task = await prisma.task.create({
        data: {
          organizationId: o.id,
          title: 'Check the terms',
          sourceType: 'COMMITTEE',
          sourceId: instance.objectId,
          createdById: o.adminId,
          workflowInstanceId: instance.id,
          workflowInstanceStageId: entry.id,
          sourceStageId: formation.id,
        },
      });

      const result = await runStages(prisma, {
        execute: true,
        organizationIds: [o.id],
        isFixture,
        expected: expectFor(o, { ...SECTION_6_4, approvalsReset: 1, tasksCancelled: 1 }),
      });

      expect(result.refused).toEqual([]);
      expect(result.changed[0]!.counts).toMatchObject({ approvalsReset: 1, tasksCancelled: 1 });
      expect(await prisma.workflowApproval.count({ where: { workflowInstanceStageId: entry.id } })).toBe(0);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('CANCELLED');
      // The record itself stays where it is, now on a converted stage.
      expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } })).currentStageId).toBe(formation.id);
      expect((await prisma.workflowStage.findUniqueOrThrow({ where: { id: formation.id } })).whoMode).toBe('ANY_ONE');
    });

    itEnforcesTenantIsolation('backfill:acc271-stage-assignees — converting one organisation leaves another untouched', async () => {
      const a = await legacyOrg();
      const b = await legacyOrg();

      await runStages(prisma, { execute: true, organizationIds: [a.id], isFixture, expected: { ...expectFor(a), ...expectFor(b) } });

      expect(await prisma.workflowStageAssignee.count({ where: { organizationId: b.id } })).toBe(0);
      expect(await prisma.workflowStage.count({ where: { ...stagesScope(b), whoMode: null } })).toBe(60);
      expect(await audits(b.id, STAGES_SCRIPT)).toBe(0);
      // A's starting assignments name A's admin only.
      expect(await prisma.workflowStageAssignee.count({ where: { organizationId: a.id, userId: b.adminId } })).toBe(0);
    });
  });

  describe('transition movers', () => {
    const moversFor = (o: Org, counts = MOVERS_6_4) => ({ [o.slug]: counts });

    it('dry run writes nothing; execute marks 8 APP and 67 PERSON with one audit row; a second dry run plans 0', async () => {
      const o = await legacyOrg();
      const scope = { fromStage: stagesScope(o) };

      const dry = await runMovers(prisma, { execute: false, organizationIds: [o.id], isFixture, expected: moversFor(o) });
      expect(dry.refused).toEqual([]);
      expect(dry.plans[0]!.counts).toEqual(MOVERS_6_4);
      expect(Object.values(dry.plans[0]!.permissionsByKey).reduce((n, c) => n + c, 0)).toBe(65);
      expect(await prisma.workflowTransition.count({ where: { ...scope, mover: null } })).toBe(75);

      const run = await runMovers(prisma, { execute: true, organizationIds: [o.id], isFixture, expected: moversFor(o) });
      expect(run.changed).toEqual([{ slug: o.slug, counts: MOVERS_6_4 }]);
      expect(await prisma.workflowTransition.count({ where: { ...scope, mover: 'APP', triggerCondition: 'SYSTEM_AUTOMATIC' } })).toBe(8);
      expect(await prisma.workflowTransition.count({ where: { ...scope, mover: 'PERSON' } })).toBe(67);
      expect(await prisma.workflowTransition.count({ where: { ...scope, mover: null } })).toBe(0);
      // The old fields stay where they are, unread.
      expect(await prisma.workflowTransition.count({ where: { ...scope, requiredPermission: { not: null } } })).toBe(65);
      expect(await audits(o.id, MOVERS_SCRIPT)).toBe(1);

      const again = await runMovers(prisma, { execute: true, organizationIds: [o.id], isFixture, expected: moversFor(o) });
      expect(again.plans[0]!.counts.transitions).toBe(0);
      expect(again.changed).toEqual([]);
      expect(await audits(o.id, MOVERS_SCRIPT)).toBe(1);
    });

    it('refuses a customer organisation and a count that is not plan §6.4, writing nothing', async () => {
      const o = await legacyOrg();

      const customer = await runMovers(prisma, { execute: true, organizationIds: [o.id], isFixture: () => false, expected: moversFor(o) });
      const wrong = await runMovers(prisma, { execute: true, organizationIds: [o.id], isFixture, expected: moversFor(o, { ...MOVERS_6_4, app: 7 }) });

      expect(customer.refused).toEqual([{ slug: o.slug, reason: 'a customer organisation (ACC-101)' }]);
      expect(wrong.refused[0]!.reason).toMatch(/^counts differ from plan §6\.4/);
      expect(await prisma.workflowTransition.count({ where: { fromStage: stagesScope(o), mover: { not: null } } })).toBe(0);
    });
  });
});
