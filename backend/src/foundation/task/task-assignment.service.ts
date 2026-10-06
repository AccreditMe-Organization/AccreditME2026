import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMITTEES_PERMISSIONS, TASKS_PERMISSIONS } from '../../common/constants/permissions';
import { AssignTargetDto } from './dto/assign-target.dto';
import {
  IAssignableCommitteeRole,
  IAssignableHolder,
  IAssignablePosition,
  IAssignableUnit,
} from './interfaces/task-assignment.interface';
import { PoolClient, PoolPlacement, PoolTarget, isPoolMember, resolvePoolMemberIds } from './task-pool';

const COMMITTEE_MEMBER_ROLE_CATEGORY = 'committee_member_role';

export interface AssignmentViewer {
  id: string;
  permissions: readonly string[];
}

/** A chosen target resolved: where the task lands, and who (if anyone) holds it directly. */
export interface ResolvedPlacement extends PoolPlacement {
  directUserIds: string[];
}

/**
 * ACC-167 — the assignment picker (decision 8) and the rules that turn a
 * chosen target into a placement (decisions 1 and 2).
 *
 * ## Who may use the picker
 *
 * A tasks:create holder, or — for one task, named by `taskId` — anyone allowed
 * to reassign it: its creator, or a tasks:reassign holder. This replaces the
 * users:view dependency ACC-163 recorded: a creator who cannot list the
 * tenant's users can still choose who gets their task. The committee variants
 * also need committees:view, because the request names the committee and
 * lists its members (ACC-101 clause (a): refused before anything is read).
 *
 * Refusals follow ACC-101's two clauses. With no taskId the request names no
 * record, so a caller without tasks:create gets a 403 naming it. With a taskId
 * the entitlement is only knowable from the row, so a caller who is neither
 * its creator nor a reassigner gets the identical 404.
 */
