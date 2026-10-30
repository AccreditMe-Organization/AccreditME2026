import { HttpException, NotFoundException } from '@nestjs/common';
import { WorkflowTemplateService } from './workflow-template.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import type { StageTaskDefinitionService } from './stage-task-definition.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

/**
 * ACC-271 PR 3 — the stage save's `who`, the old people fields, the template
 * read's who, sentence, kinds and app moves, and Keep this assignment. A focused
 * mock: the whole-service spec covers everything else.
 */

const ORG = 'org-a';
const ACTOR = 'actor-1';

const STAGE = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  workflowTemplate: { objectType: 'COMMITTEE' },
  key: 'formation',
  nameEn: 'Formation',
  nameAr: 'التأسيس',
  description: null,
  order: 10,
  slaWorkingHours: null,
  isInitial: true,
  isFinal: false,
  approvalMode: 'SINGLE',
  parallelThreshold: null,
  committeeId: null,
  assigneeStrategy: 'ROLE',
  assigneeUserId: null,
  assigneeRoleId: 'role-qm',
  assigneeCommitteeRoleValueId: null,
  assigneePositionId: null,
  assigneeOrgUnitId: null,
  escalationConfig: null,
  flags: [] as string[],
  recordActions: [] as { actionKey: string }[],
  whoMode: 'ANY_ONE' as string | null,
};

const STARTING = {
  id: 'entry-start',
  organizationId: ORG,
  stageId: 'stage-1',
  order: 1,
  kind: 'SPECIFIC_USER',
  userId: 'admin-1',
  positionId: null,
  orgUnitId: null,
  committeeId: null,
  committeeRoleValueId: null,
  isStartingAssignment: true,
  createdAt: new Date('2026-10-28T00:00:00Z'),
  createdById: null,
};

function build() {
  // The transaction runs its callback against this same mock.
  const self: { current: unknown } = { current: null };
  const prisma = {
    workflowStage: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    workflowTemplate: { findFirst: jest.fn() },
    workflowTransition: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    workflowStageAssignee: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    workflowStageRecordAction: { findMany: jest.fn().mockResolvedValue([]) },
    workflowInstance: { groupBy: jest.fn().mockResolvedValue([]) },
    user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    orgPosition: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    orgUnit: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    committee: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    lookupValue: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    permission: { findFirst: jest.fn().mockResolvedValue({ id: 'perm' }) },
    rolePermission: { count: jest.fn().mockResolvedValue(1) },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(self.current)),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  self.current = prisma;
  const audit = { log: jest.fn() };
  const stageTasks = {
    summaryForStages: jest.fn().mockResolvedValue(new Map()),
    taskDueHours: jest.fn().mockResolvedValue({}),
    assertStageDeadlineFits: jest.fn(),
  };
  const service = new WorkflowTemplateService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogService,
    stageTasks as unknown as StageTaskDefinitionService,
  );
  return { prisma, audit, service };
}

/** The refusal's code and body, or undefined when it did not throw. */
async function refusal(p: Promise<unknown>): Promise<Record<string, unknown> | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as Record<string, unknown>) };
    throw e;
  }
}

