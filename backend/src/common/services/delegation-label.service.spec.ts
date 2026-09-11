import { Test, TestingModule } from '@nestjs/testing';
import { DelegationLabelService } from './delegation-label.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../testing/tenant-isolation';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
const UNIT_ID = 'unit-cardiology';
const COVERED_USER_ID = 'user-ahmad';

const mockPrisma = {
  orgUnit: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
};

describe('DelegationLabelService (ACC-76)', () => {
  let service: DelegationLabelService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DelegationLabelService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DelegationLabelService>(DelegationLabelService);
  });

  describe('resolveMany', () => {
    it('resolves an ACTING_HEAD stamp to its org unit name, both languages', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([
        { id: UNIT_ID, nameEn: 'Cardiology', nameAr: 'القلب' },
      ]);

      const stamp = { delegationReason: 'ACTING_HEAD', delegationContextId: UNIT_ID };
      const resolved = await service.resolveMany([stamp], ORG_A);

      expect(service.lookup(stamp, resolved)).toEqual({
        reason: 'ACTING_HEAD',
        contextId: UNIT_ID,
        contextLabelEn: 'Cardiology',
        contextLabelAr: 'القلب',
      });
    });

    // OrgUnit.nameAr is nullable in the schema. Losing the qualifier entirely
    // for an Arabic reader is worse than showing the English unit name.
    it('falls back to the English unit name when nameAr is null', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([
        { id: UNIT_ID, nameEn: 'Cardiology', nameAr: null },
      ]);

      const stamp = { delegationReason: 'ACTING_HEAD', delegationContextId: UNIT_ID };
      const resolved = await service.resolveMany([stamp], ORG_A);

      expect(service.lookup(stamp, resolved)?.contextLabelAr).toBe('Cardiology');
    });

    it('resolves an OUT_OF_OFFICE_COVERAGE stamp to the covered-for user name', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: COVERED_USER_ID, name: 'Ahmad' }]);

      const stamp = {
        delegationReason: 'OUT_OF_OFFICE_COVERAGE',
        delegationContextId: COVERED_USER_ID,
      };
      const resolved = await service.resolveMany([stamp], ORG_A);

      expect(service.lookup(stamp, resolved)).toEqual({
        reason: 'OUT_OF_OFFICE_COVERAGE',
        contextId: COVERED_USER_ID,
        contextLabelEn: 'Ahmad',
        contextLabelAr: 'Ahmad',
      });
    });

    // The batching guarantee, asserted rather than assumed: TWO queries at
    // most no matter how many stamps arrive. A regression to per-row lookups
    // would not fail any other test here — it would just be slow.
    it('issues at most one query per reason regardless of stamp count', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.resolveMany(
        [
          { delegationReason: 'ACTING_HEAD', delegationContextId: 'unit-1' },
          { delegationReason: 'ACTING_HEAD', delegationContextId: 'unit-2' },
          { delegationReason: 'ACTING_HEAD', delegationContextId: 'unit-1' },
          { delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: 'user-1' },
          { delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: 'user-2' },
        ],
        ORG_A,
      );

      expect(mockPrisma.orgUnit.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
      // De-duplicated, not just batched.
      expect(mockPrisma.orgUnit.findMany.mock.calls[0]![0].where.id.in).toEqual([
        'unit-1',
        'unit-2',
      ]);
    });

    it('touches the database at all only when a stamp is present', async () => {
      await service.resolveMany(
        [{ delegationReason: null, delegationContextId: null }],
        ORG_A,
      );

      expect(mockPrisma.orgUnit.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('lookup', () => {
    it('returns null for an unstamped row', () => {
      expect(
        service.lookup({ delegationReason: null, delegationContextId: null }, new Map()),
      ).toBeNull();
    });

    // The deleted-referent case. Rendering a raw cuid beside someone's name
    // would be worse than rendering no qualifier at all.
    it('returns null when the stamp did not resolve within the tenant', () => {
      expect(
        service.lookup(
          { delegationReason: 'ACTING_HEAD', delegationContextId: 'gone' },
          new Map(),
        ),
      ).toBeNull();
    });
  });

  // A delegationContextId is an opaque id carrying no tenant of its own. If
  // either lookup were unscoped, a stamp pointing at another tenant's OrgUnit
  // or User would resolve that tenant's NAME into this tenant's UI.
  itEnforcesTenantIsolation('DelegationLabelService.resolveMany', async () => {
    mockPrisma.orgUnit.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        where.organizationId === ORG_A
          ? [{ id: UNIT_ID, nameEn: 'Cardiology', nameAr: null }]
          : [],
      ),
    );
    mockPrisma.user.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        where.organizationId === ORG_A ? [{ id: COVERED_USER_ID, name: 'Ahmad' }] : [],
      ),
    );

    const stamps = [
      { delegationReason: 'ACTING_HEAD', delegationContextId: UNIT_ID },
      { delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: COVERED_USER_ID },
    ];

    const resolved = await service.resolveMany(stamps, ORG_B);

    expect(resolved.size).toBe(0);
    expect(service.lookup(stamps[0]!, resolved)).toBeNull();
    expect(service.lookup(stamps[1]!, resolved)).toBeNull();
  });
});
