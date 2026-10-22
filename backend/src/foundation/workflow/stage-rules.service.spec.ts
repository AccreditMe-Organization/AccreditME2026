import { PrismaService } from '../../prisma/prisma.service';
import { StageRulesService } from './stage-rules.service';
import { WorkflowRefusalException } from './workflow-refusal';

// ACC-255 — the engine's answer about a record's current stage. Unit-level:
// the queries' shape (newest instance, organisation in every WHERE) and the
// answer built from rows. The real-database proofs are in
// stage-rules.db-spec.ts.

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

function sqlText(call: unknown[]): string {
  const strings = call[0] as TemplateStringsArray;
  return strings.join('?');
}

function makePrisma(opts: {
  current?: { instanceId: string; stageId: string | null } | null;
  stage?: { id: string; nameEn: string; nameAr: string | null; flags: string[] } | null;
  actions?: string[];
}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(opts.current ? [opts.current] : []),
    workflowStage: {
      findFirst: jest.fn().mockResolvedValue(opts.stage ?? null),
      findMany: jest.fn().mockResolvedValue(opts.stage ? [opts.stage] : []),
    },
    workflowStageRecordAction: {
      findMany: jest.fn().mockResolvedValue((opts.actions ?? []).map((actionKey) => ({ actionKey, stageId: opts.stage?.id }))),
    },
    workflowInstance: {
      findMany: jest.fn(),
    },
  };
}

const ACTIVE = { id: 'st-active', nameEn: 'Active', nameAr: 'نشطة', flags: ['IN_FORCE'] };

