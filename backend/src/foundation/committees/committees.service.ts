import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkflowService } from '../workflow/workflow.service';
import { CreateCommitteeDto } from './dto/create-committee.dto';
import { UpdateCommitteeDto } from './dto/update-committee.dto';
import { AddCommitteeMemberDto } from './dto/add-committee-member.dto';
import { ChangeCommitteeMemberRoleDto } from './dto/change-committee-member-role.dto';
import { RemoveCommitteeMemberDto } from './dto/remove-committee-member.dto';
import { ICommittee, ICommitteeListItem, ICommitteeMember, ICommitteeMembershipEvent } from './interfaces/committee.interface';

@Injectable()
export class CommitteesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly workflowService: WorkflowService,
  ) {}

  // ── Committee CRUD ───────────────────────────────────────────────────────────

  // ACC-76 — carries member count and live workflow stage, so a list row (and
  // the sub-committees panel on a record page) can say what a committee IS
  // without a request per row.
  //
  // THREE queries total, regardless of list length: the committees, one
  // grouped count over CommitteeMember, one pass over the workflow instances
  // for the whole id set. The per-row alternative is N+1 twice over, and at
  // ~110ms a round trip that is visible to a user.
  async listCommittees(organizationId: string): Promise<ICommitteeListItem[]> {
    const committees = await this.prisma.committee.findMany({
      where: { organizationId },
      orderBy: { nameEn: 'asc' },
    });
    if (committees.length === 0) return [];

    const committeeIds = committees.map((c) => c.id);

    const [memberCounts, instances] = await Promise.all([
      // Active members only — a departed member is not part of the committee,
      // and CommitteeMember rows are reactivated in place rather than
      // recreated (ACC-32), so leftAt/isActive is the only thing separating
      // current from historical.
      this.prisma.committeeMember.groupBy({
        by: ['committeeId'],
        where: { organizationId, committeeId: { in: committeeIds }, isActive: true },
        _count: { committeeId: true },
      }),
      // Tenant-scoped in its own right, not merely via the id set above —
      // a WorkflowInstance carries organizationId, so scoping it costs
      // nothing and removes any dependence on how committeeIds was built.
      this.prisma.workflowInstance.findMany({
        where: { organizationId, objectType: 'COMMITTEE', objectId: { in: committeeIds } },
        orderBy: { createdAt: 'desc' },
        select: { objectId: true, currentStageId: true },
      }),
    ]);

    const countByCommitteeId = new Map(
      memberCounts.map((row) => [row.committeeId, row._count.committeeId]),
    );

    // Newest instance wins — the query is ordered createdAt desc and a
    // committee can accumulate instances over time, same as any other object.
    const stageIdByCommitteeId = new Map<string, string | null>();
    for (const instance of instances) {
      if (!stageIdByCommitteeId.has(instance.objectId)) {
        stageIdByCommitteeId.set(instance.objectId, instance.currentStageId);
      }
    }

    const stageIds = [...new Set([...stageIdByCommitteeId.values()].filter((id): id is string => !!id))];
    const stages =
      stageIds.length > 0
        ? await this.prisma.workflowStage.findMany({
            where: { id: { in: stageIds } },
            select: { id: true, nameEn: true, nameAr: true },
          })
        : [];
    const stageById = new Map(stages.map((s) => [s.id, s]));

    return committees.map((committee) => {
      const stageId = stageIdByCommitteeId.get(committee.id) ?? null;
      const stage = stageId ? stageById.get(stageId) : undefined;
      return {
        ...committee,
        memberCount: countByCommitteeId.get(committee.id) ?? 0,
        currentStageNameEn: stage?.nameEn ?? null,
        currentStageNameAr: stage?.nameAr ?? null,
      };
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
    const orgUnitId = await this.resolveOwningOrgUnitId(dto.orgUnitId, organizationId);

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
        orgUnitId,
        // Deliberately unpopulated — Document Management doesn't exist yet
        // (ACC-22 Pending Discussion #1, resolved: option (a)).
        termsOfReferenceDocumentId: dto.termsOfReferenceDocumentId ?? null,
        reportingToCommitteeId: dto.reportingToCommitteeId ?? null,
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
  ): Promise<ICommittee> {
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
    // An UPDATE validates but never defaults. Omitting the field means "leave it
    // alone", which is not the same statement as create()'s "the whole
    // organisation" — a committee that already has an owner must not silently
    // acquire the root because a caller sent a partial body.
    if (dto.orgUnitId) {
      await this.validateOrgUnitReference(dto.orgUnitId, organizationId);
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
        ...(dto.orgUnitId !== undefined && { orgUnitId: dto.orgUnitId }),
        ...(dto.termsOfReferenceDocumentId !== undefined && {
          termsOfReferenceDocumentId: dto.termsOfReferenceDocumentId,
        }),
        ...(dto.reportingToCommitteeId !== undefined && {
          reportingToCommitteeId: dto.reportingToCommitteeId,
        }),
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
  ): Promise<ICommitteeMember> {
    await this.getCommitteeById(committeeId, organizationId);
    await this.validateUserReference(dto.userId, organizationId);

    // No isActive filter here — a departed member's row must be found too,
    // so a rejoin reactivates it in place (mirroring RoleService.reactivateRole())
    // instead of hitting @@unique([committeeId, userId]) on create().
    const existing = await this.prisma.committeeMember.findFirst({
      where: { committeeId, userId: dto.userId },
    });
    if (existing?.isActive) {
      throw new ConflictException('This user is already an active member of this committee');
    }

    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();

    const member = existing
      ? await this.prisma.committeeMember.update({
          where: { id: existing.id },
          data: {
            roleValueId: dto.roleValueId,
            isActive: true,
            leftAt: null,
            joinedAt: effectiveDate,
          },
        })
      : await this.prisma.committeeMember.create({
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
      action: existing ? 'UPDATE' : 'CREATE',
      objectType: 'CommitteeMember',
      objectId: member.id,
      actorId,
      tenantId: organizationId,
      ...(existing && { before: existing as unknown as Record<string, unknown> }),
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
  ): Promise<ICommitteeMember> {
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
  ): Promise<void> {
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

  // Two DISTINCT validation paths — parentCommitteeId/reportingToCommitteeId both
  // resolve against the Committee model; orgUnitId resolves against OrgUnit.
  // Never a single shared helper that only actually checks one.
  //
  // This note used to name reportingToRoleId as the second path (ACC-22 Pending
  // Discussion #4). ACC-135 removed that field; the shape of the rule is
  // unchanged, only which models it spans.
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

  private async validateOrgUnitReference(orgUnitId: string, organizationId: string): Promise<void> {
    const orgUnit = await this.prisma.orgUnit.findFirst({
      where: { id: orgUnitId, organizationId },
    });
    if (!orgUnit) {
      throw new NotFoundException('Owning org unit not found in this tenant');
    }
  }

  /**
   * The owning unit for a NEW committee — ACC-135.
   *
   * A caller who names a unit gets that unit, validated against their own tenant.
   * A caller who names none is not saying "no owner"; they are saying "the whole
   * organisation", and the root unit IS the organisation (ACC-141 fixed its type
   * to `organization` to make exactly that explicit). So the absence resolves to
   * the root rather than being stored.
   *
   * ## This duplicates OrganizationService's own root definition, deliberately
   *
   * `OrganizationService.findActiveRoot()` is private and says the same thing:
   * parentId null, isActive true. Importing OrganizationModule to share it would
   * add a fifth forwardRef() edge to a DI graph where every existing one carries
   * a comment about the real `nest start` failure that proved it necessary. Four
   * lines of query cost less than a boot-proving cycle.
   *
   * THE TWO MUST CHANGE TOGETHER. "What is the root" now has two definitions, and
   * that is the price of not taking the module edge — recorded here and at
   * findActiveRoot(), the way ACC-141 recorded its two validation deciders.
   *
   * ## Two roots is refused, not resolved
   *
   * findActiveRoot() orders by createdAt and takes the first, which is right for
   * ACC-134's "is there already a root" question — it only needs to know one
   * exists. Here the answer becomes a real owner written onto a real record, so
   * picking one on a row ordering nobody chose is the wrong failure. ACC-134 says
   * a tenant has exactly one root; two is a violation of that invariant.
   *
   * ## No root at all is refused too, and it is reachable
   *
   * ACC-134 enforced AT MOST one root. It never enforced AT LEAST one, and
   * nothing blocks deactivating the root (ACC-152). Writing null instead would
   * put a committee into the state this ticket exists to remove.
   */
  private async resolveOwningOrgUnitId(
    requestedOrgUnitId: string | undefined,
    organizationId: string,
  ): Promise<string> {
    if (requestedOrgUnitId) {
      await this.validateOrgUnitReference(requestedOrgUnitId, organizationId);
      return requestedOrgUnitId;
    }

    const roots = await this.prisma.orgUnit.findMany({
      where: { organizationId, parentId: null, isActive: true },
      select: { id: true, code: true },
      orderBy: { createdAt: 'asc' },
    });

    if (roots.length === 0) {
      throw new ConflictException(
        'This organization has no active root org unit, so a committee created without ' +
          'an owning unit has nothing to belong to. Name an owning unit explicitly, or ' +
          'reactivate the root unit.',
      );
    }
    if (roots.length > 1) {
      throw new ConflictException(
        `This organization has ${roots.length} active root org units ` +
          `(${roots.map((r) => r.code).join(', ')}), so "the whole organisation" has no ` +
          'single answer. A tenant is meant to have exactly one root — fix the org ' +
          'structure, or name an owning unit explicitly.',
      );
    }

    return roots[0]!.id;
  }

  private async validateUserReference(userId: string, organizationId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!user) {
      throw new NotFoundException('User not found in this tenant');
    }
  }
}