@Injectable()
export class TaskAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async assertMayAssign(viewer: AssignmentViewer, organizationId: string, taskId?: string): Promise<void> {
    if (viewer.permissions.includes(TASKS_PERMISSIONS.CREATE)) return;
    if (!taskId) {
      throw new ForbiddenException(`Required permission: ${TASKS_PERMISSIONS.CREATE}`);
    }
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      select: { createdById: true },
    });
    const entitled =
      !!task &&
      (task.createdById === viewer.id || viewer.permissions.includes(TASKS_PERMISSIONS.REASSIGN));
    if (!entitled) throw new NotFoundException('Task not found');
  }

  private assertMayViewCommittee(viewer: AssignmentViewer): void {
    if (!viewer.permissions.includes(COMMITTEES_PERMISSIONS.VIEW)) {
      throw new ForbiddenException(`Required permission: ${COMMITTEES_PERMISSIONS.VIEW}`);
    }
  }

  async listUnits(viewer: AssignmentViewer, organizationId: string, taskId?: string): Promise<IAssignableUnit[]> {
    await this.assertMayAssign(viewer, organizationId, taskId);
    return this.prisma.orgUnit.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, parentId: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: 'asc' },
    });
  }

  // The whole active catalogue, not only positions somebody holds in the unit:
  // a single-holder position nobody holds is a real choice (it makes an
  // UNASSIGNED task that a future holder picks up), and the count says so.
  async listPositions(
    viewer: AssignmentViewer,
    organizationId: string,
    orgUnitId: string,
    taskId?: string,
  ): Promise<IAssignablePosition[]> {
    await this.assertMayAssign(viewer, organizationId, taskId);
    await this.requireUnit(orgUnitId, organizationId);

    const [positions, holders] = await Promise.all([
      this.prisma.orgPosition.findMany({
        where: { organizationId, isActive: true },
        select: { id: true, nameEn: true, nameAr: true, isSingleAssignee: true },
        orderBy: { nameEn: 'asc' },
      }),
      this.prisma.user.groupBy({
        by: ['positionId'],
        where: { organizationId, primaryOrgUnitId: orgUnitId, status: 'ACTIVE', positionId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(holders.map((h) => [h.positionId, h._count._all]));
    return positions.map((p) => ({ ...p, holderCount: counts.get(p.id) ?? 0 }));
  }

  async listHolders(
    viewer: AssignmentViewer,
    organizationId: string,
    orgUnitId: string,
    positionId: string,
    taskId?: string,
  ): Promise<IAssignableHolder[]> {
    await this.assertMayAssign(viewer, organizationId, taskId);
    const holders = await this.prisma.user.findMany({
      where: { organizationId, positionId, primaryOrgUnitId: orgUnitId, status: 'ACTIVE' },
      select: { id: true, name: true, position: { select: { nameEn: true, nameAr: true } } },
      orderBy: { name: 'asc' },
    });
    return holders.map(toHolder);
  }

  async listCommitteeRoles(
    viewer: AssignmentViewer,
    organizationId: string,
    committeeId: string,
    taskId?: string,
  ): Promise<IAssignableCommitteeRole[]> {
    this.assertMayViewCommittee(viewer);
    await this.assertMayAssign(viewer, organizationId, taskId);
    await this.requireCommittee(committeeId, organizationId);

    const members = await this.prisma.committeeMember.groupBy({
      by: ['roleValueId'],
      where: { organizationId, committeeId, isActive: true, user: { status: 'ACTIVE' } },
      _count: { _all: true },
    });
    if (members.length === 0) return [];
    const roles = await this.prisma.lookupValue.findMany({
      where: { id: { in: members.map((m) => m.roleValueId) } },
      select: { id: true, labelEn: true, labelAr: true, labelOverrideEn: true, labelOverrideAr: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
    const counts = new Map(members.map((m) => [m.roleValueId, m._count._all]));
    return roles.map((r) => ({
      id: r.id,
      labelEn: r.labelOverrideEn ?? r.labelEn,
      labelAr: r.labelOverrideAr ?? r.labelAr,
      memberCount: counts.get(r.id) ?? 0,
    }));
  }

  async listCommitteeMembers(
    viewer: AssignmentViewer,
    organizationId: string,
    committeeId: string,
    roleValueId: string,
    taskId?: string,
  ): Promise<IAssignableHolder[]> {
    this.assertMayViewCommittee(viewer);
    await this.assertMayAssign(viewer, organizationId, taskId);
    const members = await this.prisma.committeeMember.findMany({
      where: { organizationId, committeeId, roleValueId, isActive: true, user: { status: 'ACTIVE' } },
      select: {
        user: { select: { id: true, name: true, position: { select: { nameEn: true, nameAr: true } } } },
      },
      orderBy: { user: { name: 'asc' } },
    });
    return members.map((m) => toHolder(m.user));
  }

  /**
   * Decision 1 and 2 — a chosen target becomes a placement.
   *
   *   userId given           → that person, who must be a current member (400 otherwise)
   *   single-holder position → its current holder(s); none → the task is UNASSIGNED
   *   anything else          → a pool, with nobody assigned until someone picks it up
   *
   * The target is kept in every case, so a departure can return the task to
   * its pool. A committee role is only offered on that committee's own task,
   * and always pools unless a member is chosen.
   */
  async resolvePlacement(
    dto: AssignTargetDto,
    organizationId: string,
    source: { sourceType: string; sourceId: string },
    client: PoolClient & Pick<PrismaService, 'orgUnit' | 'orgPosition' | 'committee' | 'lookupValue'> = this.prisma,
  ): Promise<ResolvedPlacement> {
    let target: PoolTarget;
    let singleHolder = false;

    if (dto.kind === 'POSITION') {
      const [unit, position] = await Promise.all([
        client.orgUnit.findFirst({ where: { id: dto.orgUnitId, organizationId, isActive: true }, select: { id: true } }),
        client.orgPosition.findFirst({
          where: { id: dto.positionId, organizationId, isActive: true },
          select: { id: true, isSingleAssignee: true },
        }),
      ]);
      if (!unit) throw new BadRequestException('The chosen unit does not exist');
      if (!position) throw new BadRequestException('The chosen position does not exist');
      target = { kind: 'POSITION', orgUnitId: unit.id, positionId: position.id };
      singleHolder = position.isSingleAssignee;
    } else {
      if (source.sourceType !== 'COMMITTEE' || source.sourceId !== dto.committeeId) {
        throw new BadRequestException('A committee role can only be chosen for a task on that committee');
      }
      const [committee, role] = await Promise.all([
        client.committee.findFirst({ where: { id: dto.committeeId, organizationId }, select: { id: true } }),
        client.lookupValue.findFirst({
          where: {
            id: dto.roleValueId,
            category: { key: COMMITTEE_MEMBER_ROLE_CATEGORY },
            OR: [{ organizationId: null }, { organizationId }],
          },
          select: { id: true },
        }),
      ]);
      if (!committee) throw new BadRequestException('The chosen committee does not exist');
      if (!role) throw new BadRequestException('The chosen committee role does not exist');
      target = { kind: 'COMMITTEE_ROLE', committeeId: committee.id, roleValueId: role.id };
    }

    if (dto.userId) {
      if (!(await isPoolMember(client, dto.userId, target, organizationId))) {
        throw new BadRequestException(
          target.kind === 'POSITION'
            ? 'The chosen person does not hold that position in that unit'
            : 'The chosen person does not hold that role on the committee',
        );
      }
      return { target, pooled: false, directUserIds: [dto.userId] };
    }
    if (singleHolder) {
      return { target, pooled: false, directUserIds: await resolvePoolMemberIds(client, target, organizationId) };
    }
    return { target, pooled: true, directUserIds: [] };
  }

  private async requireUnit(orgUnitId: string, organizationId: string): Promise<void> {
    const unit = await this.prisma.orgUnit.findFirst({ where: { id: orgUnitId, organizationId }, select: { id: true } });
    if (!unit) throw new NotFoundException('Org unit not found');
  }

  private async requireCommittee(committeeId: string, organizationId: string): Promise<void> {
    const committee = await this.prisma.committee.findFirst({
      where: { id: committeeId, organizationId },
      select: { id: true },
    });
    if (!committee) throw new NotFoundException('Committee not found');
  }
}

function toHolder(user: {
  id: string;
  name: string;
  position: { nameEn: string; nameAr: string | null } | null;
}): IAssignableHolder {
  return {
    id: user.id,
    name: user.name,
    positionNameEn: user.position?.nameEn ?? null,
    positionNameAr: user.position?.nameAr ?? null,
  };
}
