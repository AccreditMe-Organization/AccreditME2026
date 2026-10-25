import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { NotificationService } from '../../notification/notification.service';
import { TaskService } from '../../task/task.service';
import { WorkflowService } from '../../workflow/workflow.service';
import { CommitteeChangeRequestService, normaliseChanges } from './committee-change-request.service';
import { StageRulesService } from '../../workflow/stage-rules.service';
import { ChangeRequestRefusal } from './change-request-refusal';

// ACC-239 — the unit half. The behaviour (locks, drift, the move, the task) is
// proved against a real database in committee-change-request.db-spec.ts; this
// file pins the organisation scoping of every read, which CI's
// tenant-isolation gate selects by name, and the pure normalisation rule.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const viewer = { userId: 'user-1', permissions: ['committees:view', 'committees:edit_details', 'committees:approve'] };

function setup() {
  const prisma = {
    committee: { findFirst: jest.fn().mockResolvedValue(null) },
    committeeChangeRequest: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    workflowInstance: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    workflowStage: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const service = new CommitteeChangeRequestService(
    prisma as unknown as PrismaService,
    {} as WorkflowService,
    {} as TaskService,
    { log: jest.fn() } as unknown as AuditLogService,
    { create: jest.fn() } as unknown as NotificationService,
    new StageRulesService(prisma as unknown as PrismaService),
  );
  return { prisma, service };
}

describe('CommitteeChangeRequestService — organisation scoping (ACC-239)', () => {
  it('should NOT return records belonging to a different tenant — a request is read by id AND organisation', async () => {
    const { prisma, service } = setup();
    await expect(service.getOne('cr-1', ORG_B, viewer)).rejects.toThrow(NotFoundException);
    expect(prisma.committeeChangeRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cr-1', organizationId: ORG_B } }));
  });

  it("should NOT return records belonging to a different tenant — a committee's list reads the committee by id AND organisation first", async () => {
    const { prisma, service } = setup();
    await expect(service.list('c-1', {}, ORG_B, viewer)).rejects.toThrow('Committee not found');
    expect(prisma.committee.findFirst).toHaveBeenCalledWith({ where: { id: 'c-1', organizationId: ORG_B } });
    expect(prisma.committeeChangeRequest.findMany).not.toHaveBeenCalled();
  });

  it('should NOT return records belonging to a different tenant — the request\'s instance is read within the organisation', async () => {
    const { prisma, service } = setup();
    prisma.committeeChangeRequest.findFirst.mockResolvedValue({ id: 'cr-1', requestedById: 'someone', committee: {}, requestedBy: {} });
    await expect(service.withdraw('cr-1', ORG_A, viewer)).rejects.toThrow('Change request not found');
    expect(prisma.workflowInstance.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG_A, objectType: 'COMMITTEE_CHANGE_REQUEST', objectId: 'cr-1' } }),
    );
  });

  it('should NOT return records belonging to a different tenant — awaiting decision reads only the organisation', async () => {
    const { prisma, service } = setup();
    await service.awaitingDecision(ORG_A, viewer);
    expect(prisma.committeeChangeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A, requestedById: { not: 'user-1' } }) }),
    );
  });
});

describe('CommitteeChangeRequestService — the ACC-240 reads, organisation scoping', () => {
  /** A request in ORG_A naming a type, a unit, two committees and two people. */
  function withRequest() {
    const { prisma, service } = setup();
    const ext = prisma as unknown as Record<string, Record<string, jest.Mock>>;
    ext['user'] = { findMany: jest.fn().mockResolvedValue([]) };
    ext['orgUnit'] = { findMany: jest.fn().mockResolvedValue([]) };
    ext['committee']!['findMany'] = jest.fn().mockResolvedValue([]);
    ext['lookupCategory'] = { findFirst: jest.fn().mockResolvedValue({ id: 'cat' }) };
    ext['lookupValue'] = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.committeeChangeRequest.findFirst.mockResolvedValue({
      id: 'cr-1',
      committeeId: 'c-1',
      requestedById: 'u-req',
      decidedById: 'u-dec',
      withdrawnById: 'u-wd',
      changes: { typeValueId: 't-new', orgUnitId: 'unit-new', parentCommitteeId: 'c-parent' },
      fromValues: { reportingToCommitteeId: 'c-old' },
      committee: { nameEn: 'Council', nameAr: null },
      requestedBy: { id: 'u-req', name: 'Requester' },
    });
    return { prisma: ext, service };
  }

  it("should NOT return records belonging to a different tenant — the decider's and withdrawer's names are read within the organisation", async () => {
    const { prisma, service } = withRequest();
    await service.getOne('cr-1', ORG_A, viewer);
    expect(prisma['user']!['findMany']).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['u-dec', 'u-wd'] }, organizationId: ORG_A } }),
    );
  });

  it('should NOT return records belonging to a different tenant — unit and committee labels are read within the organisation', async () => {
    const { prisma, service } = withRequest();
    await service.getOne('cr-1', ORG_A, viewer);
    expect(prisma['orgUnit']!['findMany']).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['unit-new'] }, organizationId: ORG_A } }),
    );
    expect(prisma['committee']!['findMany']).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['c-parent', 'c-old'] }, organizationId: ORG_A } }),
    );
  });

  it("should NOT return records belonging to a different tenant — type labels are the shared system values and this organisation's own only", async () => {
    const { prisma, service } = withRequest();
    await service.getOne('cr-1', ORG_A, viewer);
    expect(prisma['lookupValue']!['findMany']).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['t-new'] }, OR: [{ organizationId: null }, { organizationId: ORG_A }] }) }),
    );
  });

  it("should NOT return records belonging to a different tenant — the open read checks the committee by id AND organisation before anything else", async () => {
    const { prisma, service } = setup();
    await expect(service.openSummary('c-1', ORG_B, viewer)).rejects.toThrow('Committee not found');
    expect(prisma.committee.findFirst).toHaveBeenCalledWith({ where: { id: 'c-1', organizationId: ORG_B } });
    expect(prisma.committeeChangeRequest.findMany).not.toHaveBeenCalled();
  });
});

describe('normaliseChanges (ACC-239)', () => {
  const committee = {
    id: 'c-1',
    organizationId: ORG_A,
    updatedAt: new Date(),
    nameEn: 'Quality Council',
    nameAr: null,
    typeValueId: 't',
    purpose: 'Oversee',
    quorumCount: 3,
    meetingFrequency: 'MONTHLY',
    orgUnitId: 'u',
    parentCommitteeId: null,
    reportingToCommitteeId: null,
  };
  const code = (fn: () => unknown) => {
    try {
      fn();
      return 'OK';
    } catch (e) {
      return (e as ChangeRequestRefusal).code;
    }
  };

  it('keeps only what changes, trims text, and clears an emptied purpose', () => {
    expect(normaliseChanges({ nameEn: ' Quality Council ', purpose: '', quorumCount: 3, meetingFrequency: 'ANNUAL' } as never, committee)).toEqual({
      purpose: null,
      meetingFrequency: 'ANNUAL',
    });
  });

  it('ignores a required field sent as null, and refuses nothing left', () => {
    expect(code(() => normaliseChanges({ nameEn: null, quorumCount: 3 } as never, committee))).toBe('CHANGE_REQUEST_NO_CHANGES');
  });

  it('refuses a quorum below 1 on an approved committee', () => {
    expect(code(() => normaliseChanges({ quorumCount: 0 } as never, committee))).toBe('CHANGE_REQUEST_QUORUM_MIN');
  });
});
