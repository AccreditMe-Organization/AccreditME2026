import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrgUnitHeadService } from './org-unit-head.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { UserService } from '../user/user.service';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
const UNIT_1 = 'unit-1';
const HEAD_POSITION_ID = 'pos-head';
const OUTGOING_HOLDER = { id: 'outgoing-user', organizationId: ORG_A, primaryOrgUnitId: UNIT_1, positionId: HEAD_POSITION_ID, status: 'ACTIVE' };
const INCOMING_SUCCESSOR = { id: 'incoming-user', organizationId: ORG_A, primaryOrgUnitId: UNIT_1, positionId: null, status: 'ACTIVE', position: null };
const BASE_ORG_UNIT = { id: UNIT_1, organizationId: ORG_A, pendingHeadUserId: null as string | null, headHandoverEffectiveDate: null as Date | null };

const mockPrisma = {
  orgUnit: { findFirst: jest.fn(), update: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  orgUnitHeadEvent: { create: jest.fn() },
};
const mockAuditLog = { log: jest.fn() };
const mockUserService = { validatePositionAssignment: jest.fn() };

describe('OrgUnitHeadService', () => {
  let service: OrgUnitHeadService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.orgUnitHeadEvent.create.mockResolvedValue({});
    mockPrisma.orgUnit.update.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});
    mockUserService.validatePositionAssignment.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgUnitHeadService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    service = module.get<OrgUnitHeadService>(OrgUnitHeadService);
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
});
