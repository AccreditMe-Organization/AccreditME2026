import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCommitteeReferences, CommitteeTx, lockCommitteeHierarchy } from './committee-reference-checks';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkflowService } from '../workflow/workflow.service';
import { StageRules, StageRulesService } from '../workflow/stage-rules.service';
import { COMMITTEE_ACTIONS, STAGE_FLAG } from '../workflow/record-registry';
import { CommitteeSeatRefusal, requiredSeats, seatHolders, seatValues } from './committee-seat-rules';
import {
  SEAT_ACTION_KEYS,
  SeatActionRefusal,
  copyDefaultSeatActions,
  normaliseSeatActions,
  seatActionMap,
  seatActionsFor,
} from './seat-actions';
import { ReplaceSeatActionsDto } from './dto/replace-seat-actions.dto';
import { CreateCommitteeDto } from './dto/create-committee.dto';
import { UpdateCommitteeDto } from './dto/update-committee.dto';
import { AddCommitteeMemberDto } from './dto/add-committee-member.dto';
import { ChangeCommitteeMemberRoleDto } from './dto/change-committee-member-role.dto';
import { RemoveCommitteeMemberDto } from './dto/remove-committee-member.dto';
import {
  ICommitteeRef,
  ICommittee,
  ICommitteeDetail,
  ICommitteeListItem,
  ICommitteeMember,
  ICommitteeMembershipEvent,
  ICommitteeSeatActions,
  ICommitteeStageRules,
} from './interfaces/committee.interface';
import { committeeStagesAndCounts } from './committee-stage-counts';
import { committeeTypeValues } from './committee-type-values';
import { CommitteeChangedException } from './committee-edit-refusal';
import { committeeStageRefusalMessage } from './committee-stage-refusal';
import {
  CommitteeViewer,
  assertMaySeeCommittee,
  assertMayWriteCommittee,
  committeeOversightUnitIds,
  readableCommitteeIds,
  seesEveryCommittee,
} from '../../common/services/committee-membership';

/**
 * ACC-233 — the value an update SETS, only when it differs from what is stored;
 * undefined otherwise, which `assertCommitteeReferences()` does not check.
 */
function changed<T>(sent: T | undefined, stored: T): T | undefined {
  return sent === undefined || sent === stored ? undefined : sent;
}

/** ACC-255 — the engine's answer, as the committee read carries it. No live stage: nothing allowed. */
function committeeStageRules(rules: StageRules | undefined): ICommitteeStageRules {
  const allowed = (key: string): boolean => rules?.actions[key] === true;
  return {
    actions: {
      edit_details: allowed(COMMITTEE_ACTIONS.EDIT_DETAILS),
      add_member: allowed(COMMITTEE_ACTIONS.ADD_MEMBER),
      remove_member: allowed(COMMITTEE_ACTIONS.REMOVE_MEMBER),
      change_member_role: allowed(COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE),
      request_change: allowed(COMMITTEE_ACTIONS.REQUEST_CHANGE),
    },
    flags: [...(rules?.flags ?? [])],
  };
}