describe('StageRulesService (ACC-255)', () => {
  describe('currentStageRules', () => {
    it("answers from the stage's own rows: every registered action, true where a row exists, flags in registry order", async () => {
      const prisma = makePrisma({
        current: { instanceId: 'wi-1', stageId: ACTIVE.id },
        stage: ACTIVE,
        actions: ['request_change', 'add_member', 'remove_member', 'change_member_role'],
      });
      const service = new StageRulesService(prisma as unknown as PrismaService);
      await expect(service.currentStageRules('COMMITTEE', 'c-1', ORG)).resolves.toEqual({
        stageId: ACTIVE.id,
        stageNameEn: 'Active',
        stageNameAr: 'نشطة',
        flags: ['IN_FORCE'],
        actions: { edit_details: false, add_member: true, remove_member: true, change_member_role: true, request_change: true },
      });
    });

    it('reads the NEWEST instance, scoped by organisation and type, and locks it only when asked', async () => {
      const prisma = makePrisma({ current: { instanceId: 'wi-1', stageId: ACTIVE.id }, stage: ACTIVE });
      const service = new StageRulesService(prisma as unknown as PrismaService);

      await service.currentStageRules('COMMITTEE', 'c-1', ORG);
      const plain = prisma.$queryRaw.mock.calls[0] as unknown[];
      expect(sqlText(plain)).toContain('ORDER BY wi."createdAt" DESC');
      expect(sqlText(plain)).toContain('wi."organizationId" = ?');
      expect(JSON.stringify(plain)).not.toContain('FOR SHARE');
      expect(plain.slice(1, 4)).toEqual([ORG, 'COMMITTEE', 'c-1']);

      await service.currentStageRules('COMMITTEE', 'c-1', ORG, undefined, { lock: 'share' });
      expect(JSON.stringify(prisma.$queryRaw.mock.calls[1])).toContain('FOR SHARE OF wi');
    });

    it('should NOT return records belonging to a different tenant — the stage and its action rows are read with the caller\'s organisation', async () => {
      const prisma = makePrisma({ current: { instanceId: 'wi-1', stageId: ACTIVE.id }, stage: null, actions: ['add_member'] });
      const service = new StageRulesService(prisma as unknown as PrismaService);
      const rules = await service.currentStageRules('COMMITTEE', 'c-1', OTHER_ORG);
      expect(prisma.workflowStage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ACTIVE.id, workflowTemplate: { organizationId: OTHER_ORG } } }),
      );
      expect(prisma.workflowStageRecordAction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: OTHER_ORG, stageId: ACTIVE.id } }),
      );
      // Another organisation's stage is not found, so nothing is allowed.
      expect(rules.stageId).toBeNull();
      expect(Object.values(rules.actions).every((v) => v === false)).toBe(true);
    });

    it('fails closed: no instance, or no current stage, allows nothing and has no flags', async () => {
      for (const current of [null, { instanceId: 'wi-1', stageId: null }]) {
        const prisma = makePrisma({ current });
        const service = new StageRulesService(prisma as unknown as PrismaService);
        await expect(service.currentStageRules('COMMITTEE', 'c-1', ORG)).resolves.toEqual({
          stageId: null,
          stageNameEn: null,
          stageNameAr: null,
          flags: [],
          actions: { edit_details: false, add_member: false, remove_member: false, change_member_role: false, request_change: false },
        });
        expect(prisma.workflowStage.findFirst).not.toHaveBeenCalled();
      }
    });

    it('ignores an action row or flag the registry does not list', async () => {
      const prisma = makePrisma({
        current: { instanceId: 'wi-1', stageId: 'st' },
        stage: { id: 'st', nameEn: 'X', nameAr: null, flags: ['NOT_A_FLAG', 'DISSOLVING'] },
        actions: ['not_an_action', 'add_member'],
      });
      const rules = await new StageRulesService(prisma as unknown as PrismaService).currentStageRules('COMMITTEE', 'c-1', ORG);
      expect(rules.flags).toEqual(['DISSOLVING']);
      expect(Object.keys(rules.actions)).toEqual(['edit_details', 'add_member', 'remove_member', 'change_member_role', 'request_change']);
      expect(rules.actions['add_member']).toBe(true);
    });
  });

  describe('stageAllows / assertStageAllows', () => {
    const formation = { id: 'st-f', nameEn: 'Formation', nameAr: 'التشكيل', flags: [] };

    it('allows an action the stage has a row for', async () => {
      const prisma = makePrisma({ current: { instanceId: 'wi', stageId: formation.id }, stage: formation, actions: ['edit_details'] });
      const service = new StageRulesService(prisma as unknown as PrismaService);
      await expect(service.stageAllows('COMMITTEE', 'c-1', 'edit_details', ORG)).resolves.toBe(true);
      await expect(service.assertStageAllows('COMMITTEE', 'c-1', 'edit_details', ORG)).resolves.toBeUndefined();
    });

    it('refuses 409 STAGE_ACTION_NOT_ALLOWED naming the action and the stage', async () => {
      const prisma = makePrisma({ current: { instanceId: 'wi', stageId: ACTIVE.id }, stage: ACTIVE, actions: ['add_member'] });
      const service = new StageRulesService(prisma as unknown as PrismaService);
      await expect(service.stageAllows('COMMITTEE', 'c-1', 'edit_details', ORG)).resolves.toBe(false);
      const refusal = await service.assertStageAllows('COMMITTEE', 'c-1', 'edit_details', ORG).catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(WorkflowRefusalException);
      expect((refusal as WorkflowRefusalException).getStatus()).toBe(409);
      expect((refusal as WorkflowRefusalException).getResponse()).toMatchObject({
        code: 'STAGE_ACTION_NOT_ALLOWED',
        action: 'edit_details',
        stageNameEn: 'Active',
        stageNameAr: 'نشطة',
      });
    });

    it('never allows an action the record type does not register, without reading anything', async () => {
      const prisma = makePrisma({ current: { instanceId: 'wi', stageId: formation.id }, stage: formation, actions: ['edit_details'] });
      const service = new StageRulesService(prisma as unknown as PrismaService);
      await expect(service.stageAllows('DOCUMENT', 'd-1', 'edit_details', ORG)).resolves.toBe(false);
      await expect(service.assertStageAllows('DOCUMENT', 'd-1', 'edit_details', ORG)).rejects.toBeInstanceOf(WorkflowRefusalException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('stageRulesFor (the lists)', () => {
    it('answers many records in three queries, newest instance first, every one scoped by organisation', async () => {
      const prisma = makePrisma({ stage: ACTIVE, actions: ['request_change'] });
      prisma.workflowInstance.findMany.mockResolvedValue([
        { objectId: 'c-1', currentStageId: ACTIVE.id },
        { objectId: 'c-1', currentStageId: 'older' },
        { objectId: 'c-2', currentStageId: null },
      ]);
      const service = new StageRulesService(prisma as unknown as PrismaService);
      const result = await service.stageRulesFor(ORG, 'COMMITTEE', ['c-1', 'c-2', 'c-3']);

      expect(prisma.workflowInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG, objectType: 'COMMITTEE', objectId: { in: ['c-1', 'c-2', 'c-3'] } }, orderBy: { createdAt: 'desc' } }),
      );
      expect(prisma.workflowStage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [ACTIVE.id] }, workflowTemplate: { organizationId: ORG } } }),
      );
      expect(prisma.workflowStageRecordAction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG, stageId: { in: [ACTIVE.id] } } }),
      );
      expect(result.get('c-1')).toMatchObject({ stageId: ACTIVE.id, flags: ['IN_FORCE'], actions: { request_change: true, add_member: false } });
      expect(result.get('c-2')).toMatchObject({ stageId: null, flags: [] });
      expect(result.get('c-3')).toMatchObject({ stageId: null, flags: [] });
    });

    it('reads nothing for an empty set', async () => {
      const prisma = makePrisma({});
      const result = await new StageRulesService(prisma as unknown as PrismaService).stageRulesFor(ORG, 'COMMITTEE', []);
      expect(result.size).toBe(0);
      expect(prisma.workflowInstance.findMany).not.toHaveBeenCalled();
    });
  });
});
