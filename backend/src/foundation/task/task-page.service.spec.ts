import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { TaskPageService, historyKind } from './task-page.service';
import { TaskService } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const ORG = 'org-a';
const ASSIGNEE = 'user-assignee';
const STRANGER = 'user-stranger';

const person = (id: string, name: string) => ({
  id,
  name,
  position: { nameEn: 'Secretary', nameAr: 'أمين السر' },
  primaryOrgUnit: { nameEn: 'Quality', nameAr: 'الجودة' },
});

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    organizationId: ORG,
    title: 'Renew the terms of reference signatures',
    status: 'PENDING',
    priority: 'MEDIUM',
    sourceType: 'COMMITTEE',
    sourceId: 'committee-1',
    sourceStageId: null,
    workflowInstanceId: null,
    workflowInstanceStageId: null,
    isMandatory: false,
    requiresEvidence: true,
    createdById: 'creator-1',
    completedById: null,
    assignedOrgUnitId: null,
    assignedPositionId: null,
    assignedCommitteeId: null,
    assignedCommitteeRoleValueId: null,
    assignedOrgUnit: null,
    assignedPosition: null,
    assignedCommittee: null,
    assignedCommitteeRoleValue: null,
    assignees: [{ userId: ASSIGNEE, removedAt: null, pickedAt: null, delegationReason: null, delegationContextId: null, user: person(ASSIGNEE, 'Omar Haddad') }],
    _count: { evidence: 0 },
    requests: [],
    createdBy: { status: 'ACTIVE', ...person('creator-1', 'Nora Al-Otaibi') },
    rejectedBy: null,
    cancelledBy: null,
    reopenedBy: null,
    workflowInstanceStage: null,
    ...overrides,
  };
}

const POOL = {
  assignedCommitteeId: 'committee-1',
  assignedCommitteeRoleValueId: 'role-member',
  assignedCommittee: { nameEn: 'Infection Control', nameAr: null },
  assignedCommitteeRoleValue: { labelEn: 'Member', labelAr: 'عضو', labelOverrideEn: null, labelOverrideAr: null },
  assignees: [],
};

const OPEN_REQUEST = [
  {
    id: 'req-1',
    type: 'EXTENSION',
    requestedDueAt: new Date('2026-10-20T14:00:00Z'),
    holdUntil: null,
    requestedById: ASSIGNEE,
    reason: 'Needs a second ward',
    createdAt: new Date('2026-10-14T08:00:00Z'),
    requestedBy: { name: 'Omar Haddad' },
  },
];

