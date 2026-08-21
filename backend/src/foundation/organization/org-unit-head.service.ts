import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { UserService } from '../user/user.service';
import { OrganizationService } from './organization.service';
import { DeclareHandoverDto } from './dto/declare-handover.dto';
import { AssignHeadDto } from './dto/assign-head.dto';
import { AssignActingHeadDto } from './dto/assign-acting-head.dto';
import { IOrgUnitHeadStatus } from './interfaces/org-unit-head-status.interface';

// ACC-40 Section 2.3 — Deliberate Handover. A handover is not a change to
// a separately-stored "who is Head" fact — it is a declared, temporary,
// logged exception that grants the incoming successor the same
// isUnitHeadPosition: true position the outgoing holder already holds,
// before the outgoing holder's own holding of it ends. During the open
// window, Section 2.2's derivation query genuinely returns both users —
// this IS the "declared dual-holder transition period," with no special
// casing anywhere else in the system.
@Injectable()
export class OrgUnitHeadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    // Same module (OrganizationModule provides both) — no forwardRef
    // needed. ACC-40 Section 2.5.1 gap fix (found while starting Phase 6
    // commit 4): every method below mutates User.positionId directly via
    // this.prisma.user.update(), never through UserService.updateProfile()
    // — so refreshOrgUnitHeadVacancy()'s Phase 6 commit 2 wiring (which
    // only covers updateProfile()/deactivate()/deactivatePosition()) never
    // fired for the dedicated Head-management endpoints. Every method that
    // touches positionId below now calls it directly.
    private readonly organizationService: OrganizationService,
  ) {}

  // ACC-40 Section 2.2 — a read-only projection for UI consumption
  // (Phase 5 commit 7's necessary companion: the frontend needs to know
  // current state to decide which actions to offer). "holders" is
  // Section 2.2's own live derivation query, never the cached
  // isHeadVacant field — that stays inert until Phase 6 wires
  // refreshOrgUnitHeadVacancy() against it.
  async getHeadStatus(orgUnitId: string, organizationId: string): Promise<IOrgUnitHeadStatus> {
    const orgUnit = await this.getOrgUnitOrThrow(orgUnitId, organizationId);

    const holders = await this.prisma.user.findMany({
      where: {
        organizationId,
        primaryOrgUnitId: orgUnitId,
        status: 'ACTIVE',
        position: { isUnitHeadPosition: true },
      },
      select: { id: true, name: true, positionId: true },
    });

    return {
      holders,
      pendingHeadUserId: orgUnit.pendingHeadUserId,
      headHandoverEffectiveDate: orgUnit.headHandoverEffectiveDate,
    };
  }

  async declareHandover(
    orgUnitId: string,
    dto: DeclareHandoverDto,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const orgUnit = await this.getOrgUnitOrThrow(orgUnitId, organizationId);
    if (orgUnit.pendingHeadUserId) {
      throw new ConflictException('A handover is already in progress for this unit');
    }

    // Section 2.2's own derivation query — the current Head, if any.
    const outgoingHolder = await this.prisma.user.findFirst({
      where: {
        organizationId,
        primaryOrgUnitId: orgUnitId,
        status: 'ACTIVE',
        position: { isUnitHeadPosition: true },
      },
    });
    if (!outgoingHolder) {
      throw new ConflictException(
        'This unit has no current Head to hand over from — use direct assignment instead',
      );
    }

    const incomingUser = await this.prisma.user.findFirst({
      where: { id: dto.incomingUserId, organizationId, status: 'ACTIVE' },
      include: { position: true },
    });
    if (!incomingUser) {
      throw new NotFoundException('Incoming successor not found or not active in this tenant');
    }
    if (incomingUser.id === outgoingHolder.id) {
      throw new BadRequestException('The incoming successor must be a different person than the current Head');
    }

    // Plan's own step 1 wording: "an ordinary check, unrelated to this
    // handover." Silently overwriting positionId below would otherwise
    // orphan whatever OTHER unit this person currently heads, with no
    // VACATED/HANDOVER event recorded for it — a real audit-trail gap,
    // not just a theoretical one.
    if (incomingUser.position?.isUnitHeadPosition) {
      throw new ConflictException(
        'The incoming successor already holds a different Head-conferring position — resolve that first',
      );
    }

    // Precondition, not a side effect: declareHandover() only ever sets
    // positionId (plan's own literal step 2) — it never touches
    // primaryOrgUnitId. A future implementer must not "improve" this into
    // silently moving the incoming successor's unit as a convenience;
    // that's a materially different, undocumented behavior change.
    if (incomingUser.primaryOrgUnitId !== orgUnitId) {
      throw new BadRequestException('The incoming successor must already belong to this org unit');
    }

    const effectiveDate = new Date(dto.effectiveDate);
    const headPositionId = outgoingHolder.positionId as string; // guaranteed non-null: position.isUnitHeadPosition matched above

    // Deliberately violates 2.1's/2.2's normal caps — only for this
    // specific pair, only through this one dedicated code path.
    await this.userService.validatePositionAssignment(
      headPositionId,
      orgUnitId,
      organizationId,
      incomingUser.id,
      true, // isDeclaredHandoverBypass
    );

    await this.prisma.user.update({
      where: { id: incomingUser.id },
      data: { positionId: headPositionId },
    });

    await this.prisma.orgUnit.update({
      where: { id: orgUnitId },
      data: { pendingHeadUserId: incomingUser.id, headHandoverEffectiveDate: effectiveDate },
    });

    await this.prisma.orgUnitHeadEvent.create({
      data: {
        organizationId,
        orgUnitId,
        userId: incomingUser.id,
        positionId: headPositionId,
        action: 'HANDOVER_DECLARED',
        effectiveDate,
        reason: dto.reason ?? null,
        approvedBy: actorId,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: orgUnitId,
      metadata: { handoverDeclared: true, incomingUserId: incomingUser.id, outgoingUserId: outgoingHolder.id },
    });

    await this.organizationService.refreshOrgUnitHeadVacancy(orgUnitId, organizationId);

    // ACC-40 Section 2.6.4/2.6.5 — the incoming successor genuinely holds
    // the position from this moment (2.3's own "declared dual-holder
    // transition period"), so their role grant fires now, not at
    // completion. The outgoing holder is untouched here — they keep their
    // position (and role) until performHandoverCompletion() below clears it.
    await this.userService.syncHeadAuthorityRoleGrant(
      incomingUser.id,
      incomingUser.positionId,
      orgUnitId,
      headPositionId,
      orgUnitId,
      organizationId,
      actorId,
    );
  }

  // Explicit early completion — for the case where the successor is ready
  // before the declared date. Identical clear-outgoing-holder + cache-clear
  // + HANDOVER_COMPLETED event as the automatic sweep path (Phase 5
  // commit 5), which also calls performHandoverCompletion() below.
  async completeHandoverNow(orgUnitId: string, organizationId: string, actorId: string): Promise<void> {
    const orgUnit = await this.getOrgUnitOrThrow(orgUnitId, organizationId);
    if (!orgUnit.pendingHeadUserId) {
      throw new ConflictException('No handover is currently in progress for this unit');
    }

    await this.performHandoverCompletion(orgUnit, organizationId, actorId);
  }

  // Reverts the INCOMING successor's positionId grant — the original
  // outgoing holder remains the sole Head, unaffected. No stored history
  // of what the incoming successor held before this handover (the schema
  // deliberately carries no such field, matching the plan's own approved
  // schema) — reverts to null, not a resurrected prior value.
  async cancelHandover(orgUnitId: string, organizationId: string, actorId: string): Promise<void> {
    const orgUnit = await this.getOrgUnitOrThrow(orgUnitId, organizationId);
    if (!orgUnit.pendingHeadUserId) {
      throw new ConflictException('No handover is currently in progress for this unit');
    }

    const incomingUserId = orgUnit.pendingHeadUserId;
    const incomingUser = await this.prisma.user.findFirst({
      where: { id: incomingUserId, organizationId },
    });

    await this.prisma.user.update({
      where: { id: incomingUserId },
      data: { positionId: null },
    });

    await this.prisma.orgUnit.update({
      where: { id: orgUnitId },
      data: { pendingHeadUserId: null, headHandoverEffectiveDate: null },
    });

    await this.prisma.orgUnitHeadEvent.create({
      data: {
        organizationId,
        orgUnitId,
        userId: incomingUserId,
        positionId: incomingUser?.positionId ?? null,
        action: 'HANDOVER_CANCELLED',
        effectiveDate: new Date(),
        approvedBy: actorId,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: orgUnitId,
      metadata: { handoverCancelled: true, incomingUserId },
    });

    await this.organizationService.refreshOrgUnitHeadVacancy(orgUnitId, organizationId);

    // ACC-40 Section 2.6.4/2.6.5 — reverts declareHandover()'s own grant.
    // incomingUser.positionId here is the pre-update (declared) value —
    // exactly what was granted at declare time.
    if (incomingUser) {
      await this.userService.syncHeadAuthorityRoleGrant(
        incomingUserId,
        incomingUser.positionId,
        orgUnitId,
        null,
        null,
        organizationId,
        actorId,
      );
    }
  }

  // ACC-40 Section 2.3 — the automatic half of "what closes the window,
  // recommend both, not a single mechanism" (the other being explicit
  // early completion via completeHandoverNow() above). Called by
  // SlaMonitorProcessor's sweep for every open handover past its declared
  // effectiveDate — actorId is null, no human actor triggers this,
  // matching sweepExpiredActingOrgUnitAssignments()'s own precedent. Thin
  // wrapper reusing the exact same shared completion logic as the
  // explicit path — no behavioral difference between the two beyond who
  // (or what) triggered it.
  async completeHandoverAutomatically(
    orgUnit: { id: string; pendingHeadUserId: string | null },
    organizationId: string,
  ): Promise<void> {
    await this.performHandoverCompletion(orgUnit, organizationId, null);
  }

  // Shared by completeHandoverNow() (explicit early completion) and
  // completeHandoverAutomatically() (the sweep, above) — actorId is null
  // for the automatic path, matching
  // sweepExpiredActingOrgUnitAssignments()'s own no-human-actor precedent.
  private async performHandoverCompletion(
    orgUnit: { id: string; pendingHeadUserId: string | null },
    organizationId: string,
    actorId: string | null,
  ): Promise<void> {
    const pendingHeadUserId = orgUnit.pendingHeadUserId as string; // callers already confirmed set

    // Exactly two people hold the head position in this unit during an
    // open handover — the outgoing holder and the incoming successor
    // (pendingHeadUserId). The outgoing holder is whichever one is not
    // pendingHeadUserId.
    const currentHolders = await this.prisma.user.findMany({
      where: {
        organizationId,
        primaryOrgUnitId: orgUnit.id,
        status: 'ACTIVE',
        position: { isUnitHeadPosition: true },
      },
    });
    const outgoingHolder = currentHolders.find((u) => u.id !== pendingHeadUserId);
    const incomingHolder = currentHolders.find((u) => u.id === pendingHeadUserId);

    if (outgoingHolder) {
      await this.prisma.user.update({
        where: { id: outgoingHolder.id },
        data: { positionId: null },
      });
    }

    await this.prisma.orgUnit.update({
      where: { id: orgUnit.id },
      data: { pendingHeadUserId: null, headHandoverEffectiveDate: null },
    });

    await this.prisma.orgUnitHeadEvent.create({
      data: {
        organizationId,
        orgUnitId: orgUnit.id,
        userId: pendingHeadUserId,
        positionId: incomingHolder?.positionId ?? null,
        action: 'HANDOVER_COMPLETED',
        effectiveDate: new Date(),
        approvedBy: actorId,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId: actorId ?? undefined,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: orgUnit.id,
      metadata: {
        handoverCompleted: true,
        incomingUserId: pendingHeadUserId,
        outgoingUserId: outgoingHolder?.id ?? null,
      },
    });

    await this.organizationService.refreshOrgUnitHeadVacancy(orgUnit.id, organizationId);

    // ACC-40 Section 2.6.4/2.6.5 — the outgoing holder's positionId was
    // just cleared above; revoke whatever role that holding granted them.
    // The incoming successor's own role was already granted at declare
    // time (declareHandover()) — nothing changes for them here, their
    // positionId is untouched by this method.
    if (outgoingHolder) {
      await this.userService.syncHeadAuthorityRoleGrant(
        outgoingHolder.id,
        outgoingHolder.positionId,
        orgUnit.id,
        null,
        null,
        organizationId,
        actorId,
      );
    }
  }

  // ACC-40 Section 2.3 — direct appointment, no handover: "e.g. filling a
  // vacancy." positionId is caller-supplied (a vacant unit has no
  // outgoing holder to copy it from, unlike declareHandover()). Reuses
  // the ORDINARY (non-bypassed) validatePositionAssignment() — its own
  // 2.1 single-assignee cap and 2.2 cross-position head-uniqueness check
  // together already guarantee the unit is vacant of Head authority
  // before this proceeds; no separate manual vacancy check needed.
  async assignHead(
    orgUnitId: string,
    dto: AssignHeadDto,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const orgUnit = await this.getOrgUnitOrThrow(orgUnitId, organizationId);
    if (orgUnit.pendingHeadUserId) {
      throw new ConflictException('A handover is already in progress for this unit — cannot directly assign a Head');
    }

    const position = await this.prisma.orgPosition.findFirst({
      where: { id: dto.positionId, organizationId },
    });
    if (!position) throw new NotFoundException('Position not found in this organization');
    if (!position.isUnitHeadPosition) {
      throw new BadRequestException('The selected position does not confer Head authority');
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: dto.userId, organizationId, status: 'ACTIVE' },
    });
    if (!targetUser) throw new NotFoundException('User not found or not active in this tenant');
    if (targetUser.primaryOrgUnitId !== orgUnitId) {
      throw new BadRequestException('The user must already belong to this org unit');
    }

    await this.userService.validatePositionAssignment(dto.positionId, orgUnitId, organizationId, targetUser.id);

    await this.prisma.user.update({
      where: { id: targetUser.id },
      data: { positionId: dto.positionId },
    });

    await this.prisma.orgUnitHeadEvent.create({
      data: {
        organizationId,
        orgUnitId,
        userId: targetUser.id,
        positionId: dto.positionId,
        action: 'ASSIGNED',
        effectiveDate: new Date(),
        approvedBy: actorId,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: orgUnitId,
      metadata: { headAssigned: true, userId: targetUser.id, positionId: dto.positionId },
    });

    await this.organizationService.refreshOrgUnitHeadVacancy(orgUnitId, organizationId);

    // ACC-40 Section 2.6.4/2.6.5 — old = whatever targetUser held before
    // (their primaryOrgUnitId is already validated === orgUnitId above),
    // new = the position just assigned. Reuses UserService's shared
    // sync helper — same reasoning as validatePositionAssignment() above,
    // one mechanism, not a duplicate implementation.
    await this.userService.syncHeadAuthorityRoleGrant(
      targetUser.id,
      targetUser.positionId,
      orgUnitId,
      dto.positionId,
      orgUnitId,
      organizationId,
      actorId,
    );
  }

  // ACC-40 Section 2.3 — "a deliberate divergence from the RoleService
  // precedent": a Unit Head is NOT unconditionally lockout-protected like
  // the last TENANT_ADMIN — a unit CAN legitimately be headless for a
  // period. This does not block clearing a Head-position holder with no
  // handover declared; it writes a VACATED event and lets Section 2.5's
  // vacancy-detection-and-escalation mechanism (Phase 6) be the actual
  // safety net, rather than a hard block preventing the removal.
  async vacateHead(orgUnitId: string, organizationId: string, actorId: string): Promise<void> {
    const orgUnit = await this.getOrgUnitOrThrow(orgUnitId, organizationId);
    if (orgUnit.pendingHeadUserId) {
      throw new ConflictException('A handover is in progress for this unit — cancel or complete it first');
    }

    const currentHolder = await this.prisma.user.findFirst({
      where: { organizationId, primaryOrgUnitId: orgUnitId, status: 'ACTIVE', position: { isUnitHeadPosition: true } },
    });
    if (!currentHolder) {
      throw new ConflictException('This unit has no active Head to vacate');
    }

    await this.prisma.user.update({
      where: { id: currentHolder.id },
      data: { positionId: null },
    });

    await this.prisma.orgUnitHeadEvent.create({
      data: {
        organizationId,
        orgUnitId,
        userId: currentHolder.id,
        positionId: currentHolder.positionId,
        action: 'VACATED',
        effectiveDate: new Date(),
        approvedBy: actorId,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: orgUnitId,
      metadata: { headVacated: true, userId: currentHolder.id },
    });

    await this.organizationService.refreshOrgUnitHeadVacancy(orgUnitId, organizationId);

    // ACC-40 Section 2.6.4/2.6.5 — revoke only, new = (null, null).
    await this.userService.syncHeadAuthorityRoleGrant(
      currentHolder.id,
      currentHolder.positionId,
      orgUnitId,
      null,
      null,
      organizationId,
      actorId,
    );
  }

  // ACC-40 Section 2.6 — Acting Head: coverage for head-of-unit authority
  // specifically, during an absence or a not-yet-resolved vacancy — never
  // a position-holding grant (no positionId anywhere in this method,
  // unlike assignHead()). Only assignable when the unit genuinely has no
  // real position-holder and no handover in progress — a real Head should
  // always be assigned directly via assignHead(), not shadowed by Acting
  // Head coverage sitting alongside it.
  async assignActingHead(
    orgUnitId: string,
    dto: AssignActingHeadDto,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const orgUnit = await this.getOrgUnitOrThrow(orgUnitId, organizationId);
    if (orgUnit.pendingHeadUserId) {
      throw new ConflictException('A handover is in progress for this unit — cannot assign Acting Head coverage');
    }
    if (orgUnit.actingHeadUserId) {
      throw new ConflictException('An Acting Head is already assigned for this unit — clear it first');
    }

    const currentHolder = await this.prisma.user.findFirst({
      where: { organizationId, primaryOrgUnitId: orgUnitId, status: 'ACTIVE', position: { isUnitHeadPosition: true } },
    });
    if (currentHolder) {
      throw new ConflictException('This unit already has an active Head — Acting Head coverage is only for a vacant unit');
    }

    const actingUser = await this.prisma.user.findFirst({
      where: { id: dto.userId, organizationId, status: 'ACTIVE' },
    });
    if (!actingUser) {
      throw new NotFoundException('User not found or not active in this tenant');
    }

    await this.prisma.orgUnit.update({
      where: { id: orgUnitId },
      data: { actingHeadUserId: actingUser.id },
    });

    await this.prisma.orgUnitHeadEvent.create({
      data: {
        organizationId,
        orgUnitId,
        userId: actingUser.id,
        positionId: null, // ACTING_* events never carry a position — 2.3's schema note
        action: 'ACTING_ASSIGNED',
        effectiveDate: new Date(),
        reason: dto.reason ?? null,
        approvedBy: actorId,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: orgUnitId,
      metadata: { actingHeadAssigned: true, userId: actingUser.id },
    });

    await this.organizationService.refreshOrgUnitHeadVacancy(orgUnitId, organizationId);
  }

  // Ends Acting Head coverage — the unit reverts to whatever
  // refreshOrgUnitHeadVacancy() recomputes it to be (still vacant if no
  // real Head was assigned in the meantime, resolved if one was).
  async clearActingHead(orgUnitId: string, organizationId: string, actorId: string): Promise<void> {
    const orgUnit = await this.getOrgUnitOrThrow(orgUnitId, organizationId);
    if (!orgUnit.actingHeadUserId) {
      throw new ConflictException('No Acting Head is currently assigned for this unit');
    }

    const actingHeadUserId = orgUnit.actingHeadUserId;

    await this.prisma.orgUnit.update({
      where: { id: orgUnitId },
      data: { actingHeadUserId: null },
    });

    await this.prisma.orgUnitHeadEvent.create({
      data: {
        organizationId,
        orgUnitId,
        userId: actingHeadUserId,
        positionId: null,
        action: 'ACTING_ENDED',
        effectiveDate: new Date(),
        approvedBy: actorId,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'OrgUnit',
      objectId: orgUnitId,
      metadata: { actingHeadEnded: true, userId: actingHeadUserId },
    });

    await this.organizationService.refreshOrgUnitHeadVacancy(orgUnitId, organizationId);
  }

  private async getOrgUnitOrThrow(id: string, organizationId: string) {
    const orgUnit = await this.prisma.orgUnit.findFirst({ where: { id, organizationId } });
    if (!orgUnit) throw new NotFoundException('Org unit not found');
    return orgUnit;
  }
}
