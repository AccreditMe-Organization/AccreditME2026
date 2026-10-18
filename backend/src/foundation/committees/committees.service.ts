import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCommitteeReferences, CommitteeTx, lockCommitteeHierarchy } from './committee-reference-checks';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkflowService } from '../workflow/workflow.service';
import { CreateCommitteeDto } from './dto/create-committee.dto';
import { UpdateCommitteeDto } from './dto/update-committee.dto';
import { AddCommitteeMemberDto } from './dto/add-committee-member.dto';
import { ChangeCommitteeMemberRoleDto } from './dto/change-committee-member-role.dto';
import { RemoveCommitteeMemberDto } from './dto/remove-committee-member.dto';
import {
  ICommittee,
  ICommitteeDetail,
  ICommitteeListItem,
  ICommitteeMember,
  ICommitteeMembershipEvent,
} from './interfaces/committee.interface';
import { committeeStagesAndCounts } from './committee-stage-counts';
import { committeeTypeValues } from './committee-type-values';
import { CommitteeChangedException } from './committee-edit-refusal';

/**
 * ACC-233 — the value an update SETS, only when it differs from what is stored;
 * undefined otherwise, which `assertCommitteeReferences()` does not check.
 */
function changed<T>(sent: T | undefined, stored: T): T | undefined {
  return sent === undefined || sent === stored ? undefined : sent;
}

@Injectable()
export class CommitteesService {
  private readonly logger = new Logger(CommitteesService.name);

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