describe('WorkflowTemplateService — who works a stage (ACC-271 PR 3)', () => {
  describe('the old people fields on a converted stage', () => {
    it('re-sending every old field unchanged is accepted (an old screen saving a name)', async () => {
      const { prisma, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue(STAGE);
      prisma.workflowStage.update.mockResolvedValue({ ...STAGE, nameEn: 'Forming' });
      const dto = {
        nameEn: 'Forming',
        assigneeStrategy: 'ROLE',
        assigneeRoleId: 'role-qm',
        approvalMode: 'SINGLE',
        parallelThreshold: null,
        committeeId: '',
        assigneeUserId: null,
      };
      await expect(service.updateStage('stage-1', dto as never, ORG, ACTOR)).resolves.toEqual(expect.objectContaining({ nameEn: 'Forming' }));
    });

    it.each([
      ['assigneeStrategy', 'POSITION_FIXED'],
      ['assigneeRoleId', 'role-other'],
      ['approvalMode', 'PARALLEL'],
      ['parallelThreshold', 'ALL'],
      ['assigneeUserId', 'user-x'],
      ['committeeId', 'committee-x'],
      ['assigneeCommitteeRoleValueId', 'role-value-x'],
      ['assigneePositionId', 'position-x'],
      ['assigneeOrgUnitId', 'unit-x'],
    ])('a CHANGED %s is refused (400 WHO_MOVED_TO_STAGE, in both languages), writing nothing', async (field, value) => {
      const { prisma, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue(STAGE);
      const body = await refusal(service.updateStage('stage-1', { [field]: value } as never, ORG, ACTOR));
      expect(body).toEqual(
        expect.objectContaining({
          status: 400,
          code: 'WHO_MOVED_TO_STAGE',
          field,
          message: 'Who works this stage is now set on the stage, not here.',
          messageAr: 'يُحدَّد من يعمل على هذه المرحلة الآن في المرحلة نفسها، لا هنا.',
        }),
      );
      expect(prisma.workflowStage.update).not.toHaveBeenCalled();
    });

    it('on a stage still on the old columns, a changed old field is saved as before', async () => {
      const { prisma, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue({ ...STAGE, whoMode: null });
      prisma.workflowStage.update.mockResolvedValue({ ...STAGE, whoMode: null, approvalMode: 'PARALLEL' });
      await service.updateStage('stage-1', { approvalMode: 'PARALLEL' } as never, ORG, ACTOR);
      expect(prisma.workflowStage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalMode: 'PARALLEL' }) }));
    });

    it('a save that converts an old stage refuses changed old fields with it', async () => {
      const { prisma, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue({ ...STAGE, whoMode: null });
      const body = await refusal(
        service.updateStage('stage-1', { approvalMode: 'PARALLEL', who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } } as never, ORG, ACTOR),
      );
      expect(body?.code).toBe('WHO_MOVED_TO_STAGE');
    });
  });

  describe('the old people fields on a transition from a converted stage', () => {
    const TRANSITION = {
      id: 't-1',
      fromStageId: 'stage-1',
      toStageId: 'stage-2',
      labelEn: 'Submit',
      labelAr: null,
      requiredPermission: 'committees:manage',
      triggerCondition: 'ROLE_BASED',
      triggerUserId: null,
      triggerRoleId: 'role-qm',
      validatorConfig: null,
      isApprovalPath: false,
      kind: 'ADVANCE',
      mover: 'PERSON',
      fromStage: { whoMode: 'ANY_ONE', workflowTemplate: { objectType: 'COMMITTEE' } },
    };

    it('re-sending them unchanged is accepted', async () => {
      const { prisma, service } = build();
      prisma.workflowTransition.findFirst.mockResolvedValue(TRANSITION);
      prisma.workflowTransition.update.mockResolvedValue({ ...TRANSITION, labelEn: 'Send' });
      const dto = { labelEn: 'Send', requiredPermission: 'committees:manage', triggerCondition: 'ROLE_BASED', triggerRoleId: 'role-qm', triggerUserId: null };
      await expect(service.updateTransition('t-1', dto as never, ORG, ACTOR)).resolves.toBeDefined();
    });

    it.each([
      ['triggerCondition', 'ANY_AUTHENTICATED'],
      ['triggerRoleId', 'role-other'],
      ['triggerUserId', 'user-x'],
      ['requiredPermission', 'committees:approve'],
      ['requiredPermission', null],
    ])('a CHANGED %s (%s) is refused, writing nothing', async (field, value) => {
      const { prisma, service } = build();
      prisma.workflowTransition.findFirst.mockResolvedValue(TRANSITION);
      const body = await refusal(service.updateTransition('t-1', { [field]: value } as never, ORG, ACTOR));
      expect(body).toEqual(expect.objectContaining({ status: 400, code: 'WHO_MOVED_TO_STAGE', field }));
      expect(prisma.workflowTransition.update).not.toHaveBeenCalled();
    });

    it('from a stage still on the old columns, a changed one is saved as before', async () => {
      const { prisma, service } = build();
      prisma.workflowTransition.findFirst.mockResolvedValue({ ...TRANSITION, fromStage: { whoMode: null, workflowTemplate: { objectType: 'COMMITTEE' } } });
      prisma.workflowTransition.update.mockResolvedValue(TRANSITION);
      await expect(service.updateTransition('t-1', { triggerRoleId: 'role-other' } as never, ORG, ACTOR)).resolves.toBeDefined();
    });

    describe('a new move from a converted stage', () => {
      const from = { ...STAGE, whoMode: 'ANY_ONE' };
      const add = (service: WorkflowTemplateService, extra: Record<string, unknown>) =>
        service.addTransition({ fromStageId: 'stage-1', toStageId: 'stage-2', labelEn: 'Go', triggerCondition: 'ROLE_BASED', ...extra } as never, ORG, ACTOR);

      it('is written as a person-pressed move, naming no one', async () => {
        const { prisma, service } = build();
        prisma.workflowStage.findFirst.mockResolvedValueOnce(from).mockResolvedValueOnce({ ...STAGE, id: 'stage-2' });
        prisma.workflowTransition.create.mockResolvedValue({ ...TRANSITION, requiredPermission: null, triggerRoleId: null });
        await add(service, {});
        expect(prisma.workflowTransition.create).toHaveBeenCalledWith({ data: expect.objectContaining({ mover: 'PERSON' }) });
      });

      it.each([
        ['triggerRoleId', { triggerRoleId: 'role-qm' }],
        ['triggerUserId', { triggerUserId: 'user-1' }],
        ['requiredPermission', { requiredPermission: 'committees:manage' }],
        ['triggerCondition', { triggerCondition: 'SYSTEM_AUTOMATIC' }],
      ])('is refused when it names %s', async (field, extra) => {
        const { prisma, service } = build();
        prisma.workflowStage.findFirst.mockResolvedValueOnce(from).mockResolvedValueOnce({ ...STAGE, id: 'stage-2' });
        expect(await refusal(add(service, extra))).toEqual(expect.objectContaining({ code: 'WHO_MOVED_TO_STAGE', field }));
        expect(prisma.workflowTransition.create).not.toHaveBeenCalled();
      });
    });
  });

  describe('saving who', () => {
    it('replaces the entries and sets the mode in the stage transaction, writing a field-by-field audit', async () => {
      const { prisma, audit, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue(STAGE);
      prisma.workflowStage.update.mockResolvedValue({ ...STAGE, whoMode: 'ALL' });
      prisma.workflowStageAssignee.findMany
        .mockResolvedValueOnce([STARTING]) // stored, before the save
        .mockResolvedValueOnce([STARTING]) // inside the transaction
        .mockResolvedValueOnce([{ ...STARTING, id: 'e2', kind: 'CREATOR', userId: null, isStartingAssignment: false }]); // after
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1', name: 'Hessa', status: 'ACTIVE' }]);

      const saved = await service.updateStage('stage-1', { who: { mode: 'ALL', entries: [{ kind: 'CREATOR' }] } } as never, ORG, ACTOR);

      expect(prisma.workflowStage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ whoMode: 'ALL' }) }));
      expect(prisma.workflowStageAssignee.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['entry-start'] }, organizationId: ORG, stageId: 'stage-1' } });
      expect(prisma.workflowStageAssignee.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ organizationId: ORG, stageId: 'stage-1', order: 1, kind: 'CREATOR', isStartingAssignment: false, createdById: ACTOR })],
      });
      // Only who changed, so only who is audited: the mode, and each entry as a numbered phrase.
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          objectType: 'WorkflowStage',
          before: { whoMode: 'ANY_ONE', whoEntries: ['1. Hessa (starting assignment)'] },
          after: { whoMode: 'ALL', whoEntries: ['1. whoever created the record'] },
        }),
      );
      expect(saved.whoSentence).toEqual({ en: 'All of: whoever created the record.', ar: 'كلٌّ من: من أنشأ السجل.' });
    });

    it('an unchanged who writes nothing and audits nothing', async () => {
      const { prisma, audit, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue(STAGE);
      prisma.workflowStage.update.mockResolvedValue(STAGE);
      prisma.workflowStageAssignee.findMany.mockResolvedValue([STARTING]);
      await service.updateStage('stage-1', { who: { mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: 'admin-1' }] } } as never, ORG, ACTOR);
      expect(prisma.workflowStageAssignee.deleteMany).not.toHaveBeenCalled();
      expect(prisma.workflowStageAssignee.createMany).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('keeps the starting flag on an entry that survives in place, and clears it when it is replaced', async () => {
      const { prisma, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue(STAGE);
      prisma.workflowStage.update.mockResolvedValue(STAGE);
      prisma.workflowStageAssignee.findMany.mockResolvedValue([STARTING]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1', name: 'Hessa', status: 'ACTIVE' }]);
      await service.updateStage(
        'stage-1',
        { who: { mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: 'admin-1' }, { kind: 'CREATOR' }] } } as never,
        ORG,
        ACTOR,
      );
      // The starting entry stays put (no delete), the new one starts unflagged.
      expect(prisma.workflowStageAssignee.deleteMany).not.toHaveBeenCalled();
      expect(prisma.workflowStageAssignee.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ kind: 'CREATOR', order: 2, isStartingAssignment: false })],
      });
    });

    it('refuses a deactivated person (400 WHO_USER_NOT_ACTIVE)', async () => {
      const { prisma, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue(STAGE);
      prisma.user.findMany.mockResolvedValue([{ id: 'gone', name: 'Gone', status: 'INACTIVE' }]);
      const body = await refusal(service.updateStage('stage-1', { who: { mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: 'gone' }] } } as never, ORG, ACTOR));
      expect(body).toEqual(expect.objectContaining({ status: 400, code: 'WHO_USER_NOT_ACTIVE', index: 0 }));
    });

    itEnforcesTenantIsolation('stage who references (user, position, unit, committee, role)', async () => {
      const { prisma, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue(STAGE);
      const who = {
        mode: 'ANY_ONE',
        entries: [
          { kind: 'SPECIFIC_USER', userId: 'u-b' },
          { kind: 'POSITION_IN_UNIT', positionId: 'p-b', orgUnitId: 'o-b' },
          { kind: 'COMMITTEE', committeeId: 'c-b', committeeRoleValueId: 'r-b' },
        ],
      };
      // Every read is scoped by this organisation, so another's ids come back absent…
      const body = await refusal(service.updateStage('stage-1', { who } as never, ORG, ACTOR));
      expect(body).toEqual(expect.objectContaining({ status: 404, code: 'WHO_REFERENCE_NOT_FOUND', index: 0, field: 'userId' }));
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['u-b'] }, organizationId: ORG } }));
      expect(prisma.orgPosition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['p-b'] }, organizationId: ORG } }));
      expect(prisma.orgUnit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['o-b'] }, organizationId: ORG } }));
      expect(prisma.committee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['c-b'] }, organizationId: ORG } }));
      expect(prisma.lookupValue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { in: ['r-b'] }, OR: [{ organizationId: null }, { organizationId: ORG }] }) }),
      );
      // …and nothing is written.
      expect(prisma.workflowStage.update).not.toHaveBeenCalled();
    });

    it('a protected template refuses a changed who, and passes the stored one re-sent', async () => {
      const { prisma, service } = build();
      const protectedStage = { ...STAGE, workflowTemplate: { objectType: 'COMMITTEE_CHANGE_REQUEST' } };
      prisma.workflowStage.findFirst.mockResolvedValue(protectedStage);
      prisma.workflowStage.update.mockResolvedValue(protectedStage);
      prisma.workflowStageAssignee.findMany.mockResolvedValue([STARTING]);
      const changed = await refusal(service.updateStage('stage-1', { who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } } as never, ORG, ACTOR));
      expect(changed).toEqual(expect.objectContaining({ code: 'WORKFLOW_TEMPLATE_PROTECTED', edit: 'STAGE_FIELD' }));
      await expect(
        service.updateStage('stage-1', { who: { mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: 'admin-1' }] } } as never, ORG, ACTOR),
      ).resolves.toBeDefined();
    });
  });

  describe('the template read', () => {
    it('serves who with names, the sentence, the kinds, the mover and app moves, reading names once per kind', async () => {
      const { prisma, service } = build();
      prisma.workflowTemplate.findFirst.mockResolvedValue({
        id: 'template-1',
        organizationId: ORG,
        nameEn: 'Committee Change Request',
        nameAr: null,
        objectType: 'COMMITTEE_CHANGE_REQUEST',
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const appMove = { id: 'move-app', fromStageId: 's-draft', toStageId: 's-review', labelEn: 'Submit', labelAr: null, requiredPermission: null, triggerCondition: 'SYSTEM_AUTOMATIC', triggerUserId: null, triggerRoleId: null, validatorConfig: null, isApprovalPath: false, kind: 'ADVANCE', mover: 'APP', actions: [] };
      prisma.workflowStage.findMany.mockResolvedValue([
        { ...STAGE, id: 's-draft', key: 'draft', whoMode: 'ANY_ONE', transitionsFrom: [appMove], assignees: [{ ...STARTING, stageId: 's-draft' }] },
        { ...STAGE, id: 's-review', key: 'under_review', whoMode: null, transitionsFrom: [], assignees: [] },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1', name: 'Hessa', status: 'ACTIVE' }]);

      const t = await service.getTemplateById('template-1', ORG);

      expect(t.assigneeKinds).toEqual(['SPECIFIC_USER', 'POSITION_IN_UNIT', 'ORG_UNIT_HEAD', 'CREATOR', 'COMMITTEE']);
      const [draft, review] = t.stages!;
      expect(draft!.who).toEqual({
        mode: 'ANY_ONE',
        entries: [expect.objectContaining({ kind: 'SPECIFIC_USER', userId: 'admin-1', user: { id: 'admin-1', name: 'Hessa' }, isStartingAssignment: true })],
      });
      expect(draft!.whoSentence).toEqual({ en: 'Hessa.', ar: 'Hessa.' });
      expect(review!.who).toBeNull();
      expect(draft!.transitions![0]).toEqual(
        expect.objectContaining({ mover: 'APP', appMove: expect.objectContaining({ key: 'committee_change_request.submit' }) }),
      );
      // One read per kind for the whole template, scoped by the organisation.
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['admin-1'] }, organizationId: ORG } }));
      expect(prisma.orgPosition.findMany).not.toHaveBeenCalled();
    });
  });

  describe('Keep this assignment', () => {
    it('clears the starting flag on the stage and audits it once, with no reason', async () => {
      const { prisma, audit, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue({ id: 'stage-1' });
      prisma.workflowStageAssignee.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.keepStartingAssignment('stage-1', ORG, ACTOR)).resolves.toEqual({ kept: true });
      expect(prisma.workflowStageAssignee.updateMany).toHaveBeenCalledWith({
        where: { stageId: 'stage-1', organizationId: ORG, isStartingAssignment: true },
        data: { isStartingAssignment: false },
      });
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ objectType: 'WorkflowStage', objectId: 'stage-1', before: { startingAssignment: true }, after: { startingAssignment: false } }),
      );
    });

    it('a stage with no starting entry changes nothing and audits nothing', async () => {
      const { prisma, audit, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue({ id: 'stage-1' });
      await expect(service.keepStartingAssignment('stage-1', ORG, ACTOR)).resolves.toEqual({ kept: false });
      expect(audit.log).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('keepStartingAssignment', async () => {
      const { prisma, service } = build();
      prisma.workflowStage.findFirst.mockResolvedValue(null);
      await expect(service.keepStartingAssignment('stage-of-b', ORG, ACTOR)).rejects.toThrow(NotFoundException);
      expect(prisma.workflowStage.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'stage-of-b', workflowTemplate: { organizationId: ORG } } }));
      expect(prisma.workflowStageAssignee.updateMany).not.toHaveBeenCalled();
    });
  });
});
