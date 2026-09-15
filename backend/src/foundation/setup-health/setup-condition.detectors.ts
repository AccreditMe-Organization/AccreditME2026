import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
// Type-only: the generated client is replaced by a stub under Jest
// (package.json moduleNameMapper), so its enum OBJECTS do not exist at test
// runtime. String literals typed by the enum — the same convention as
// TaskService's 'UNASSIGNED' — keep the compiler checking the values.
import type {
  Prisma,
  SetupConditionSeverity,
  SetupConditionType,
} from '../../../generated/prisma/client';

// ACC-82 — SYSTEM-REFERENCE §13.2. One detector per condition type: given a
// tenant, return every object that is in that condition RIGHT NOW.
//
// Detectors only read. They never write a SetupCondition row, never notify, and
// never decide what has cleared — the reconciler owns all of that. Keeping them
// pure reads is what lets the reconciler treat a THROWN detector as "not
// evaluated" rather than "nothing found" (§13.5): a detector that swallowed its
// own error and returned [] would silently clear every open condition of its
// type.
//
// Every query is scoped by organizationId. Two of them read cached flags that
// SlaMonitorProcessor maintains every 15 minutes (OrgUnit.isHeadVacant /
// isHeadFullyUnresolved, WorkflowInstanceStage.isUnassigned) rather than
// re-deriving head or assignee resolution — one definition of each, not two.

export interface DetectedCondition {
  objectId: string;
  severity: SetupConditionSeverity;
  // The object's own timestamp for entering the condition, when it carries one.
  // null means "none recorded": the reconciler uses the first reconciliation
  // that sees it, and the page labels that age "first detected" (§13.3).
  openedAt: Date | null;
  // Display snapshot — names and counts. Refreshed on every pass while open, and
  // kept after clearing so a closed row still reads correctly.
  subject: Prisma.InputJsonObject;
}

export type SetupConditionDetector = (
  organizationId: string,
) => Promise<DetectedCondition[]>;

// Types that exist in the enum but are NOT detected, reconciled or reported.
// The enum value is kept (removing it would be a destructive migration, and it
// comes back); leaving a type here is the only way to have no detector for it.
//
// POSITION_WITHOUT_ROLE — deferred in ACC-82 (SYSTEM-REFERENCE §13.2).
// OrgPosition.roleId is read only for head-conferring positions, and only when
// someone is appointed or made acting head (UserService.
// syncHeadAuthorityRoleGrant, OrgUnitHeadService). For an ordinary position it
// grants nothing, and saving a role on a head position does not grant it to
// the people already holding it. So "Map role" cleared the row while the
// consequence it stated stayed true. Unblocked by the Backlog ticket that makes
// a saved head-position role reach its current holders; the type then returns
// narrowed to head-conferring positions, with a new detector.
export const DEFERRED_SETUP_CONDITION_TYPES = [
  'POSITION_WITHOUT_ROLE',
] as const satisfies readonly SetupConditionType[];

export type ActiveSetupConditionType = Exclude<
  SetupConditionType,
  (typeof DEFERRED_SETUP_CONDITION_TYPES)[number]
>;

@Injectable()
export class SetupConditionDetectors {
  constructor(private readonly prisma: PrismaService) {}

  // Exhaustive by construction: a SetupConditionType that is neither deferred
  // above nor given a detector here is a compile error, not a type that silently
  // never opens. Taking a type off the deferred list makes its missing detector
  // a compile error in the same way.
  readonly byType: Record<ActiveSetupConditionType, SetupConditionDetector> = {
    ORG_UNIT_WITHOUT_HEAD: (organizationId) =>
      this.orgUnitsWithoutHead(organizationId),
    STAGE_WITHOUT_ASSIGNEE: (organizationId) =>
      this.stagesWithoutAssignee(organizationId),
    TASK_WITHOUT_OWNER: (organizationId) =>
      this.tasksWithoutOwner(organizationId),
  };

  // Vacant (no head position holder) ACTIVE units. Severity follows coverage:
  // BLOCKS_WORK only when escalation also resolves no one; AT_RISK when an
  // ancestor's head or an acting head covers the gap. At design time both
  // seeded tenants had 17 vacant units and zero fully unresolved.
  async orgUnitsWithoutHead(
    organizationId: string,
  ): Promise<DetectedCondition[]> {
    const units = await this.prisma.orgUnit.findMany({
      where: { organizationId, isActive: true, isHeadVacant: true },
      select: {
        id: true,
        nameEn: true,
        nameAr: true,
        isHeadFullyUnresolved: true,
        headVacantSince: true,
      },
    });

    return units.map((unit) => ({
      objectId: unit.id,
      severity: unit.isHeadFullyUnresolved
        ? ('BLOCKS_WORK' as const)
        : ('AT_RISK' as const),
      openedAt: unit.headVacantSince,
      subject: {
        nameEn: unit.nameEn,
        nameAr: unit.nameAr,
        escalationResolves: !unit.isHeadFullyUnresolved,
      },
    }));
  }

  // Detected per workflow INSTANCE, reported per template STAGE: the fix — the
  // stage's assignee configuration — is made once, on the stage. One condition
  // per WorkflowStage, carrying how many open instances it is holding up, opened
  // at the earliest of their unassignedAt timestamps.
  async stagesWithoutAssignee(
    organizationId: string,
  ): Promise<DetectedCondition[]> {
    const openStages = await this.prisma.workflowInstanceStage.findMany({
      where: {
        exitedAt: null,
        isUnassigned: true,
        workflowInstance: { organizationId },
      },
      select: {
        unassignedAt: true,
        stage: {
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            workflowTemplate: {
              select: { id: true, nameEn: true, nameAr: true },
            },
          },
        },
      },
    });

    const byStage = new Map<
      string,
      {
        stage: (typeof openStages)[number]['stage'];
        count: number;
        earliest: Date | null;
      }
    >();
    for (const row of openStages) {
      const entry = byStage.get(row.stage.id) ?? {
        stage: row.stage,
        count: 0,
        earliest: null,
      };
      entry.count += 1;
      if (
        row.unassignedAt &&
        (!entry.earliest || row.unassignedAt < entry.earliest)
      ) {
        entry.earliest = row.unassignedAt;
      }
      byStage.set(row.stage.id, entry);
    }

    return [...byStage.values()].map(({ stage, count, earliest }) => ({
      objectId: stage.id,
      severity: 'BLOCKS_WORK' as const,
      openedAt: earliest,
      subject: {
        nameEn: stage.nameEn,
        nameAr: stage.nameAr,
        templateId: stage.workflowTemplate.id,
        templateNameEn: stage.workflowTemplate.nameEn,
        templateNameAr: stage.workflowTemplate.nameAr,
        affectedInstances: count,
      },
    }));
  }

  // Tasks nobody can act on. No timestamp records when a task became unassigned,
  // and adding one would have to be set by every writer of task status (§13.3),
  // so openedAt is null and the age is "first detected".
  async tasksWithoutOwner(
    organizationId: string,
  ): Promise<DetectedCondition[]> {
    const tasks = await this.prisma.task.findMany({
      where: { organizationId, status: 'UNASSIGNED' },
      select: {
        id: true,
        title: true,
        sourceType: true,
        sourceId: true,
        dueAt: true,
      },
    });

    return tasks.map((task) => ({
      objectId: task.id,
      severity: 'BLOCKS_WORK' as const,
      openedAt: null,
      subject: {
        title: task.title,
        sourceType: task.sourceType,
        sourceId: task.sourceId,
        dueAt: task.dueAt ? task.dueAt.toISOString() : null,
      },
    }));
  }
}
