import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkflowService } from '../workflow/workflow.service';
import { COMMITTEES_PERMISSIONS } from '../../common/constants/permissions';
import { CreateCommitteeDto } from './dto/create-committee.dto';
import { UpdateCommitteeDto } from './dto/update-committee.dto';
import { AddCommitteeMemberDto } from './dto/add-committee-member.dto';
import { ChangeCommitteeMemberRoleDto } from './dto/change-committee-member-role.dto';
import { RemoveCommitteeMemberDto } from './dto/remove-committee-member.dto';
import { ICommittee, ICommitteeMember, ICommitteeMembershipEvent } from './interfaces/committee.interface';

@Injectable()
export class CommitteesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly workflowService: WorkflowService,
  ) {}

  // ── Committee CRUD ───────────────────────────────────────────────────────────

  async listCommittees(organizationId: string): Promise<ICommittee[]> {
    return this.prisma.committee.findMany({
      where: { organizationId },
      orderBy: { nameEn: 'asc' },
    });
  }

  async getCommitteeById(id: string, organizationId: string): Promise<ICommittee> {
    const committee = await this.prisma.committee.findFirst({ where: { id, organizationId } });
    if (!committee) {
      throw new NotFoundException('Committee not found');
    }
    return committee;
  }

  async createCommittee(
    dto: CreateCommitteeDto,
    organizationId: string,
    actorId: string,
  ): Promise<ICommittee> {
    if (dto.parentCommitteeId) {
      await this.validateCommitteeReference(dto.parentCommitteeId, organizationId, 'Parent committee');
    }
    if (dto.reportingToCommitteeId) {
      await this.validateCommitteeReference(
        dto.reportingToCommitteeId,
        organizationId,
        'Reporting-to committee',
      );
    }
    if (dto.reportingToRoleId) {
      await this.validateRoleReference(dto.reportingToRoleId, organizationId);
    }

    const committee = await this.prisma.committee.create({
      data: {
        organizationId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        typeValueId: dto.typeValueId,
        purpose: dto.purpose ?? null,
        quorumCount: dto.quorumCount ?? 0,
        meetingFrequency: dto.meetingFrequency ?? 'AS_NEEDED',
        parentCommitteeId: dto.parentCommitteeId ?? null,
        // Deliberately unpopulated — Document Management doesn't exist yet
        // (ACC-22 Pending Discussion #1, resolved: option (a)).
        termsOfReferenceDocumentId: dto.termsOfReferenceDocumentId ?? null,
        reportingToCommitteeId: dto.reportingToCommitteeId ?? null,
        reportingToRoleId: dto.reportingToRoleId ?? null,
      },
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'Committee',
      objectId: committee.id,
      actorId,
      tenantId: organizationId,
      after: committee,
    });

    // Ties the new Committee record to a live WorkflowInstance of the
    // already-shipped COMMITTEE workflow (ACC-9) — the 6-stage
    // FORMATION -> ... -> DISSOLVED lifecycle shell this ticket's plan
    // confirmed already exists and doesn't need reseeding.
    await this.workflowService.startInstance('COMMITTEE', committee.id, organizationId, actorId);

    return committee;
  }

  async updateCommittee(
    id: string,
    dto: UpdateCommitteeDto,
    organizationId: string,
    actorId: string,
    userPermissions: string[],
  ): Promise<ICommittee> {
    await this.assertCommitteeAuthority(id, organizationId, actorId, userPermissions);
    const existing = await this.getCommitteeById(id, organizationId);

    if (dto.parentCommitteeId) {
      await this.validateCommitteeReference(dto.parentCommitteeId, organizationId, 'Parent committee');
    }
    if (dto.reportingToCommitteeId) {
      await this.validateCommitteeReference(
        dto.reportingToCommitteeId,
        organizationId,
        'Reporting-to committee',
      );
    }
    if (dto.reportingToRoleId) {
      await this.validateRoleReference(dto.reportingToRoleId, organizationId);
    }

    const committee = await this.prisma.committee.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.typeValueId !== undefined && { typeValueId: dto.typeValueId }),
        ...(dto.purpose !== undefined && { purpose: dto.purpose }),
        ...(dto.quorumCount !== undefined && { quorumCount: dto.quorumCount }),
        ...(dto.meetingFrequency !== undefined && { meetingFrequency: dto.meetingFrequency }),
        ...(dto.parentCommitteeId !== undefined && { parentCommitteeId: dto.parentCommitteeId }),
        ...(dto.termsOfReferenceDocumentId !== undefined && {
          termsOfReferenceDocumentId: dto.termsOfReferenceDocumentId,
        }),
        ...(dto.reportingToCommitteeId !== undefined && {
          reportingToCommitteeId: dto.reportingToCommitteeId,
        }),
        ...(dto.reportingToRoleId !== undefined && { reportingToRoleId: dto.reportingToRoleId }),
      },
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Committee',
      objectId: committee.id,
      actorId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: committee,
    });

    return committee;
  }

  // ── Membership Management (NOT workflow transitions — module-designs.md) ────

  async listMembers(committeeId: string, organizationId: string): Promise<ICommitteeMember[]> {
    await this.getCommitteeById(committeeId, organizationId); // validates committee belongs to org
    return this.prisma.committeeMember.findMany({
      where: { committeeId, organizationId, isActive: true },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async listMembershipEvents(
    committeeId: string,
    organizationId: string,
  ): Promise<ICommitteeMembershipEvent[]> {
    await this.getCommitteeById(committeeId, organizationId);
    return this.prisma.committeeMembershipEvent.findMany({
      where: { committeeId, organizationId },
      orderBy: { effectiveDate: 'desc' },
    });
  }

  async addMember(
    committeeId: string,
    dto: AddCommitteeMemberDto,
    organizationId: string,
    actorId: string,
    userPermissions: string[],
  ): Promise<ICommitteeMember> {
    await this.assertCommitteeAuthority(committeeId, organizationId, actorId, userPermissions);
    await this.getCommitteeById(committeeId, organizationId);
    await this.validateUserReference(dto.userId, organizationId);

    const existingActive = await this.prisma.committeeMember.findFirst({
      where: { committeeId, userId: dto.userId, isActive: true },
    });
    if (existingActive) {
      throw new ConflictException('This user is already an active member of this committee');
    }

    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();

    const member = await this.prisma.committeeMember.create({
      data: {
        organizationId,
        committeeId,
        userId: dto.userId,
        roleValueId: dto.roleValueId,
        isActive: true,
      },
    });

    await this.prisma.committeeMembershipEvent.create({
      data: {
        organizationId,
        committeeId,
        userId: dto.userId,
        roleValueId: dto.roleValueId,
        action: 'JOINED',
        effectiveDate,
        reason: dto.reason ?? null,
        approvedBy: actorId,
      },
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'CommitteeMember',
      objectId: member.id,
      actorId,
      tenantId: organizationId,
      after: member,
    });

    return member;
  }

  async changeMemberRole(
    committeeId: string,
    memberId: string,
    dto: ChangeCommitteeMemberRoleDto,
    organizationId: string,
    actorId: string,
    userPermissions: string[],
  ): Promise<ICommitteeMember> {
    await this.assertCommitteeAuthority(committeeId, organizationId, actorId, userPermissions);
    await this.getCommitteeById(committeeId, organizationId);
    const existing = await this.getActiveMember(committeeId, memberId, organizationId);

    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();

    const member = await this.prisma.committeeMember.update({
      where: { id: memberId },
      data: { roleValueId: dto.roleValueId },
    });

    await this.prisma.committeeMembershipEvent.create({
      data: {
        organizationId,
        committeeId,
        userId: existing.userId,
        roleValueId: dto.roleValueId,
        action: 'ROLE_CHANGED',
        effectiveDate,
        reason: dto.reason ?? null,
        approvedBy: actorId,
      },
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'CommitteeMember',
      objectId: member.id,
      actorId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: member,
    });

    return member;
  }

  async removeMember(
    committeeId: string,
    memberId: string,
    dto: RemoveCommitteeMemberDto,
    organizationId: string,
    actorId: string,
    userPermissions: string[],
  ): Promise<void> {
    await this.assertCommitteeAuthority(committeeId, organizationId, actorId, userPermissions);
    await this.getCommitteeById(committeeId, organizationId);
    const existing = await this.getActiveMember(committeeId, memberId, organizationId);

    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();

    // isActive derived STRICTLY from leftAt (ACC-22 Pending Discussion #6)
    // — never set independently of it.
    const member = await this.prisma.committeeMember.update({
      where: { id: memberId },
      data: { leftAt: effectiveDate, isActive: false },
    });

    await this.prisma.committeeMembershipEvent.create({
      data: {
        organizationId,
        committeeId,
        userId: existing.userId,
        roleValueId: existing.roleValueId,
        action: 'LEFT',
        effectiveDate,
        reason: dto.reason ?? null,
        approvedBy: actorId,
      },
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'CommitteeMember',
      objectId: member.id,
      actorId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: member,
    });
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  // ACC-28 — narrow, Committee-specific check for the four endpoints that
  // aren't reachable through the workflow engine (membership changes are
  // CommitteeMembershipEvent records, not workflow transitions —
  // module-designs.md). Flat committees:manage keeps working exactly as
  // before (first line returns immediately); a user who lacks it but is
  // the active Chairman of THIS specific committee gains access —
  // strictly additive, nothing narrowed. No @Permissions() decorator on
  // these routes at the controller — same deliberate exception already
  // established for WorkflowController.triggerTransition()/submitApproval().
  private async assertCommitteeAuthority(
    committeeId: string,
    organizationId: string,
    actorId: string,
    userPermissions: string[],
  ): Promise<void> {
    if (userPermissions.includes(COMMITTEES_PERMISSIONS.MANAGE)) return;

    // organizationId: null is required here, not optional — a tenant that
    // has ever relabeled "Chairman" via LookupService.overrideLabel()
    // creates a SECOND LookupValue row with the same key but
    // organizationId SET (the override/upsert target). Without this
    // filter, findFirst() would have two matching rows with no ordering
    // guarantee and could nondeterministically resolve the tenant's
    // override row instead of the SYSTEM row that
    // CommitteeMember.roleValueId actually references.
    const chairmanValue = await this.prisma.lookupValue.findFirst({
      where: {
        key: 'chairman',
        organizationId: null,
        category: { key: 'committee_member_role' },
      },
      select: { id: true },
    });

    const isChair = chairmanValue
      ? await this.prisma.committeeMember.findFirst({
          where: {
            committeeId,
            organizationId,
            userId: actorId,
            isActive: true,
            roleValueId: chairmanValue.id,
          },
        })
      : null;

    if (!isChair) {
      throw new ForbiddenException(
        'Requires committees:manage, or must be the active Chairman of this committee',
      );
    }
  }

  private async getActiveMember(
    committeeId: string,
    memberId: string,
    organizationId: string,
  ): Promise<ICommitteeMember> {
    const member = await this.prisma.committeeMember.findFirst({
      where: { id: memberId, committeeId, organizationId, isActive: true },
    });
    if (!member) {
      throw new NotFoundException('Active committee member not found');
    }
    return member;
  }

  // Two DISTINCT validation paths (ACC-22 Pending Discussion #4) —
  // parentCommitteeId/reportingToCommitteeId both resolve against the
  // Committee model; reportingToRoleId resolves against the Role model.
  // Never a single shared helper that only actually checks one.
  private async validateCommitteeReference(
    committeeId: string,
    organizationId: string,
    label: string,
  ): Promise<void> {
    const committee = await this.prisma.committee.findFirst({
      where: { id: committeeId, organizationId },
    });
    if (!committee) {
      throw new NotFoundException(`${label} not found in this tenant`);
    }
  }

  private async validateRoleReference(roleId: string, organizationId: string): Promise<void> {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId } });
    if (!role) {
      throw new NotFoundException('Reporting-to role not found in this tenant');
    }
  }

  private async validateUserReference(userId: string, organizationId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!user) {
      throw new NotFoundException('User not found in this tenant');
    }
  }
}
