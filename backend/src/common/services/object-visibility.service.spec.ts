import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../testing/tenant-isolation';
import { ObjectVisibilityService } from './object-visibility.service';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
const COMMITTEE_ID = 'committee-1';

const mockPrisma = {
  committee: { findFirst: jest.fn() },
  meeting: { findFirst: jest.fn() },
};

describe('ObjectVisibilityService (ACC-101)', () => {
  let service: ObjectVisibilityService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.committee.findFirst.mockResolvedValue({ id: COMMITTEE_ID });
    mockPrisma.meeting.findFirst.mockResolvedValue({ id: 'meeting-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [ObjectVisibilityService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(ObjectVisibilityService);
  });

  it("admits a caller holding the parent type's permission", async () => {
    await expect(
      service.assertCanView('COMMITTEE', COMMITTEE_ID, ORG_A, ['committees:view']),
    ).resolves.toBeUndefined();
  });

  it("refuses a caller who does not hold the parent's permission, naming it", async () => {
    await expect(
      service.assertCanView('COMMITTEE', COMMITTEE_ID, ORG_A, ['tasks:view']),
    ).rejects.toThrow(new ForbiddenException('Required permission: committees:view'));
  });

  // The order is the whole point: a refused caller must not be able to tell a
  // real id from an invented one, and must not cost a query either.
  it('refuses before reading, so an unauthorized caller learns nothing about existence', async () => {
    await expect(
      service.assertCanView('COMMITTEE', 'does-not-exist', ORG_A, ['tasks:view']),
    ).rejects.toThrow(ForbiddenException);

    expect(mockPrisma.committee.findFirst).not.toHaveBeenCalled();
  });

  it('reports a missing parent as not found, once the caller is entitled to ask', async () => {
    mockPrisma.committee.findFirst.mockResolvedValue(null);

    await expect(
      service.assertCanView('COMMITTEE', 'does-not-exist', ORG_A, ['committees:view']),
    ).rejects.toThrow(NotFoundException);
  });

  // FAIL CLOSED. TaskSourceType has 11 values and WorkflowObjectType 8; two
  // have tables. Every other value reaches this branch, and the day a module
  // ships, forgetting to add its rule costs a visible 403 rather than a silent
  // disclosure. Mutating this to `return` turns the whole ticket off.
  it('refuses an object type it has no rule for, rather than allowing it', async () => {
    await expect(
      service.assertCanView('DOCUMENT', 'doc-1', ORG_A, ['documents:view', 'tasks:view']),
    ).rejects.toThrow(new ForbiddenException('Visibility rules are not defined for DOCUMENT records'));
  });

  it('knows the two object types that have tables today', async () => {
    await expect(
      service.assertCanView('MEETING', 'meeting-1', ORG_A, ['meetings:view']),
    ).resolves.toBeUndefined();
    expect(mockPrisma.meeting.findFirst).toHaveBeenCalled();
  });

  // The read-first shape. Both refusal causes must collapse to one answer, or
  // the status pair rebuilds the existence oracle the check exists to close.
  describe('assertCanViewOrNotFound', () => {
    const NOT_FOUND = 'Task not found';

    it('reports a caller who lacks the permission as not-found, in the caller own terms', async () => {
      await expect(
        service.assertCanViewOrNotFound('COMMITTEE', COMMITTEE_ID, ORG_A, ['tasks:view'], NOT_FOUND),
      ).rejects.toThrow(new NotFoundException(NOT_FOUND));
    });

    it('reports a missing parent identically, so the two cannot be told apart', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      const lacksPermission = await service
        .assertCanViewOrNotFound('COMMITTEE', COMMITTEE_ID, ORG_A, ['tasks:view'], NOT_FOUND)
        .catch((e: Error) => e);
      const parentMissing = await service
        .assertCanViewOrNotFound('COMMITTEE', COMMITTEE_ID, ORG_A, ['committees:view'], NOT_FOUND)
        .catch((e: Error) => e);

      expect((lacksPermission as NotFoundException).getResponse()).toEqual(
        (parentMissing as NotFoundException).getResponse(),
      );
    });

    it('names neither the parent type nor the permission, which would rebuild the oracle in the body', async () => {
      const error = await service
        .assertCanViewOrNotFound('COMMITTEE', COMMITTEE_ID, ORG_A, ['tasks:view'], NOT_FOUND)
        .catch((e: Error) => e);

      expect(JSON.stringify((error as NotFoundException).getResponse())).not.toContain('COMMITTEE');
      expect(JSON.stringify((error as NotFoundException).getResponse())).not.toContain('committees:view');
    });

    it('lets an unexpected failure surface as itself, rather than reporting it as a missing record', async () => {
      mockPrisma.committee.findFirst.mockRejectedValue(new Error('connection terminated'));

      await expect(
        service.assertCanViewOrNotFound('COMMITTEE', COMMITTEE_ID, ORG_A, ['committees:view'], NOT_FOUND),
      ).rejects.toThrow('connection terminated');
    });

    it('admits an entitled caller, same as the check-first form', async () => {
      await expect(
        service.assertCanViewOrNotFound('COMMITTEE', COMMITTEE_ID, ORG_A, ['committees:view'], NOT_FOUND),
      ).resolves.toBeUndefined();
    });
  });

  itEnforcesTenantIsolation('ObjectVisibilityService.assertCanView', async () => {
    mockPrisma.committee.findFirst.mockImplementation(
      ({ where }: { where: { id: string; organizationId: string } }) =>
        Promise.resolve(
          where.id === COMMITTEE_ID && where.organizationId === ORG_A ? { id: COMMITTEE_ID } : null,
        ),
    );

    // Entitled in their own tenant, and the committee is real there.
    await expect(
      service.assertCanView('COMMITTEE', COMMITTEE_ID, ORG_A, ['committees:view']),
    ).resolves.toBeUndefined();

    // Same permission, same id, different tenant: the record must not be
    // confirmed. Without organizationId in the where-clause this resolves and
    // the caller learns another tenant's committee exists.
    await expect(
      service.assertCanView('COMMITTEE', COMMITTEE_ID, ORG_B, ['committees:view']),
    ).rejects.toThrow(NotFoundException);
  });
});
