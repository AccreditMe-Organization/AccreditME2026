import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RECORD_VIEW_PERMISSION } from '../../common/services/object-visibility.service';
import { taskKeyOf } from './task-record-types';
import { findRunningActingCover, findUnitsCoveredBy } from '../organization/unit-headship';

// The client inside this.prisma.$transaction(…), or the service itself.
type AuthorityClient = Pick<PrismaService, 'user' | 'orgUnitHeadAssignment' | 'userRole'>;

/**
 * ACC-173 — who may act for a task's CREATOR. One rule, used by deciding an
 * extension or hold request, by reassign() (ACC-163) and by the assignment
 * picker's task-scoped gate (ACC-167). Do not write a second copy: three
 * hand-maintained versions of "is this the creator, or someone covering for
 * them?" would drift the way ACC-120's four last-admin checks did.
 *
 * ## canActForCreator — three people, nobody else
 *
 *   1. the creator;
 *   2. the creator's OUT-OF-OFFICE delegate (User.actingUserId), while the
 *      creator is out: both dates set and now inside them, inclusive — the
 *      same window WorkflowService.applyOutOfOfficeRouting() uses;
 *   3. the ACTING HEAD appointed for ABSENCE of a unit the creator heads
 *      substantively, read from the OrgUnitHeadAssignment PERIOD TABLE through
 *      unit-headship.ts (ACC-244): the cover in force on the unit
 *      (findRunningActingCover), held by the viewer, for ABSENCE. Never from
 *      the OrgUnit.actingHeadUserId cache, which is set before a future
 *      appointment starts and never expires (SYSTEM-REFERENCE §5).
 *
 * "Heads substantively" is the holder rule, because nothing writes SUBSTANTIVE
 * period rows: the creator is ACTIVE, holds a unit-head position, and that
 * unit is their primary unit.
 *
 * Manage tasks on the task's record type (ACC-244, where tasks:reassign was)
 * is NOT part of this rule. Each caller adds it where it applies: reassign and
 * deciding admit a holder outright; notifications and the decider inbox reach
 * holders only when the creator is no longer ACTIVE.
 */
@Injectable()
export class TaskAuthorityService {
  constructor(private readonly prisma: PrismaService) {}

  async canActForCreator(
    createdById: string,
    viewerId: string,
    organizationId: string,
    client: AuthorityClient = this.prisma,
    now: Date = new Date(),
  ): Promise<boolean> {
    if (createdById === viewerId) return true;
    const creator = await client.user.findFirst({
      where: { id: createdById, organizationId },
      select: {
        status: true,
        actingUserId: true,
        outOfOfficeFrom: true,
        outOfOfficeTo: true,
        primaryOrgUnitId: true,
        position: { select: { isUnitHeadPosition: true } },
      },
    });
    if (!creator) return false;

    if (creator.actingUserId === viewerId && isOutOfOffice(creator, now)) return true;

    const headedUnitId = substantiveHeadUnit(creator);
    if (!headedUnitId) return false;
    const cover = await findRunningActingCover(client, organizationId, headedUnitId, now);
    return cover?.userId === viewerId && cover.reason === 'ABSENCE';
  }