    // ACC-230 — the counts and stages are read by the one helper the
    // Sub-committees list also reads, so the two cannot disagree.
    const [facts, types] = await Promise.all([
      committeeStagesAndCounts(this.prisma, organizationId, committees.map((c) => c.id)),
      committeeTypeValues(this.prisma, organizationId, committees.map((c) => c.typeValueId)),
    ]);
    return committees.map((committee) => {
      const fact = facts.get(committee.id);
      return {
        ...committee,
        memberCount: fact?.memberCount ?? 0,
        currentStageNameEn: fact?.stageNameEn ?? null,
        currentStageNameAr: fact?.stageNameAr ?? null,
        currentStageKey: fact?.stageKey ?? null,
        isDissolving: fact?.isDissolving ?? false,
        typeValue: types.get(committee.typeValueId) ?? null,
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

  // ACC-238 — the record page's read: the committee plus its current stage KEY
  // and whether that key says it is dissolving, so the page decides what to
  // offer (Edit in Formation, the locked line in Terms Review) by key, never by
  // a stage name. Read by the same helper as the list rows, so the two agree.
  // Internal callers keep getCommitteeById(), which costs one query.
  async getCommitteeDetail(id: string, organizationId: string): Promise<ICommitteeDetail> {
    const committee = await this.getCommitteeById(id, organizationId);
    const [facts, types] = await Promise.all([
      committeeStagesAndCounts(this.prisma, organizationId, [committee.id]),
      committeeTypeValues(this.prisma, organizationId, [committee.typeValueId]),
    ]);
    const fact = facts.get(committee.id);
    return {
      ...committee,
      currentStageKey: fact?.stageKey ?? null,
      isDissolving: fact?.isDissolving ?? false,
      typeValue: types.get(committee.typeValueId) ?? null,
    };
  }

  // ACC-233 — the reference checks and the write are ONE transaction. A create
  // takes no hierarchy lock: the new committee has no sub-committees and nothing
  // reports to it, so no loop can pass through it. The dissolving check still
  // reads its target's workflow instance FOR SHARE.
  async createCommittee(
    dto: CreateCommitteeDto,
    organizationId: string,
    actorId: string,
  ): Promise<ICommittee> {
    const committee = await this.prisma.$transaction(async (tx) => {
      await assertCommitteeReferences(
        tx,
        {
          organizationId,
          committeeId: null,
          parentCommitteeId: dto.parentCommitteeId ?? undefined,
          reportingToCommitteeId: dto.reportingToCommitteeId ?? undefined,
          // Omitted (or null) is "the whole organisation" and resolves to the
          // root below (ACC-135). '' is sent, and refused.
          orgUnitId: dto.orgUnitId === null ? undefined : dto.orgUnitId,
        },
        this.logger,
      );
      const orgUnitId = dto.orgUnitId || (await this.resolveRootOrgUnitId(tx, organizationId));

      return tx.committee.create({
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
    // ACC-233 — ONE transaction. An update that sets a parent or reports-to
    // first takes the organisation's hierarchy lock, so two edits saved at the
    // same moment cannot close a loop between them (lockCommitteeHierarchy()).
    const touchesHierarchy = dto.parentCommitteeId !== undefined || dto.reportingToCommitteeId !== undefined;

    const { existing, committee } = await this.prisma.$transaction(async (tx) => {
      if (touchesHierarchy) await lockCommitteeHierarchy(tx, organizationId);

      // ACC-238 — the committee's row lock, after the hierarchy lock (always in
      // that order), so two saves of one committee queue here and the second
      // reads the first's `updatedAt`. Scoped by organisation: another
      // organisation's id locks nothing and gets the same 404 as a missing one.
      await tx.$queryRaw`SELECT id FROM "Committee" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;

      const before = await tx.committee.findFirst({ where: { id, organizationId } });
      if (!before) throw new NotFoundException('Committee not found');

      // ACC-238 — the stale save. The dialog sends the `updatedAt` it loaded;
      // a committee changed since then is refused, and nothing is written.
      if (dto.expectedUpdatedAt !== undefined && new Date(dto.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()) {
        throw new CommitteeChangedException();
      }

      // Only a value that CHANGES is checked. The dialog sends every field, and
      // a committee whose parent has since begun dissolving (or whose unit was
      // since deactivated) must still be editable for its name.
      //
      // An UPDATE validates but never defaults. Omitting the owning unit means
      // "leave it alone", which is not create()'s "the whole organisation"; but
      // SENDING it empty (or null) is refused, never written (ACC-233 rule 4 —
      // it used to reach the database and fail there as a 500).
      await assertCommitteeReferences(
        tx,
        {
          organizationId,
          committeeId: id,
          parentCommitteeId: changed(dto.parentCommitteeId, before.parentCommitteeId),
          reportingToCommitteeId: changed(dto.reportingToCommitteeId, before.reportingToCommitteeId),
          orgUnitId: changed(dto.orgUnitId, before.orgUnitId),
        },
        this.logger,
      );

      const updated = await tx.committee.update({
        where: { id },
        data: {
          ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
          ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
          ...(dto.typeValueId !== undefined && { typeValueId: dto.typeValueId }),
          ...(dto.purpose !== undefined && { purpose: dto.purpose }),
          ...(dto.quorumCount !== undefined && { quorumCount: dto.quorumCount }),
          ...(dto.meetingFrequency !== undefined && { meetingFrequency: dto.meetingFrequency }),
          ...(dto.parentCommitteeId !== undefined && { parentCommitteeId: dto.parentCommitteeId }),
          ...(dto.orgUnitId && { orgUnitId: dto.orgUnitId }),
          ...(dto.termsOfReferenceDocumentId !== undefined && {
            termsOfReferenceDocumentId: dto.termsOfReferenceDocumentId,
          }),
          ...(dto.reportingToCommitteeId !== undefined && {
            reportingToCommitteeId: dto.reportingToCommitteeId,
          }),
        },
      });
      return { existing: before, committee: updated };
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
            // The day they joined, as on a rejoin above (ACC-120 slice 4). Before
            // this a new member's joinedAt was always "now", whatever date was
            // sent, while the JOINED event recorded the date sent.
            joinedAt: effectiveDate,
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

  /**
   * The owning unit for a NEW committee that names none — ACC-135.
   *
   * A caller who names a unit gets that unit, validated against their own
   * tenant (and, since ACC-233, required to be active) by
   * `assertCommitteeReferences()`. A caller who names none is not saying "no
   * owner"; they are saying "the whole organisation", and the root unit IS the
   * organisation (ACC-141 fixed its type to `organization` to make exactly that
   * explicit). So the absence resolves to the root rather than being stored.
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
  private async resolveRootOrgUnitId(tx: CommitteeTx, organizationId: string): Promise<string> {
    const roots = await tx.orgUnit.findMany({
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
