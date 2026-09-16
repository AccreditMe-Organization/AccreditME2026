import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMITTEES_PERMISSIONS, MEETINGS_PERMISSIONS } from '../constants/permissions';

// ACC-101 — "may this caller see this PARENT record?", asked before returning
// anything scoped to it.
//
// The rule (CLAUDE.md): a list scoped to a parent record requires the caller to
// be able to see the parent, not only the child type. The child's own
// permission stays necessary and stops being sufficient. Before this, a
// committee's task list was governed by tasks:view — held by BASE_USER, the
// role every staff member gets — while the committee itself needs
// committees:view, so the weaker gate governed the richer payload (assignee
// names, and delegation labels naming who is absent).
//
// Why a service and not a guard. A guard sees the request, not the record: for
// GET /tasks/:id the parent is only knowable after the task is read, and
// resolving it in a guard would mean reading the task twice. PermissionGuard
// also answers a fixed compile-time question, and this one is data-driven —
// which permission applies depends on the object type in the payload. So this
// mirrors UserService.getByIdForViewer()'s established shape (ACC-43): the
// authorization that needs the record lives beside the read that loads it.
//
// Provided by TenantModule alongside AuditLogService and DelegationLabelService,
// so every module that already imports TenantModule can inject it with no new
// wiring.
@Injectable()
export class ObjectVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  // One entry per object type that can own children. Keyed by the string both
  // enums use for the same thing — TaskSourceType.COMMITTEE and
  // WorkflowObjectType.COMMITTEE are the same record, spelled once here.
  //
  // DELIBERATELY NOT EXHAUSTIVE, and that is the point: TaskSourceType has 11
  // values and WorkflowObjectType 8, of which exactly two have tables today.
  // An unmapped type is REFUSED, never allowed — see assertCanView. Adding a
  // module means adding its row here, and forgetting costs a visible 403 rather
  // than a silent disclosure.
  private readonly rules: Record<string, ParentRule> = {
    COMMITTEE: {
      permission: COMMITTEES_PERMISSIONS.VIEW,
      exists: (id, organizationId) =>
        this.prisma.committee.findFirst({
          where: { id, organizationId },
          select: { id: true },
        }),
    },
    MEETING: {
      permission: MEETINGS_PERMISSIONS.VIEW,
      exists: (id, organizationId) =>
        this.prisma.meeting.findFirst({
          where: { id, organizationId },
          select: { id: true },
        }),
    },
  };

  // Throws unless the caller may see the parent. Returns nothing: every caller
  // uses it as a gate, and returning a boolean invites `if (canView)` branches
  // that forget the else.
  //
  // ORDER IS LOAD-BEARING. The permission is checked BEFORE the record is read,
  // so an unauthorized caller cannot use the difference between 403 and 404 to
  // learn whether an id exists. It is also the cheaper order: a refused caller
  // costs no query at all.
  async assertCanView(
    objectType: string,
    objectId: string,
    organizationId: string,
    viewerPermissions: readonly string[],
  ): Promise<void> {
    const rule = this.rules[objectType];

    // Fail closed. A type with no rule is one whose module has not been built
    // or whose visibility nobody has decided — in both cases refusing is the
    // answer that cannot leak.
    if (!rule) {
      throw new ForbiddenException(
        `Visibility rules are not defined for ${objectType} records`,
      );
    }

    if (!viewerPermissions.includes(rule.permission)) {
      throw new ForbiddenException(`Required permission: ${rule.permission}`);
    }

    // Scoped by id AND organizationId together, per CLAUDE.md's query shape.
    // Without organizationId this would confirm the existence of another
    // tenant's record to anyone holding an ordinary view permission.
    const parent = await rule.exists(objectId, organizationId);
    if (!parent) {
      throw new NotFoundException(`${objectType} not found`);
    }
  }
}

interface ParentRule {
  permission: string;
  exists(id: string, organizationId: string): Promise<{ id: string } | null>;
}