@Injectable()
export class CommitteesService {
  private readonly logger = new Logger(CommitteesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly workflowService: WorkflowService,
    private readonly stageRules: StageRulesService,
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
  // ACC-281 — committees:view sees every committee (oversight); anyone else sees
  // only the ACTIVE committees they are an ACTIVE member of, by one more
  // condition on the same query. A non-member gets an empty list.
  //
  // ACC-283 PR 2a — and the ACTIVE committees owned by a unit the viewer heads or
  // covers, or any unit below it: one more alternative in the same condition, after
  // the headship reads (two at once, then the walk only when they lead something).
  async listCommittees(organizationId: string, viewer: CommitteeViewer, now: Date = new Date()): Promise<ICommitteeListItem[]> {
    let own: Prisma.CommitteeWhereInput = {};
    if (!seesEveryCommittee(viewer.permissions)) {
      const units = await committeeOversightUnitIds(this.prisma, organizationId, viewer.id, now);
      const member: Prisma.CommitteeWhereInput = { members: { some: { userId: viewer.id, organizationId, isActive: true } } };
      own = {
        isActive: true,
        ...(units.size > 0 ? { OR: [member, { orgUnitId: { in: [...units] } }] } : member),
      };
    }
    const committees = await this.prisma.committee.findMany({
      where: { organizationId, ...own },
      orderBy: { nameEn: 'asc' },
    });
    if (committees.length === 0) return [];

    // ACC-230 — the counts and stages are read by the one helper the
    // Sub-committees list also reads, so the two cannot disagree.
    // ACC-255 — and what each one's stage allows, three more queries for the set.
    const ids = committees.map((c) => c.id);
    const [facts, types, rules] = await Promise.all([
      committeeStagesAndCounts(this.prisma, organizationId, ids),
      committeeTypeValues(this.prisma, organizationId, committees.map((c) => c.typeValueId)),
      this.stageRules.stageRulesFor(organizationId, 'COMMITTEE', ids),
    ]);
    return committees.map((committee) => {
      const fact = facts.get(committee.id);
      return {
        ...committee,
        memberCount: fact?.memberCount ?? 0,
        currentStageNameEn: fact?.stageNameEn ?? null,
        currentStageNameAr: fact?.stageNameAr ?? null,
        isDissolving: fact?.isDissolving ?? false,
        typeValue: types.get(committee.typeValueId) ?? null,
        stageRules: committeeStageRules(rules.get(committee.id)),
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

  // ACC-238 — the record page's read: the committee plus what its current
  // stage allows and means (stageRules, ACC-255), whether it is dissolving, and
  // its type and owning unit named (ACC-246, ACC-265). Read by the same helpers
  // as the list rows, so the two agree. No stage key is sent (ACC-265).
  // Internal callers keep getCommitteeById(), which costs one query.
  async getCommitteeDetail(id: string, organizationId: string, viewer: CommitteeViewer): Promise<ICommitteeDetail> {
    // ACC-281 — committees:view or an active member; anyone else today's 403.
    // ACC-283 — the same pass says whether they may write: no extra query.
    const access = await assertMaySeeCommittee(
      this.prisma,
      id,
      organizationId,
      viewer,
    );
    const committee = await this.getCommitteeById(id, organizationId);
    const [facts, types, rules, orgUnit, related] = await Promise.all([
      committeeStagesAndCounts(this.prisma, organizationId, [committee.id]),
      committeeTypeValues(this.prisma, organizationId, [committee.typeValueId]),
      this.stageRules.stageRulesFor(organizationId, 'COMMITTEE', [committee.id]),
      // ACC-265 — the owning unit's names, scoped by organisation like every read.
      committee.orgUnitId
        ? this.prisma.orgUnit.findFirst({
            where: { id: committee.orgUnitId, organizationId },
            select: { id: true, nameEn: true, nameAr: true },
          })
        : Promise.resolve(null),
      // ACC-281 — the parent and Reports to, named by the record itself, so the
      // page reads no committee list. Two queries at most, whatever the record.
      this.relatedCommittees(organizationId, [committee.parentCommitteeId, committee.reportingToCommitteeId], viewer),
    ]);
    const fact = facts.get(committee.id);
    return {
      ...committee,
      currentStageNameEn: fact?.stageNameEn ?? null,
      currentStageNameAr: fact?.stageNameAr ?? null,
      parent: committee.parentCommitteeId ? related.get(committee.parentCommitteeId) ?? null : null,
      reportsTo: committee.reportingToCommitteeId ? related.get(committee.reportingToCommitteeId) ?? null : null,
      isDissolving: fact?.isDissolving ?? false,
      typeValue: types.get(committee.typeValueId) ?? null,
      orgUnit,
      // ACC-255 — the same answer PR 2's writes will assert.
      stageRules: committeeStageRules(rules.get(committee.id)),
      mayWrite: access.write,
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

      const created = await tx.committee.create({
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
      // ACC-283 — the organisation's seat defaults, copied in the same
      // transaction, so a committee never exists without its seat actions.
      // Changing a default later never reaches this committee.
      const seatActions = await copyDefaultSeatActions(tx, organizationId, created.id);
      return { ...created, seatActions };
    });

    const { seatActions, ...created } = committee;
    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'Committee',
      objectId: created.id,
      actorId,
      tenantId: organizationId,
      after: created,
      metadata: { seatActions: seatActionMap(seatActions) },
    });

    // Ties the new Committee record to a live WorkflowInstance of the
    // already-shipped COMMITTEE workflow (ACC-9) — the 6-stage
    // FORMATION -> ... -> DISSOLVED lifecycle shell this ticket's plan
    // confirmed already exists and doesn't need reseeding.
    await this.workflowService.startInstance('COMMITTEE', created.id, organizationId, actorId);

    return created;
  }

  async updateCommittee(
    id: string,
    dto: UpdateCommitteeDto,
    organizationId: string,
    actorId: string,
    viewerPermissions: readonly string[],
  ): Promise<ICommittee> {
    // ACC-281 — the action's own permission was checked at the route; this adds
    // "committees:view OR an active member of THIS committee". Anyone else gets the
    // identical 404 a missing committee gets. The stage rules still apply below.
    await assertMayWriteCommittee(this.prisma, id, organizationId, { id: actorId, permissions: viewerPermissions });
    // ACC-233 — ONE transaction. An update that sets a parent or reports-to
    // first takes the organisation's hierarchy lock, so two edits saved at the
    // same moment cannot close a loop between them (lockCommitteeHierarchy()).
    const touchesHierarchy = dto.parentCommitteeId !== undefined || dto.reportingToCommitteeId !== undefined;

    const { existing, committee } = await this.prisma.$transaction(async (tx) => {
      // A committee that does not exist (or is another organisation's) is the
      // same 404 as before, ahead of any stage answer. No lock is taken here.
      await this.assertCommitteeExists(tx, id, organizationId);

      // ACC-241 (ACC-255 §4.5) — the stage must allow a direct edit. Its answer
      // is read FOR SHARE of the committee's workflow INSTANCE, FIRST: a
      // transition (Submit for Approval) locks the instance and then reads the
      // committee, so taking the instance before the committee row is the
      // engine's order and the two cannot deadlock (step-238 §7).
      await this.assertStage(tx, id, COMMITTEE_ACTIONS.EDIT_DETAILS, organizationId);

      if (touchesHierarchy) await lockCommitteeHierarchy(tx, organizationId);

      // ACC-238 — the committee's row lock, after the instance and hierarchy
      // locks (always in that order), so two saves of one committee queue here
      // and the second reads the first's `updatedAt`. Scoped by organisation.
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

  // ── Seat actions (ACC-283) ───────────────────────────────────────────────────

  /**
   * What each seat allows on this committee. Readable by whoever may see the
   * committee (committees:view, or an active member of it: ACC-281).
   */
  async getSeatActions(committeeId: string, organizationId: string, viewer: CommitteeViewer): Promise<ICommitteeSeatActions> {
    await assertMaySeeCommittee(this.prisma, committeeId, organizationId, viewer);
    const committee = await this.prisma.committee.findFirst({
      where: { id: committeeId, organizationId },
      select: { id: true, updatedAt: true },
    });
    if (!committee) throw new NotFoundException('Committee not found');
    return this.seatActionsView(this.prisma, committee, organizationId);
  }

  /**
   * Replaces the whole map. Part of the committee's terms of reference, so it is
   * edited only where the stage allows a direct edit (seeded: Formation); after
   * that, through an approved change request (ACC-283 PR 5).
   *
   * Access first (committees:edit_details at the route; committees:view or
   * membership here, else the identical 404), then ONE transaction in the
   * engine's order: the stage (FOR SHARE of the instance), the committee row
   * FOR UPDATE, the stale check, the seats, the write. A save that changes
   * nothing writes nothing and leaves no audit row. Rows of a seat the
   * organisation no longer uses are left as they are.
   */
  async replaceSeatActions(
    committeeId: string,
    dto: ReplaceSeatActionsDto,
    organizationId: string,
    actorId: string,
    viewerPermissions: readonly string[],
  ): Promise<ICommitteeSeatActions> {
    await assertMayWriteCommittee(this.prisma, committeeId, organizationId, { id: actorId, permissions: viewerPermissions });
    const wanted = normaliseSeatActions(dto.seats);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.assertCommitteeExists(tx, committeeId, organizationId);
      await this.assertStage(tx, committeeId, COMMITTEE_ACTIONS.EDIT_DETAILS, organizationId);
      await this.lockCommitteeRow(tx, committeeId, organizationId);

      const before = await tx.committee.findFirst({ where: { id: committeeId, organizationId }, select: { id: true, updatedAt: true } });
      if (!before) throw new NotFoundException('Committee not found');
      if (new Date(dto.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()) throw new CommitteeChangedException();

      const seats = await seatValues(tx, organizationId);
      const used = new Set(seats.map((s) => s.id));
      for (const roleValueId of wanted.keys()) {
        if (!used.has(roleValueId)) throw new SeatActionRefusal('SEAT_ACTION_SEAT_UNKNOWN', { roleValueId });
      }

      const stored = (await tx.committeeSeatAction.findMany({
        where: { organizationId, committeeId },
        select: { id: true, roleValueId: true, actionKey: true },
      })).filter((r) => used.has(r.roleValueId));
      const pair = (roleValueId: string, actionKey: string) => `${roleValueId} ${actionKey}`;
      const want = new Set([...wanted].flatMap(([seat, actions]) => [...actions].map((a) => pair(seat, a))));
      const have = new Set(stored.map((r) => pair(r.roleValueId, r.actionKey)));
      const remove = stored.filter((r) => !want.has(pair(r.roleValueId, r.actionKey)));
      const add = [...wanted].flatMap(([roleValueId, actions]) =>
        [...actions].filter((actionKey) => !have.has(pair(roleValueId, actionKey))).map((actionKey) => ({ roleValueId, actionKey })),
      );
      if (remove.length === 0 && add.length === 0) return { committee: before, seats, changed: null };

      if (remove.length > 0) {
        await tx.committeeSeatAction.deleteMany({ where: { organizationId, committeeId, id: { in: remove.map((r) => r.id) } } });
      }
      if (add.length > 0) {
        await tx.committeeSeatAction.createMany({ data: add.map((r) => ({ organizationId, committeeId, ...r })) });
      }
      // Seat actions are part of the terms of reference: the save is stale
      // against the details and the other way round.
      const committee = await tx.committee.update({
        where: { id: committeeId },
        data: { updatedAt: new Date() },
        select: { id: true, updatedAt: true },
      });
      const after = await seatActionsFor(tx, organizationId, [committeeId]);
      return {
        committee,
        seats,
        changed: {
          before: seatActionMap(stored),
          after: seatActionMap(after.filter((r) => used.has(r.roleValueId))),
        },
      };
    });

    if (outcome.changed) {
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: 'Committee',
        objectId: committeeId,
        actorId,
        tenantId: organizationId,
        before: { seatActions: outcome.changed.before },
        after: { seatActions: outcome.changed.after },
        metadata: { change: 'seat_actions' },
      });
    }
    return this.seatActionsView(this.prisma, outcome.committee, organizationId, outcome.seats);
  }

  /** The response: every seat the organisation uses, in seat order, with its stored actions. */
  private async seatActionsView(
    client: Pick<PrismaService, '$queryRaw' | 'committeeSeatAction'>,
    committee: { id: string; updatedAt: Date },
    organizationId: string,
    knownSeats?: Awaited<ReturnType<typeof seatValues>>,
  ): Promise<ICommitteeSeatActions> {
    const [seats, rows] = await Promise.all([
      knownSeats ?? seatValues(client, organizationId),
      seatActionsFor(client, organizationId, [committee.id]),
    ]);
    const map = seatActionMap(rows);
    return {
      committeeId: committee.id,
      updatedAt: committee.updatedAt,
      actionKeys: [...SEAT_ACTION_KEYS],
      seats: seats.map((s) => ({ id: s.id, key: s.key, labelEn: s.labelEn, labelAr: s.labelAr, actions: map[s.id] ?? [] })),
    };
  }

  // ── Membership Management (NOT workflow transitions — module-designs.md) ────

  async listMembers(committeeId: string, organizationId: string, viewer: CommitteeViewer): Promise<ICommitteeMember[]> {
    await assertMaySeeCommittee(this.prisma, committeeId, organizationId, viewer); // ACC-281
    await this.getCommitteeById(committeeId, organizationId); // validates committee belongs to org
    return this.prisma.committeeMember.findMany({
      where: { committeeId, organizationId, isActive: true },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async listMembershipEvents(
    committeeId: string,
    organizationId: string,
    viewer: CommitteeViewer,
  ): Promise<ICommitteeMembershipEvent[]> {
    // ACC-281 — a member sees all of their committee's details, history included (Ahmad, 7 Nov).
    await assertMaySeeCommittee(this.prisma, committeeId, organizationId, viewer);
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
    viewerPermissions: readonly string[],
  ): Promise<ICommitteeMember> {
    // ACC-281 — the action's own permission was checked at the route; this adds
    // "committees:view OR an active member of THIS committee". Anyone else gets the
    // identical 404 a missing committee gets. The stage rules still apply below.
    await assertMayWriteCommittee(this.prisma, committeeId, organizationId, { id: actorId, permissions: viewerPermissions });
    await this.getCommitteeById(committeeId, organizationId);
    await this.validateUserReference(dto.userId, organizationId);

    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();

    // ACC-255 PR 2 — one transaction, so the stage's answer (read FOR SHARE of
    // the instance) holds until the member is written: a transition into
    // Dissolved in flight finishes first, and one started now waits for this.
    const { existing, member } = await this.prisma.$transaction(async (tx) => {
      await this.assertStage(tx, committeeId, COMMITTEE_ACTIONS.ADD_MEMBER, organizationId);

      // No isActive filter here — a departed member's row must be found too,
      // so a rejoin reactivates it in place (mirroring RoleService.reactivateRole())
      // instead of hitting @@unique([committeeId, userId]) on create().
      const existing = await tx.committeeMember.findFirst({
        where: { committeeId, userId: dto.userId, organizationId },
      });
      if (existing?.isActive) {
        throw new ConflictException('This user is already an active member of this committee');
      }

      const member = existing
        ? await tx.committeeMember.update({
            where: { id: existing.id },
            data: {
              roleValueId: dto.roleValueId,
              isActive: true,
              leftAt: null,
              joinedAt: effectiveDate,
            },
          })
        : await tx.committeeMember.create({
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

      await tx.committeeMembershipEvent.create({
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
      return { existing, member };
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
    viewerPermissions: readonly string[],
  ): Promise<ICommitteeMember> {
    // ACC-281 — the action's own permission was checked at the route; this adds
    // "committees:view OR an active member of THIS committee". Anyone else gets the
    // identical 404 a missing committee gets. The stage rules still apply below.
    await assertMayWriteCommittee(this.prisma, committeeId, organizationId, { id: actorId, permissions: viewerPermissions });
    await this.getCommitteeById(committeeId, organizationId);
    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();

    // ACC-255 PR 2 — the stage first (FOR SHARE of the instance), then the
    // member: a missing member is still a 404 only where the stage allows it.
    const { existing, member } = await this.prisma.$transaction(async (tx) => {
      const rules = await this.assertStage(tx, committeeId, COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE, organizationId);
      // ACC-286 — then the committee row, so two writes emptying one seat queue.
      await this.lockCommitteeRow(tx, committeeId, organizationId);
      const existing = await this.getActiveMember(committeeId, memberId, organizationId, tx);
      if (dto.roleValueId !== existing.roleValueId) {
        await this.assertSeatStaysFilled(tx, rules, committeeId, existing, organizationId);
      }

      const member = await tx.committeeMember.update({
        where: { id: memberId },
        data: { roleValueId: dto.roleValueId },
      });

      await tx.committeeMembershipEvent.create({
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
      return { existing, member };
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
    viewerPermissions: readonly string[],
  ): Promise<void> {
    // ACC-281 — the action's own permission was checked at the route; this adds
    // "committees:view OR an active member of THIS committee". Anyone else gets the
    // identical 404 a missing committee gets. The stage rules still apply below.
    await assertMayWriteCommittee(this.prisma, committeeId, organizationId, { id: actorId, permissions: viewerPermissions });
    await this.getCommitteeById(committeeId, organizationId);
    const effectiveDate = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();

    // ACC-255 PR 2 — the stage first (FOR SHARE of the instance), then the member.
    const { existing, member } = await this.prisma.$transaction(async (tx) => {
      const rules = await this.assertStage(tx, committeeId, COMMITTEE_ACTIONS.REMOVE_MEMBER, organizationId);
      // ACC-286 — then the committee row, so two writes emptying one seat queue.
      await this.lockCommitteeRow(tx, committeeId, organizationId);
      const existing = await this.getActiveMember(committeeId, memberId, organizationId, tx);
      await this.assertSeatStaysFilled(tx, rules, committeeId, existing, organizationId);

      // isActive derived STRICTLY from leftAt (ACC-22 Pending Discussion #6)
      // — never set independently of it.
      const member = await tx.committeeMember.update({
        where: { id: memberId },
        data: { leftAt: effectiveDate, isActive: false },
      });

      await tx.committeeMembershipEvent.create({
        data: {
          organizationId,
          committeeId,
          userId: existing.userId,
          roleValueId: existing.roleValueId,
          action: 'LEFT',
          effectiveDate,
          // ACC-298 — required, and trimmed by the DTO; trimmed again here so a
          // caller inside the app that skips the DTO stores the same value.
          reason: dto.reason.trim(),
          approvedBy: actorId,
        },
      });
      return { existing, member };
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

  /**
   * ACC-255 PR 2 — refuses 409 STAGE_ACTION_NOT_ALLOWED, naming the stage, when
   * the committee's current stage does not allow `action`. Reads FOR SHARE of
   * the committee's workflow instance, so it must run inside the transaction
   * that writes, and BEFORE the committee row lock (instance, then committee).
   * A committee with no instance allows nothing (D14).
   */
  private assertStage(tx: CommitteeTx, committeeId: string, action: string, organizationId: string): Promise<StageRules> {
    return this.stageRules.assertStageAllows('COMMITTEE', committeeId, action, organizationId, tx, {
      lock: 'share',
      message: (stageNameEn) => committeeStageRefusalMessage(action, stageNameEn),
    });
  }

  /**
   * ACC-286 — the committee row FOR UPDATE, AFTER the instance (assertStage):
   * the engine's order, and updateCommittee()'s. It is what makes "the last
   * holder of a seat" a fact rather than a race — two removals of the two
   * Chairmen at once would otherwise each see the other still seated — and
   * what a going-live transition's FOR SHARE read of the row waits on.
   */
  private async lockCommitteeRow(tx: CommitteeTx, committeeId: string, organizationId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Committee" WHERE id = ${committeeId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  }

  /**
   * ACC-286 — rule 3: while the committee is IN FORCE (its stage's flag, never
   * a key), a member write may not empty a required seat. Refused 409
   * COMMITTEE_REQUIRED_SEAT_LAST_HOLDER, naming the seat, when `leaving` fills
   * a required seat and nobody else does. A member whose user is not ACTIVE
   * fills nothing (committee-seat-rules.ts), so removing them empties nothing
   * and is never refused — that is how an administrator clears a departed
   * Chairman. Outside IN_FORCE a seat may empty; going live checks it again.
   */
  private async assertSeatStaysFilled(
    tx: CommitteeTx,
    rules: StageRules,
    committeeId: string,
    leaving: ICommitteeMember,
    organizationId: string,
  ): Promise<void> {
    if (!rules.flags.includes(STAGE_FLAG.IN_FORCE)) return;
    const seat = (await requiredSeats(tx, organizationId)).find((s) => s.id === leaving.roleValueId);
    if (!seat) return;
    const holders = await seatHolders(tx, organizationId, committeeId, [seat.id]);
    if (!holders.some((h) => h.memberId === leaving.id)) return;
    if (holders.some((h) => h.memberId !== leaving.id)) return;
    this.logger.log(
      `Refused, last holder of a required seat: committeeId=${committeeId} memberId=${leaving.id} seatId=${seat.id} organizationId=${organizationId}`,
    );
    throw new CommitteeSeatRefusal(seat);
  }

  private async assertCommitteeExists(tx: CommitteeTx, id: string, organizationId: string): Promise<void> {
    const found = await tx.committee.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!found) throw new NotFoundException('Committee not found');
  }

  private async getActiveMember(
    committeeId: string,
    memberId: string,
    organizationId: string,
    client: Pick<CommitteeTx, 'committeeMember'> = this.prisma,
  ): Promise<ICommitteeMember> {
    const member = await client.committeeMember.findFirst({
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

  /**
   * ACC-281 — other committees this record names (parent, Reports to), each with
   * whether the viewer may open it: committees:view, an active member of it, or
   * (ACC-283 PR 2a) its overseer. One read for the names and, only without
   * committees:view, readableCommitteeIds() once.
   */
  private async relatedCommittees(
    organizationId: string,
    ids: (string | null)[],
    viewer: CommitteeViewer,
  ): Promise<Map<string, ICommitteeRef>> {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (wanted.length === 0) return new Map();
    const [rows, readable] = await Promise.all([
      this.prisma.committee.findMany({ where: { id: { in: wanted }, organizationId }, select: { id: true, nameEn: true, nameAr: true } }),
      readableCommitteeIds(this.prisma, organizationId, viewer, wanted),
    ]);
    return new Map(rows.map((r) => [r.id, { ...r, mayOpen: readable.has(r.id) }]));
  }
}
