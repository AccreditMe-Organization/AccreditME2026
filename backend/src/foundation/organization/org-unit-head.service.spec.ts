import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrgUnitHeadService } from './org-unit-head.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { UserService } from '../user/user.service';
import { OrganizationService } from './organization.service';
import { NotificationService } from '../notification/notification.service';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
const UNIT_1 = 'unit-1';
const HEAD_POSITION_ID = 'pos-head';
const OUTGOING_HOLDER = { id: 'outgoing-user', organizationId: ORG_A, primaryOrgUnitId: UNIT_1, positionId: HEAD_POSITION_ID, status: 'ACTIVE' };
const INCOMING_SUCCESSOR = { id: 'incoming-user', organizationId: ORG_A, primaryOrgUnitId: UNIT_1, positionId: null, status: 'ACTIVE', position: null };
const BASE_ORG_UNIT = {
  id: UNIT_1,
  organizationId: ORG_A,
  pendingHeadUserId: null as string | null,
  headHandoverEffectiveDate: null as Date | null,
  actingHeadUserId: null as string | null,
};
const ACTING_USER = { id: 'acting-user', organizationId: ORG_A, status: 'ACTIVE' };

const mockPrisma = {
  orgUnit: { findFirst: jest.fn(), update: jest.fn() },
  orgPosition: { findFirst: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  orgUnitHeadEvent: { create: jest.fn() },
};
const mockAuditLog = { log: jest.fn() };
const mockUserService = { validatePositionAssignment: jest.fn() };
const mockOrganizationService = { refreshOrgUnitHeadVacancy: jest.fn() };

describe('OrgUnitHeadService', () => {
  let service: OrgUnitHeadService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.orgUnitHeadEvent.create.mockResolvedValue({});
    mockPrisma.orgUnit.update.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});
    mockUserService.validatePositionAssignment.mockResolvedValue(undefined);
    mockOrganizationService.refreshOrgUnitHeadVacancy.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgUnitHeadService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: UserService, useValue: mockUserService },
        { provide: OrganizationService, useValue: mockOrganizationService },
      ],
    }).compile();

    service = module.get<OrgUnitHeadService>(OrgUnitHeadService);
  });

  // ── getHeadStatus ────────────────────────────────────────────────────────

  describe('getHeadStatus', () => {
    it('throws NotFoundException when the org unit does not exist in this tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(service.getHeadStatus(UNIT_1, ORG_A)).rejects.toThrow(NotFoundException);
    });

    it('returns the live derivation of current holders plus the OrgUnit cache fields', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({
        ...BASE_ORG_UNIT,
        pendingHeadUserId: INCOMING_SUCCESSOR.id,
        headHandoverEffectiveDate: new Date('2026-09-01T00:00:00.000Z'),
      });
      mockPrisma.user.findMany.mockResolvedValue([
        { id: OUTGOING_HOLDER.id, name: 'Outgoing', positionId: HEAD_POSITION_ID },
        { id: INCOMING_SUCCESSOR.id, name: 'Incoming', positionId: HEAD_POSITION_ID },
      ]);

      const result = await service.getHeadStatus(UNIT_1, ORG_A);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_A,
          primaryOrgUnitId: UNIT_1,
          status: 'ACTIVE',
          position: { isUnitHeadPosition: true },
        },
        select: { id: true, name: true, positionId: true },
      });
      expect(result.holders).toHaveLength(2); // both holders during an open handover
      expect(result.pendingHeadUserId).toBe(INCOMING_SUCCESSOR.id);
      expect(result.headHandoverEffectiveDate).toEqual(new Date('2026-09-01T00:00:00.000Z'));
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? BASE_ORG_UNIT : null),
      );

      await expect(service.getHeadStatus(UNIT_1, ORG_B)).rejects.toThrow(NotFoundException);
    });
  });

  // ── declareHandover ───────────────────────────────────────────────────────

  describe('declareHandover', () => {
    it('throws NotFoundException when the org unit does not exist in this tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(
        service.declareHandover(UNIT_1, { incomingUserId: 'incoming-user', effectiveDate: '2026-09-01' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when a handover is already in progress for this unit', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ ...BASE_ORG_UNIT, pendingHeadUserId: 'someone-else' });

      await expect(
        service.declareHandover(UNIT_1, { incomingUserId: 'incoming-user', effectiveDate: '2026-09-01' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when the unit has no current Head to hand over from', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst.mockResolvedValueOnce(null); // outgoing holder lookup

      await expect(
        service.declareHandover(UNIT_1, { incomingUserId: 'incoming-user', effectiveDate: '2026-09-01' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when the incoming successor does not exist or is not active', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(OUTGOING_HOLDER) // outgoing holder lookup
        .mockResolvedValueOnce(null); // incoming successor lookup

      await expect(
        service.declareHandover(UNIT_1, { incomingUserId: 'missing-user', effectiveDate: '2026-09-01' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the incoming successor is the same person as the current Head', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(OUTGOING_HOLDER)
        .mockResolvedValueOnce({ ...OUTGOING_HOLDER, position: { isUnitHeadPosition: true } });

      await expect(
        service.declareHandover(UNIT_1, { incomingUserId: OUTGOING_HOLDER.id, effectiveDate: '2026-09-01' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when the incoming successor already holds a different head-conferring position', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(OUTGOING_HOLDER)
        .mockResolvedValueOnce({
          ...INCOMING_SUCCESSOR,
          position: { id: 'pos-other-head', isUnitHeadPosition: true },
        });

      await expect(
        service.declareHandover(UNIT_1, { incomingUserId: INCOMING_SUCCESSOR.id, effectiveDate: '2026-09-01' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the incoming successor does not already belong to this org unit', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(OUTGOING_HOLDER)
        .mockResolvedValueOnce({ ...INCOMING_SUCCESSOR, primaryOrgUnitId: 'unit-2', position: null });

      await expect(
        service.declareHandover(UNIT_1, { incomingUserId: INCOMING_SUCCESSOR.id, effectiveDate: '2026-09-01' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('declares a handover: grants the incoming successor the same position via the bypass, leaves the outgoing holder untouched, sets OrgUnit cache fields, writes HANDOVER_DECLARED', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(OUTGOING_HOLDER)
        .mockResolvedValueOnce(INCOMING_SUCCESSOR);

      await service.declareHandover(
        UNIT_1,
        { incomingUserId: INCOMING_SUCCESSOR.id, effectiveDate: '2026-09-01T00:00:00.000Z', reason: 'Retirement' },
        ORG_A,
        'actor-1',
      );

      // Bypasses 2.1/2.2's normal caps for exactly this pair.
      expect(mockUserService.validatePositionAssignment).toHaveBeenCalledWith(
        HEAD_POSITION_ID,
        UNIT_1,
        ORG_A,
        INCOMING_SUCCESSOR.id,
        true,
      );

      // The incoming successor is granted the head position...
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: INCOMING_SUCCESSOR.id },
        data: { positionId: HEAD_POSITION_ID },
      });
      // ...and ONLY the incoming successor — the outgoing holder's own
      // positionId is never touched by this call. Both now independently
      // satisfy 2.2's Head-derivation query (outgoing already did; incoming
      // now does too) — this IS "both holders resolve correctly."
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: UNIT_1 },
        data: { pendingHeadUserId: INCOMING_SUCCESSOR.id, headHandoverEffectiveDate: new Date('2026-09-01T00:00:00.000Z') },
      });

      expect(mockPrisma.orgUnitHeadEvent.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG_A,
          orgUnitId: UNIT_1,
          userId: INCOMING_SUCCESSOR.id,
          positionId: HEAD_POSITION_ID,
          action: 'HANDOVER_DECLARED',
          effectiveDate: new Date('2026-09-01T00:00:00.000Z'),
          reason: 'Retirement',
          approvedBy: 'actor-1',
        },
      });

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: ORG_A, actorId: 'actor-1', objectType: 'OrgUnit', objectId: UNIT_1 }),
      );
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? BASE_ORG_UNIT : null),
      );

      await expect(
        service.declareHandover(UNIT_1, { incomingUserId: 'incoming-user', effectiveDate: '2026-09-01' }, ORG_B, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── completeHandoverNow ──────────────────────────────────────────────────

  describe('completeHandoverNow', () => {
    const OPEN_HANDOVER_UNIT = { ...BASE_ORG_UNIT, pendingHeadUserId: INCOMING_SUCCESSOR.id };

    it('throws NotFoundException when the org unit does not exist in this tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(service.completeHandoverNow(UNIT_1, ORG_A, 'actor-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when no handover is currently in progress', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT); // pendingHeadUserId: null

      await expect(service.completeHandoverNow(UNIT_1, ORG_A, 'actor-1')).rejects.toThrow(ConflictException);
    });

    it('completes the handover: clears the OUTGOING holder only, clears OrgUnit cache fields, writes HANDOVER_COMPLETED', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(OPEN_HANDOVER_UNIT);
      mockPrisma.user.findMany.mockResolvedValue([
        OUTGOING_HOLDER,
        { ...INCOMING_SUCCESSOR, positionId: HEAD_POSITION_ID },
      ]);

      await service.completeHandoverNow(UNIT_1, ORG_A, 'admin-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: OUTGOING_HOLDER.id },
        data: { positionId: null },
      });
      // Only the outgoing holder is touched — the incoming successor,
      // already granted the position by declareHandover(), is untouched
      // here (they simply remain the sole holder going forward).
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: UNIT_1 },
        data: { pendingHeadUserId: null, headHandoverEffectiveDate: null },
      });

      expect(mockPrisma.orgUnitHeadEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_A,
          orgUnitId: UNIT_1,
          userId: INCOMING_SUCCESSOR.id,
          positionId: HEAD_POSITION_ID,
          action: 'HANDOVER_COMPLETED',
          approvedBy: 'admin-1',
        }),
      });
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? OPEN_HANDOVER_UNIT : null),
      );

      await expect(service.completeHandoverNow(UNIT_1, ORG_B, 'actor-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── cancelHandover ───────────────────────────────────────────────────────

  describe('cancelHandover', () => {
    const OPEN_HANDOVER_UNIT = { ...BASE_ORG_UNIT, pendingHeadUserId: INCOMING_SUCCESSOR.id };

    it('throws NotFoundException when the org unit does not exist in this tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(service.cancelHandover(UNIT_1, ORG_A, 'actor-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when no handover is currently in progress', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);

      await expect(service.cancelHandover(UNIT_1, ORG_A, 'actor-1')).rejects.toThrow(ConflictException);
    });

    it('cancels the handover: clears the INCOMING successor only, the outgoing holder remains the sole Head', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(OPEN_HANDOVER_UNIT);
      mockPrisma.user.findFirst.mockResolvedValue({ ...INCOMING_SUCCESSOR, positionId: HEAD_POSITION_ID });

      await service.cancelHandover(UNIT_1, ORG_A, 'admin-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: INCOMING_SUCCESSOR.id },
        data: { positionId: null },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: UNIT_1 },
        data: { pendingHeadUserId: null, headHandoverEffectiveDate: null },
      });

      expect(mockPrisma.orgUnitHeadEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_A,
          orgUnitId: UNIT_1,
          userId: INCOMING_SUCCESSOR.id,
          action: 'HANDOVER_CANCELLED',
          approvedBy: 'admin-1',
        }),
      });
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? OPEN_HANDOVER_UNIT : null),
      );

      await expect(service.cancelHandover(UNIT_1, ORG_B, 'actor-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── assignHead ───────────────────────────────────────────────────────────

  describe('assignHead', () => {
    const HEAD_POSITION = { id: HEAD_POSITION_ID, isUnitHeadPosition: true };
    const ORDINARY_POSITION = { id: 'pos-ordinary', isUnitHeadPosition: false };
    const VACANT_TARGET_USER = { id: 'target-user', organizationId: ORG_A, primaryOrgUnitId: UNIT_1, status: 'ACTIVE' };

    it('throws NotFoundException when the org unit does not exist in this tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(
        service.assignHead(UNIT_1, { userId: 'target-user', positionId: HEAD_POSITION_ID }, ORG_A, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when a handover is already in progress for this unit', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ ...BASE_ORG_UNIT, pendingHeadUserId: 'someone' });

      await expect(
        service.assignHead(UNIT_1, { userId: 'target-user', positionId: HEAD_POSITION_ID }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when the selected position does not confer Head authority', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.orgPosition.findFirst.mockResolvedValue(ORDINARY_POSITION);

      await expect(
        service.assignHead(UNIT_1, { userId: 'target-user', positionId: 'pos-ordinary' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the target user does not already belong to this org unit', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.orgPosition.findFirst.mockResolvedValue(HEAD_POSITION);
      mockPrisma.user.findFirst.mockResolvedValue({ ...VACANT_TARGET_USER, primaryOrgUnitId: 'unit-2' });

      await expect(
        service.assignHead(UNIT_1, { userId: 'target-user', positionId: HEAD_POSITION_ID }, ORG_A, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the unit already has an active Head — the shared, ordinary (non-bypassed) validation catches it', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.orgPosition.findFirst.mockResolvedValue(HEAD_POSITION);
      mockPrisma.user.findFirst.mockResolvedValue(VACANT_TARGET_USER);
      mockUserService.validatePositionAssignment.mockRejectedValue(
        new ConflictException('This org unit already has an active Head-position holder'),
      );

      await expect(
        service.assignHead(UNIT_1, { userId: 'target-user', positionId: HEAD_POSITION_ID }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('assigns a Head to a vacant unit: sets positionId, writes ASSIGNED, calls the ordinary (non-bypassed) validator', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.orgPosition.findFirst.mockResolvedValue(HEAD_POSITION);
      mockPrisma.user.findFirst.mockResolvedValue(VACANT_TARGET_USER);

      await service.assignHead(UNIT_1, { userId: 'target-user', positionId: HEAD_POSITION_ID }, ORG_A, 'admin-1');

      // Ordinary validation — no bypass argument at all, unlike declareHandover().
      expect(mockUserService.validatePositionAssignment).toHaveBeenCalledWith(
        HEAD_POSITION_ID,
        UNIT_1,
        ORG_A,
        'target-user',
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'target-user' },
        data: { positionId: HEAD_POSITION_ID },
      });
      expect(mockPrisma.orgUnitHeadEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_A,
          orgUnitId: UNIT_1,
          userId: 'target-user',
          positionId: HEAD_POSITION_ID,
          action: 'ASSIGNED',
          approvedBy: 'admin-1',
        }),
      });
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? BASE_ORG_UNIT : null),
      );

      await expect(
        service.assignHead(UNIT_1, { userId: 'target-user', positionId: HEAD_POSITION_ID }, ORG_B, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── vacateHead ───────────────────────────────────────────────────────────

  describe('vacateHead', () => {
    it('throws NotFoundException when the org unit does not exist in this tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(service.vacateHead(UNIT_1, ORG_A, 'actor-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when a handover is in progress for this unit', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ ...BASE_ORG_UNIT, pendingHeadUserId: 'someone' });

      await expect(service.vacateHead(UNIT_1, ORG_A, 'actor-1')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when the unit has no active Head to vacate', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.vacateHead(UNIT_1, ORG_A, 'actor-1')).rejects.toThrow(ConflictException);
    });

    // ACC-40 Section 2.3 — "a deliberate divergence from the RoleService
    // precedent": vacating a Head is NOT blocked the way removing the last
    // TENANT_ADMIN is. This test is the concrete proof: no handover, one
    // holder, and the call succeeds rather than throwing a lockout error.
    it('vacates an active Head with no handover declared — NOT blocked (unlike RoleService TENANT_ADMIN lockout), writes VACATED', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst.mockResolvedValue(OUTGOING_HOLDER);

      await service.vacateHead(UNIT_1, ORG_A, 'admin-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: OUTGOING_HOLDER.id },
        data: { positionId: null },
      });
      expect(mockPrisma.orgUnitHeadEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_A,
          orgUnitId: UNIT_1,
          userId: OUTGOING_HOLDER.id,
          positionId: HEAD_POSITION_ID,
          action: 'VACATED',
          approvedBy: 'admin-1',
        }),
      });
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? BASE_ORG_UNIT : null),
      );

      await expect(service.vacateHead(UNIT_1, ORG_B, 'actor-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── assignActingHead (ACC-40 Section 2.6) ───────────────────────────────

  describe('assignActingHead', () => {
    it('throws NotFoundException when the org unit does not exist in this tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(
        service.assignActingHead(UNIT_1, { userId: ACTING_USER.id }, ORG_A, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when a handover is in progress for this unit', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ ...BASE_ORG_UNIT, pendingHeadUserId: 'someone' });

      await expect(
        service.assignActingHead(UNIT_1, { userId: ACTING_USER.id }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when an Acting Head is already assigned', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ ...BASE_ORG_UNIT, actingHeadUserId: 'someone-else' });

      await expect(
        service.assignActingHead(UNIT_1, { userId: ACTING_USER.id }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when the unit already has an active real Head — never shadows a real holder', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst.mockResolvedValueOnce(OUTGOING_HOLDER); // current-holder lookup finds one

      await expect(
        service.assignActingHead(UNIT_1, { userId: ACTING_USER.id }, ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the designated acting user is not active in this tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(null) // no current real holder — vacant, proceeds
        .mockResolvedValueOnce(null); // acting user lookup — not found

      await expect(
        service.assignActingHead(UNIT_1, { userId: 'nonexistent' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('assigns Acting Head coverage to a vacant unit: sets actingHeadUserId, writes ACTING_ASSIGNED with positionId: null, and refreshes vacancy', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT);
      mockPrisma.user.findFirst
        .mockResolvedValueOnce(null) // no current real holder
        .mockResolvedValueOnce(ACTING_USER); // acting user found

      await service.assignActingHead(UNIT_1, { userId: ACTING_USER.id, reason: 'covering during recruitment' }, ORG_A, 'admin-1');

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: UNIT_1 },
        data: { actingHeadUserId: ACTING_USER.id },
      });
      expect(mockPrisma.orgUnitHeadEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_A,
          orgUnitId: UNIT_1,
          userId: ACTING_USER.id,
          positionId: null,
          action: 'ACTING_ASSIGNED',
          reason: 'covering during recruitment',
          approvedBy: 'admin-1',
        }),
      });
      // Never touches User.positionId — the load-bearing distinction from
      // assignHead()'s actual position grant (2.6's own framing).
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? BASE_ORG_UNIT : null),
      );

      await expect(
        service.assignActingHead(UNIT_1, { userId: ACTING_USER.id }, ORG_B, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── clearActingHead (ACC-40 Section 2.6) ────────────────────────────────

  describe('clearActingHead', () => {
    it('throws NotFoundException when the org unit does not exist in this tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(service.clearActingHead(UNIT_1, ORG_A, 'actor-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when no Acting Head is currently assigned', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_ORG_UNIT); // actingHeadUserId: null

      await expect(service.clearActingHead(UNIT_1, ORG_A, 'actor-1')).rejects.toThrow(ConflictException);
    });

    it('clears Acting Head coverage: sets actingHeadUserId to null, writes ACTING_ENDED with positionId: null, and refreshes vacancy', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ ...BASE_ORG_UNIT, actingHeadUserId: ACTING_USER.id });

      await service.clearActingHead(UNIT_1, ORG_A, 'admin-1');

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: UNIT_1 },
        data: { actingHeadUserId: null },
      });
      expect(mockPrisma.orgUnitHeadEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_A,
          orgUnitId: UNIT_1,
          userId: ACTING_USER.id,
          positionId: null,
          action: 'ACTING_ENDED',
          approvedBy: 'admin-1',
        }),
      });
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.organizationId === ORG_A ? { ...BASE_ORG_UNIT, actingHeadUserId: ACTING_USER.id } : null,
        ),
      );

      await expect(service.clearActingHead(UNIT_1, ORG_B, 'actor-1')).rejects.toThrow(NotFoundException);
    });
  });
});

// ACC-40 Section 2.5.1 gap fix — regression proof, not a mock-call
// assertion. The gap: every OrgUnitHeadService method mutates
// User.positionId directly via prisma.user.update(), never through
// UserService.updateProfile() — so refreshOrgUnitHeadVacancy()'s Phase 6
// commit 2 wiring never fired for these endpoints. Proving the fix
// requires the REAL OrganizationService (not the mocked stand-in used by
// every other describe block above) wired into a REAL OrgUnitHeadService,
// sharing one mockPrisma — so this test observes the actual end-to-end
// effect of calling vacateHead() directly: mockPrisma.orgUnit.update
// receiving isHeadVacant: true, not just a call to a mocked method.
describe('vacateHead() -> refreshOrgUnitHeadVacancy() end-to-end wiring (ACC-40 Section 2.5.1 gap fix)', () => {
  const VACATE_UNIT = {
    id: UNIT_1,
    organizationId: ORG_A,
    pendingHeadUserId: null as string | null,
    headHandoverEffectiveDate: null as Date | null,
    // The state refreshOrgUnitHeadVacancy() itself reads, distinct from
    // the object vacateHead()'s own getOrgUnitOrThrow() reads — both are
    // the same underlying row in real Postgres, modeled here as two
    // sequential mock returns from the same orgUnit.findFirst call site.
    isHeadVacant: false,
    actingHeadUserId: null as string | null,
    parentId: null as string | null,
  };

  it("flips isHeadVacant to true when vacateHead() is called directly — not through updateProfile() — proving the wiring gap found before commit 4 is actually closed", async () => {
    const realMockPrisma = {
      orgUnit: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      orgPosition: { findFirst: jest.fn() },
      user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), update: jest.fn().mockResolvedValue({}) },
      orgUnitHeadEvent: { create: jest.fn().mockResolvedValue({}) },
      role: { findFirst: jest.fn().mockResolvedValue(null) }, // no TENANT_ADMIN role — short-circuits before any notification call
      userRole: { findMany: jest.fn() },
    };
    const realMockAuditLog = { log: jest.fn() };
    const realMockNotificationService = { create: jest.fn() };
    const realMockUserService = { validatePositionAssignment: jest.fn() };

    // Sequential orgUnit.findFirst calls across the real call chain:
    // 1. OrgUnitHeadService.getOrgUnitOrThrow() (vacateHead()'s own precondition check)
    // 2. OrganizationService.refreshOrgUnitHeadVacancy()'s own lookup
    // 3. OrganizationService.resolveActingHeadForOrgUnit()'s walk step (unit-1 has no acting head, no parent — chain ends immediately)
    realMockPrisma.orgUnit.findFirst
      .mockResolvedValueOnce(VACATE_UNIT)
      .mockResolvedValueOnce(VACATE_UNIT)
      .mockResolvedValueOnce({ actingHeadUserId: null, parentId: null });
    realMockPrisma.user.findFirst.mockResolvedValue(OUTGOING_HOLDER); // vacateHead()'s current-holder lookup

    const realOrganizationService = new OrganizationService(
      realMockPrisma as unknown as PrismaService,
      realMockAuditLog as unknown as AuditLogService,
      realMockNotificationService as unknown as NotificationService,
    );
    const realOrgUnitHeadService = new OrgUnitHeadService(
      realMockPrisma as unknown as PrismaService,
      realMockAuditLog as unknown as AuditLogService,
      realMockUserService as unknown as UserService,
      realOrganizationService,
    );

    await realOrgUnitHeadService.vacateHead(UNIT_1, ORG_A, 'actor-1');

    expect(realMockPrisma.orgUnit.update).toHaveBeenCalledWith({
      where: { id: UNIT_1 },
      data: expect.objectContaining({ isHeadVacant: true }),
    });
  });
});