  /**
   * Everyone who may decide a request on this task and should be TOLD about
   * it: the creator and whoever covers them now — or, when the creator is no
   * longer ACTIVE, the holders of Manage tasks on the task's record type who
   * can see records of that type (ACC-244). Never the requester. ACTIVE users
   * only.
   */
  async decisionRecipients(
    createdById: string,
    requesterId: string,
    organizationId: string,
    sourceType: string,
    now: Date = new Date(),
  ): Promise<string[]> {
    const creator = await this.prisma.user.findFirst({
      where: { id: createdById, organizationId },
      select: {
        status: true,
        actingUserId: true,
        outOfOfficeFrom: true,
        outOfOfficeTo: true,
        primaryOrgUnitId: true,
        position: { select: { isUnitHeadPosition: true } },
      },
    });

    let candidates: string[];
    if (creator?.status === 'ACTIVE') {
      candidates = [createdById];
      if (creator.actingUserId && isOutOfOffice(creator, now)) candidates.push(creator.actingUserId);
      const headedUnitId = substantiveHeadUnit(creator);
      if (headedUnitId) {
        const cover = await findRunningActingCover(this.prisma, organizationId, headedUnitId, now);
        if (cover?.reason === 'ABSENCE') candidates.push(cover.userId);
      }
    } else {
      candidates = await this.manageHolderIds(organizationId, sourceType);
    }

    const unique = [...new Set(candidates)].filter((id) => id !== requesterId);
    if (unique.length === 0) return [];
    const active = await this.prisma.user.findMany({
      where: { organizationId, id: { in: unique }, status: 'ACTIVE' },
      select: { id: true },
    });
    return active.map((u) => u.id);
  }

  /**
   * The creators a viewer currently acts for (rules 2 and 3 above) — what the
   * decider inbox reads, alongside the viewer's own tasks.
   */
  async creatorsCoveredBy(viewerId: string, organizationId: string, now: Date = new Date()): Promise<string[]> {
    const [outOfOffice, actingUnitIds] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          organizationId,
          actingUserId: viewerId,
          outOfOfficeFrom: { lte: now },
          outOfOfficeTo: { gte: now },
        },
        select: { id: true },
      }),
      findUnitsCoveredBy(this.prisma, organizationId, viewerId, now, 'ABSENCE'),
    ]);
    const heads =
      actingUnitIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: {
              organizationId,
              status: 'ACTIVE',
              primaryOrgUnitId: { in: actingUnitIds },
              position: { isUnitHeadPosition: true },
            },
            select: { id: true },
          });
    return [...new Set([...outOfOffice.map((u) => u.id), ...heads.map((u) => u.id)])];
  }

  // ACTIVE holders of BOTH keys, each through any active role of theirs:
  // Manage tasks on the type, and the record type's own view permission — the
  // pair holdsTaskKey() requires (rule 1). Unknown type: nobody.
  private async manageHolderIds(organizationId: string, sourceType: string): Promise<string[]> {
    const manageKey = taskKeyOf(sourceType, 'MANAGE');
    const viewKey = RECORD_VIEW_PERMISSION[sourceType];
    if (!manageKey || !viewKey) return [];
    const holdersOf = async (key: string) => {
      const [module, action] = key.split(':') as [string, string];
      const rows = await this.prisma.userRole.findMany({
        where: {
          user: { organizationId, status: 'ACTIVE' },
          role: { organizationId, isActive: true, rolePermissions: { some: { permission: { module, action } } } },
        },
        select: { userId: true },
      });
      return new Set(rows.map((r) => r.userId));
    };
    const [manage, view] = await Promise.all([holdersOf(manageKey), holdersOf(viewKey)]);
    return [...manage].filter((id) => view.has(id));
  }
}

interface CreatorCoverFields {
  status: string;
  actingUserId: string | null;
  outOfOfficeFrom: Date | null;
  outOfOfficeTo: Date | null;
  primaryOrgUnitId: string | null;
  position: { isUnitHeadPosition: boolean } | null;
}

// Both dates set and now inside them, inclusive — applyOutOfOfficeRouting()'s
// window. An open-ended window is not out of office.
function isOutOfOffice(user: CreatorCoverFields, now: Date): boolean {
  return (
    !!user.outOfOfficeFrom && !!user.outOfOfficeTo && user.outOfOfficeFrom <= now && now <= user.outOfOfficeTo
  );
}

// The unit the user heads substantively, by the holder rule; null otherwise.
function substantiveHeadUnit(user: CreatorCoverFields): string | null {
  return user.status === 'ACTIVE' && user.position?.isUnitHeadPosition && user.primaryOrgUnitId
    ? user.primaryOrgUnitId
    : null;
}