describe('TaskPageService — the task page (ACC-228)', () => {
  const prisma = {
    task: { findFirst: jest.fn() },
    user: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    committee: { findFirst: jest.fn().mockResolvedValue({ nameEn: 'Infection Control', nameAr: 'لجنة مكافحة العدوى' }) },
    meeting: { findFirst: jest.fn() },
    committeeMember: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    workflowInstanceStage: { findFirst: jest.fn() },
    workflowInstance: { findFirst: jest.fn() },
    taskRequest: { findMany: jest.fn().mockResolvedValue([]) },
    taskEvidence: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  // The record rule as ObjectVisibilityService applies it: committees:view.
  const visibility = {
    assertCanView: jest.fn(async (_type: string, _id: string, _org: string, perms: readonly string[]) => {
      if (!perms.includes('committees:view')) throw new ForbiddenException('Required permission: committees:view');
    }),
  };
  const delegations = { resolveMany: jest.fn().mockResolvedValue(new Map()), lookup: jest.fn().mockReturnValue(null) };
  const tasks = { mayManage: jest.fn().mockResolvedValue(false) };
  const authority = { canActForCreator: jest.fn().mockResolvedValue(false) };

  const service = new TaskPageService(
    prisma as unknown as PrismaService,
    visibility as unknown as ObjectVisibilityService,
    delegations as unknown as DelegationLabelService,
    tasks as unknown as TaskService,
    authority as unknown as TaskAuthorityService,
  );
  const viewer = (id: string, permissions: string[] = []) => ({ id, permissions });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma.task.findFirst.mockResolvedValue(taskRow());
    tasks.mayManage.mockResolvedValue(false);
    authority.canActForCreator.mockResolvedValue(false);
    prisma.committeeMember.count.mockResolvedValue(0);
  });

  /** The exception a call ends in; a call that succeeds fails the test. */
  async function refusalOf(call: Promise<unknown>): Promise<NotFoundException> {
    try {
      await call;
    } catch (e) {
      return e as NotFoundException;
    }
    throw new Error('expected the call to be refused');
  }

  /** The 404 a request for an id that does not exist gets — the body every refusal must match. */
  async function missingTaskError(): Promise<NotFoundException> {
    prisma.task.findFirst.mockResolvedValueOnce(null);
    return refusalOf(service.view('no-such-task', ORG, viewer(STRANGER)));
  }

  describe('who may open a task (Q4): each grant alone', () => {
    it('(a) an assignee WITHOUT tasks:view opens their own task', async () => {
      const page = await service.view('task-1', ORG, viewer(ASSIGNEE, []));
      expect(page.task.id).toBe('task-1');
      expect(page.actions.start).toBe(true);
      expect(page.actions.primary).toBe('START');
    });

    it('(a) someone who USED to be on it still opens it (any assignee row)', async () => {
      prisma.task.findFirst.mockResolvedValue(
        taskRow({ assignees: [{ userId: ASSIGNEE, removedAt: new Date(), pickedAt: null, user: person(ASSIGNEE, 'Omar') }] }),
      );
      const page = await service.view('task-1', ORG, viewer(ASSIGNEE));
      expect(page.assignees).toEqual([]);
      expect(page.actions.start).toBe(false);
    });

    it('(b) whoever may manage it opens it', async () => {
      tasks.mayManage.mockResolvedValue(true);
      const page = await service.view('task-1', ORG, viewer('creator-1'));
      expect(page.task.canManage).toBe(true);
      expect(page.actions.edit).toBe(true);
      expect(page.actions.cancel).toBe(true);
    });

    it('(c) a member of its pool opens it while it waits to be picked up', async () => {
      prisma.task.findFirst.mockResolvedValue(taskRow(POOL));
      prisma.committeeMember.count.mockResolvedValue(1);
      prisma.committeeMember.findMany.mockResolvedValue([{ userId: STRANGER }, { userId: 'user-3' }]);
      const page = await service.view('task-1', ORG, viewer(STRANGER));
      expect(page.actions.pickUp).toBe(true);
      expect(page.actions.primary).toBe('PICK_UP');
      expect(page.poolMemberCount).toBe(2);
    });

    it('(c) …but not once someone has picked it up', async () => {
      prisma.task.findFirst.mockResolvedValue(
        taskRow({ ...POOL, assignees: [{ userId: 'user-3', removedAt: null, pickedAt: new Date(), user: person('user-3', 'Tariq') }] }),
      );
      prisma.committeeMember.count.mockResolvedValue(1);
      await expect(service.view('task-1', ORG, viewer(STRANGER))).rejects.toThrow(NotFoundException);
    });

    it('(d) whoever may decide its open request opens it (tasks:reassign)', async () => {
      prisma.task.findFirst.mockResolvedValue(taskRow({ requests: OPEN_REQUEST }));
      const page = await service.view('task-1', ORG, viewer(STRANGER, ['tasks:reassign']));
      expect(page.actions.reviewRequest).toBe(true);
      expect(page.actions.primary).toBe('REVIEW_REQUEST');
    });

    it('(d) …or by acting for the creator', async () => {
      prisma.task.findFirst.mockResolvedValue(taskRow({ requests: OPEN_REQUEST }));
      authority.canActForCreator.mockResolvedValue(true);
      const page = await service.view('task-1', ORG, viewer(STRANGER));
      expect(page.actions.reviewRequest).toBe(true);
    });

    it('(e) tasks:view AND the record opens it', async () => {
      const page = await service.view('task-1', ORG, viewer(STRANGER, ['tasks:view', 'committees:view']));
      expect(page.record).toEqual({
        type: 'COMMITTEE',
        id: 'committee-1',
        canOpen: true,
        nameEn: 'Infection Control',
        nameAr: 'لجنة مكافحة العدوى',
      });
      expect(page.actions.primary).toBeNull();
      expect(page.actions.start).toBe(false);
    });
  });

  describe('everyone else gets the identical 404 (ACC-101 clause b)', () => {
    it.each([
      ['no permission at all', []],
      ['tasks:view without the record', ['tasks:view']],
      ['the record without tasks:view', ['committees:view']],
      ['tasks:reassign with no request to decide', ['tasks:reassign']],
    ])('%s: the same status and body as a task that does not exist', async (_label, permissions) => {
      const missing = await missingTaskError();
      const refused = await refusalOf(service.view('task-1', ORG, viewer(STRANGER, permissions)));

      expect(refused).toBeInstanceOf(NotFoundException);
      expect(refused.getStatus()).toBe(missing.getStatus());
      expect(refused.getResponse()).toEqual(missing.getResponse());
    });

    it('a pool member of a pool the task is NOT in is refused', async () => {
      prisma.task.findFirst.mockResolvedValue(taskRow(POOL));
      prisma.committeeMember.count.mockResolvedValue(0);
      await expect(service.view('task-1', ORG, viewer(STRANGER))).rejects.toThrow('Task not found');
    });

    it('a refusal is logged, never silent', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      await service.view('task-1', ORG, viewer(STRANGER)).catch(() => undefined);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`viewer ${STRANGER}`));
    });

    it('history refuses the same people, with the same 404', async () => {
      await expect(service.history('task-1', ORG, viewer(STRANGER, ['tasks:view']))).rejects.toThrow('Task not found');
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });
  });

  describe('what the page shows', () => {
    it('hides the record name from a viewer who may not open the record', async () => {
      const page = await service.view('task-1', ORG, viewer(ASSIGNEE));
      expect(page.record).toEqual({ type: 'COMMITTEE', id: 'committee-1', canOpen: false, nameEn: null, nameAr: null });
      expect(prisma.committee.findFirst).not.toHaveBeenCalled();
    });

    it('carries the open request, the evidence count, and names — not the raw rows', async () => {
      prisma.task.findFirst.mockResolvedValue(taskRow({ status: 'IN_PROGRESS', requests: OPEN_REQUEST, _count: { evidence: 0 } }));
      const page = await service.view('task-1', ORG, viewer(ASSIGNEE));
      expect(page.task.openRequest).toEqual(expect.objectContaining({ id: 'req-1', requestedByName: 'Omar Haddad' }));
      expect(page.task.evidenceCount).toBe(0);
      expect(page.assignees).toEqual([expect.objectContaining({ id: ASSIGNEE, name: 'Omar Haddad', positionNameEn: 'Secretary' })]);
      expect(page.createdBy).toEqual(expect.objectContaining({ id: 'creator-1', name: 'Nora Al-Otaibi' }));
      expect(page.createdBy).not.toHaveProperty('status');
      expect(page.actions.complete).toBe(true);
      expect(page.actions.completeNeedsEvidence).toBe(true);
      expect(page.actions.withdrawRequest).toBe(true);
      expect(page.actions.requestMoreTime).toBe(false); // one request at a time
    });

    it('a stage task says the workflow made it, and names the stage', async () => {
      prisma.task.findFirst.mockResolvedValue(
        taskRow({ workflowInstanceStageId: 'entry-1', isMandatory: true, workflowInstanceStage: { stage: { nameEn: 'Terms Review', nameAr: null } } }),
      );
      tasks.mayManage.mockResolvedValue(true);
      const page = await service.view('task-1', ORG, viewer('creator-1'));
      expect(page.createdByWorkflow).toBe(true);
      expect(page.stage).toEqual({ nameEn: 'Terms Review', nameAr: null });
      expect(page.actions.cancel).toBe(false); // a required stage task is never cancelled by hand
    });
  });

  describe('tenant isolation', () => {
    itEnforcesTenantIsolation('task page view reads the task in the caller\'s organisation only', async () => {
      prisma.task.findFirst.mockResolvedValue(null); // the task is org-a's; the caller is in org-b
      await expect(service.view('task-1', 'org-b', viewer(ASSIGNEE))).rejects.toThrow('Task not found');
      expect(prisma.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'task-1', organizationId: 'org-b' } }));
      expect(tasks.mayManage).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('task history reads audit rows in the caller\'s organisation only', async () => {
      prisma.taskRequest.findMany.mockResolvedValue([{ id: 'req-1', type: 'EXTENSION' }]);
      await service.history('task-1', ORG, viewer(ASSIGNEE));
      expect(prisma.taskRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { taskId: 'task-1', organizationId: ORG } }));
      expect(prisma.taskEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { taskId: 'task-1', organizationId: ORG } }));
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }));

      prisma.task.findFirst.mockResolvedValue(null);
      jest.clearAllMocks();
      await expect(service.history('task-1', 'org-b', viewer(ASSIGNEE))).rejects.toThrow('Task not found');
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });
  });

  describe('history', () => {
    it('reads the task, its requests and its evidence, oldest first, worded by kind', async () => {
      prisma.taskRequest.findMany.mockResolvedValue([{ id: 'req-1', type: 'ON_HOLD' }]);
      prisma.taskEvidence.findMany.mockResolvedValue([{ id: 'ev-1', type: 'LINK' }]);
      prisma.auditLog.findMany.mockResolvedValue([
        { objectType: 'Task', objectId: 'task-1', action: 'CREATE', metadata: null, after: null, createdAt: new Date('2026-10-01'), actor: { name: 'Nora' } },
        { objectType: 'TaskRequest', objectId: 'req-1', action: 'CREATE', metadata: { event: 'request_made' }, after: { reason: 'Lead on leave' }, createdAt: new Date('2026-10-05'), actor: { name: 'Omar' } },
        { objectType: 'TaskEvidence', objectId: 'ev-1', action: 'CREATE', metadata: null, after: { taskId: 'task-1' }, createdAt: new Date('2026-10-06'), actor: { name: 'Omar' } },
        { objectType: 'Task', objectId: 'task-1', action: 'UPDATE', metadata: { reason: 'STAGE_EXIT' }, after: null, createdAt: new Date('2026-10-07'), actor: null },
      ]);
      const events = await service.history('task-1', ORG, viewer(ASSIGNEE));

      expect(events.map((e) => e.kind)).toEqual(['created', 'request_made', 'evidence_added', 'cancelled_by_workflow']);
      expect(events[1]).toEqual(expect.objectContaining({ reason: 'Lead on leave', requestType: 'ON_HOLD' }));
      expect(events[2]).toEqual(expect.objectContaining({ evidenceType: 'LINK' }));
      // The engine's code is not a reason anyone typed.
      expect(events[3]).toEqual(expect.objectContaining({ reason: null, actorName: null }));
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
    });
  });

  describe('historyKind', () => {
    it.each([
      ['Task', 'UPDATE', { event: 'started' }, 'started'],
      ['Task', 'UPDATE', { completedBy: 'u' }, 'completed'],
      ['Task', 'REJECT', { reason: 'not mine' }, 'rejected'],
      ['Task', 'DELEGATE', { reason: 'r' }, 'reassigned'],
      ['Task', 'DELEGATE', { event: 'departure_returned_to_pool' }, 'returned_to_pool'],
      ['Task', 'UPDATE', { reason: 'INSTANCE_CANCELLED' }, 'cancelled_by_workflow'],
      ['Task', 'UPDATE', { escalatedTo: ['u'], tier: 'MANAGER' }, 'escalated'],
      ['TaskRequest', 'UPDATE', { event: 'request_declined', note: 'n' }, 'request_declined'],
      ['TaskEvidence', 'DELETE', { recoverable: true }, 'evidence_removed'],
      ['Task', 'UPDATE', { event: 'something_new' }, 'changed'],
    ])('%s %s %j → %s', (objectType, action, meta, kind) => {
      expect(historyKind(objectType, action, meta)).toBe(kind);
    });
  });
});
