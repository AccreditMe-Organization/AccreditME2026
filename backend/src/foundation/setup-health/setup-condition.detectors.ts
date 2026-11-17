import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
// ACC-167 — plain functions over a Prisma client: importing them pulls in no
// Nest module, so this module still imports only Prisma and the queue.
import { OWNERLESS_SQL } from '../task/task-pool';
// ACC-185 — a plain function too: reads the encrypted storage config.
import { readStorageConfig } from '../file-storage/storage-config';
import { STAGE_FLAG } from '../workflow/record-registry';
import { requiredSeats, seatHoldersFor } from '../committees/committee-seat-rules';
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

// ACC-120 slice 2 — the threshold for ACTING_HEAD_OPEN_ENDED, in days. One
// number, exported, so the detector, its spec and any wording that quotes
// "90 days" cannot disagree.
export const OPEN_ENDED_ACTING_DAYS = 90;

// ACC-177 — the same 90% the one-time notice uses (STORAGE_WARNING_RATIO).
export const STORAGE_ALMOST_FULL_RATIO = 0.9;

/** ACC-185 — how many days before the SharePoint secret expires the condition opens. */
export const SECRET_EXPIRY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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

// `now` is the reconciliation's own clock (ACC-185: the secret-expiry
// window), so a pass judges every type against one instant.
export type SetupConditionDetector = (
  organizationId: string,
  now?: Date,
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
// consequence it stated stayed true. Unblocked by ACC-84 (a saved
// head-position role reaching its current holders); the type then returns
// narrowed to head-conferring positions, with a new detector.
// ACTING_HEAD_OPEN_ENDED was listed here for exactly one deploy (ACC-120 slice
// 2, PR 1) and is NOT any more. Its enum value shipped in its own migration
// ahead of the code that writes it, because adding a value is safe for the
// container already running while WRITING one is not — that container reads
// SetupCondition with a Prisma client whose enum lacks the variant. Deferring
// it was what made that split structural rather than intended: every
// Record<ActiveSetupConditionType> map stayed exhaustive with no detector in
// existence, so removing the line without adding the detector could not
// compile. This PR removes it and adds the detector in the same change.
//
// ACC-271 — STAGE_ON_STARTING_ASSIGNMENT was deferred the same way from PR 1 to
// PR 3, which adds its detector (and Keep this assignment) and removes it here.
//
// ACC-286 — COMMITTEE_MISSING_REQUIRED_SEAT was deferred the same way: PR 1
// added the value (and the frontend learned it) with nothing writing it; PR 2
// adds its detector and removes it here.
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
    ORG_UNIT_WITHOUT_TYPE: (organizationId) =>
      this.orgUnitsWithoutType(organizationId),
    STAGE_WITHOUT_ASSIGNEE: (organizationId) =>
      this.stagesWithoutAssignee(organizationId),
    TASK_WITHOUT_OWNER: (organizationId) =>
      this.tasksWithoutOwner(organizationId),
    ACTING_HEAD_OPEN_ENDED: (organizationId) =>
      this.openEndedActingHeads(organizationId),
    STORAGE_ALMOST_FULL: (organizationId) =>
      this.storageAlmostFull(organizationId),
    STORAGE_NOT_CONFIRMED: (organizationId) =>
      this.storageNotConfirmed(organizationId),
    STORAGE_ACCESS_WITHDRAWN: (organizationId) =>
      this.storageAccessWithdrawn(organizationId),
    STORAGE_SECRET_EXPIRING: (organizationId, now) =>
      this.storageSecretExpiring(organizationId, now),
    STAGE_ON_STARTING_ASSIGNMENT: (organizationId) =>
      this.stagesOnStartingAssignment(organizationId),
    COMMITTEE_MISSING_REQUIRED_SEAT: (organizationId) =>
      this.committeesMissingRequiredSeat(organizationId),
  };

  /**
   * ACC-286 PR 2 — a committee IN FORCE with a required seat nobody fills.
   * "In force" is rules 3 and 4's test (Ahmad, 15 Nov, Q-A): the committee is
   * active and its newest COMMITTEE instance's current stage is flagged
   * IN_FORCE — read from the flag, never a stage key, so Suspended counts.
   * Required seats and who fills them come from committee-seat-rules.ts, the
   * one reader: the organisation's own seat settings over the shared ones, and
   * only an active membership of an ACTIVE user fills a seat.
   *
   * One condition per committee, AT_RISK (A7), naming its empty seats in seat
   * order. No timestamp records when a seat emptied, so the age is "first
   * detected" (openedAt null, Q-B). At most three queries per organisation,
   * whatever the number of committees.
   */
  async committeesMissingRequiredSeat(organizationId: string): Promise<DetectedCondition[]> {
    const committees = await this.prisma.$queryRaw<{ id: string; nameEn: string; nameAr: string | null }[]>`
      WITH newest AS (
        SELECT DISTINCT ON (wi."objectId") wi."objectId" AS "committeeId", wi."currentStageId"
          FROM "WorkflowInstance" wi
         WHERE wi."organizationId" = ${organizationId} AND wi."objectType" = 'COMMITTEE'
         ORDER BY wi."objectId", wi."createdAt" DESC
      )
      SELECT c.id, c."nameEn", c."nameAr"
        FROM "Committee" c
        JOIN newest n ON n."committeeId" = c.id
        JOIN "WorkflowStage" s ON s.id = n."currentStageId"
       WHERE c."organizationId" = ${organizationId}
         AND c."isActive"
         AND ${STAGE_FLAG.IN_FORCE} = ANY(s.flags)
       ORDER BY c."nameEn", c.id`;
    if (committees.length === 0) return [];

    const seats = await requiredSeats(this.prisma, organizationId);
    if (seats.length === 0) return [];

    const holders = await seatHoldersFor(this.prisma, organizationId, committees.map((c) => c.id), seats.map((s) => s.id));
    const filled = new Set(holders.map((h) => `${h.committeeId}:${h.roleValueId}`));

    return committees.flatMap((committee) => {
      const empty = seats.filter((seat) => !filled.has(`${committee.id}:${seat.id}`));
      if (empty.length === 0) return [];
      return [
        {
          objectId: committee.id,
          severity: 'AT_RISK' as const,
          openedAt: null,
          subject: {
            nameEn: committee.nameEn,
            nameAr: committee.nameAr,
            seats: empty.map((s) => ({ id: s.id, labelEn: s.labelEn, labelAr: s.labelAr })),
          },
        },
      ];
    });
  }

  /**
   * ACC-271 PR 3 (plan §9) — a stage still worked by its seeded starting
   * assignment (the tenant admin). One condition per stage, AT_RISK: the work
   * reaches someone, just not someone chosen for it. Grouped by workflow through
   * the template in the snapshot. Read in ONE query whatever the number of
   * stages: the assignee row names its stage and user by id only, so the names
   * come from joins, every table scoped by the organisation. Only an active
   * workflow's stages are listed: a switched-off workflow moves nothing.
   * Opened at the starting entry's own creation (OBJECT age).
   */
  async stagesOnStartingAssignment(organizationId: string): Promise<DetectedCondition[]> {
    const rows = await this.prisma.$queryRaw<
      {
        stageId: string;
        stageNameEn: string;
        stageNameAr: string | null;
        templateId: string;
        templateNameEn: string;
        templateNameAr: string | null;
        adminName: string | null;
        since: Date;
      }[]
    >`
      SELECT s.id AS "stageId", s."nameEn" AS "stageNameEn", s."nameAr" AS "stageNameAr",
             t.id AS "templateId", t."nameEn" AS "templateNameEn", t."nameAr" AS "templateNameAr",
             MIN(u.name) AS "adminName", MIN(a."createdAt") AS "since"
        FROM "WorkflowStageAssignee" a
        JOIN "WorkflowStage" s ON s.id = a."stageId"
        JOIN "WorkflowTemplate" t ON t.id = s."workflowTemplateId" AND t."organizationId" = ${organizationId}
        LEFT JOIN "User" u ON u.id = a."userId" AND u."organizationId" = ${organizationId}
       WHERE a."organizationId" = ${organizationId}
         AND a."isStartingAssignment" = true
         AND t."isActive" = true
       GROUP BY s.id, s."nameEn", s."nameAr", t.id, t."nameEn", t."nameAr"
       ORDER BY t."nameEn", s.id`;
    return rows.map((row) => ({
      objectId: row.stageId,
      severity: 'AT_RISK' as const,
      openedAt: row.since,
      subject: {
        nameEn: row.stageNameEn,
        nameAr: row.stageNameAr,
        templateId: row.templateId,
        templateNameEn: row.templateNameEn,
        templateNameAr: row.templateNameAr,
        // Whose the work is until someone replaces the assignment ("Its work
        // goes to {admin}"). A person's name, the same in both languages.
        adminName: row.adminName,
      },
    }));
  }

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

  /**
   * ACTIVE units with no type — ACC-137.
   *
   * ## Why this detector exists at all, when the API makes the type required
   *
   * It was very nearly dropped, on the reasoning that a required field cannot
   * produce an empty one — the `isCodeLocked` trap: a branch built for a state
   * nothing can reach, which then gets ticked off as done. Going to look rather
   * than reasoning about it found a real path, and it is not an edge case:
   *
   * `TenantService.bootstrap()` creates every tenant's ROOT unit with a direct
   * `prisma.orgUnit.create({ data: { organizationId, nameEn, code, sortOrder } })`
   * — no type, bypassing this service and its validation entirely. So every
   * tenant provisioned through the real Create Tenant flow starts with exactly
   * one untyped unit, on day one, and nothing sets it afterwards.
   *
   * It does not show in the seeded tenants because `apply-org-tree.ts`'s
   * `reconcileRoot()` overwrites the bootstrap root with the fixture's type. A
   * real customer has no equivalent step.
   *
   * The other candidates were checked and are NOT paths: `removeValue()` is a
   * soft delete (`isActive: false`) and SYSTEM values refuse deletion outright,
   * so a type retires rather than vanishing; and the foreign key is
   * `onDelete: Restrict`, so even a hard delete refuses instead of blanking the
   * column.
   *
   * ## Severity is AT_RISK, never BLOCKS_WORK
   *
   * An untyped unit works perfectly — it appears in the tree, holds people and
   * positions, and routes tasks. What it cannot do is be filtered or grouped by
   * type, which is a reporting gap rather than stalled work. BLOCKS_WORK is
   * reserved for a condition that stops something, and reaching for it here
   * would devalue it everywhere else.
   *
   * ## The PLATFORM organization is exempt structurally, not by a branch here
   *
   * Its root is not a tenant org unit and no `org_unit_type` value is meaningful
   * for it. The exemption comes from the platform org not being a tenant — the
   * reconciler iterates tenants — so there is no `isPlatformOrg` test in this
   * method. A carve-out here would be inventing a rule the decision did not
   * make, and would quietly hide a real tenant's unit if the flag were ever set
   * wrongly.
   */
  async orgUnitsWithoutType(
    organizationId: string,
  ): Promise<DetectedCondition[]> {
    const units = await this.prisma.orgUnit.findMany({
      where: { organizationId, isActive: true, typeValueId: null },
      select: { id: true, nameEn: true, nameAr: true, createdAt: true },
    });

    return units.map((unit) => ({
      objectId: unit.id,
      severity: 'AT_RISK' as const,
      // The unit's own createdAt: the condition has been true since the unit
      // existed, so dating it from first detection would report a three-week-old
      // gap as new the day this ships.
      openedAt: unit.createdAt,
      subject: { nameEn: unit.nameEn, nameAr: unit.nameAr },
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
        // ACC-312 — a final stage holds nothing up. An entry flagged before the
        // engine stopped flagging them is not listed, so Setup health is right
        // the moment this deploys, whether or not the old flags are cleared.
        stage: { isFinal: false },
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
  //
  // ACC-167 — an UNASSIGNED task, and an open pool task with nobody on it whose
  // pool nobody is in right now. ACC-86 — and any open task with nobody on it
  // (no current row held by an ACTIVE user), whatever its status: a departure that
  // stopped partway, or a co-assignee who left first, leaves one PENDING,
  // IN_PROGRESS or ON_HOLD. All of it is OWNERLESS_SQL (task-pool.ts), the very
  // definition the Unassigned view reads, so Setup health and that screen cannot
  // disagree. Resolved live on every pass (ACC-82): no status is trusted. One
  // query per tenant per hour, scoped by organisation.
  async tasksWithoutOwner(
    organizationId: string,
  ): Promise<DetectedCondition[]> {
    const tasks = await this.prisma.$queryRaw<{ id: string; title: string; sourceType: string; sourceId: string; dueAt: Date | null }[]>`
      SELECT t.id, t.title, t."sourceType"::text AS "sourceType", t."sourceId", t."dueAt"
        FROM "Task" t
       WHERE t."organizationId" = ${organizationId}
         AND ${OWNERLESS_SQL}
       ORDER BY t.id`;

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

  /**
   * ACC-120 slice 2 — an ACTING appointment with no end date, still running
   * after OPEN_ENDED_ACTING_DAYS.
   *
   * THE 90-DAY CLAUSE IS PART OF THE QUERY, not a filter applied afterwards.
   * Without `validFrom <= threshold` every open-ended appointment would raise
   * the moment it was made, which is the opposite of what the condition says:
   * an acting head is temporary by design, and only an UNBOUNDED one that has
   * outlasted any reasonable temporariness is worth reporting.
   *
   * `validTo: null` IS THE WHOLE OPEN-ENDED TEST, and there is deliberately no
   * `endedAt: null` beside it.
   *
   * An earlier version had one, described as a guard against a write path that
   * set one field and not the other. It was not a guard, it was a filter, and
   * it pointed the wrong way. Ending a period early (clearActingHead) sets BOTH
   * fields to the same instant, so `endedAt` is null on exactly the rows
   * `validTo` is null on, and adding it excluded nothing extra — except the one
   * combination that cannot arise from either write path: `validTo` null with
   * `endedAt` set. That row is an invariant violation, and the pair made the
   * detector SILENT on it. Now it is reported, as an open-ended acting head,
   * which is the safe direction: a visible wrong row beats an invisible one.
   *
   * A future-dated appointment cannot match either — `validFrom` 90 days in the
   * past excludes it by construction.
   *
   * objectId is the ORG UNIT, not the assignment row: the condition is about a
   * unit whose headship has been provisional for three months, the Fix opens
   * that unit, and a unit has at most one current acting head (assignActingHead
   * refuses a second), so one row per unit per pass.
   */
  /**
   * ACC-177 — AccreditMe-cloud storage at 90% or more of maxStorageGb. Counted
   * the way the quota counts (StoredFileService.cloudUsageBytes): S3 files not
   * yet purged, deleted ones included — their bytes are still stored. Read
   * straight from StoredFile, like every detector here, so this module adds no
   * dependency edge. One row per organisation (objectId is the organisation);
   * it clears itself on the next pass after a purge brings usage under 90%.
   * The bell's one-time notice is the other half (StoredFileService).
   */
  async storageAlmostFull(organizationId: string): Promise<DetectedCondition[]> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { maxStorageGb: true },
    });
    if (!org || org.maxStorageGb <= 0) return [];
    const total = await this.prisma.storedFile.aggregate({
      where: { organizationId, provider: 'S3', purgedAt: null },
      _sum: { sizeBytes: true },
    });
    const usedBytes = total._sum.sizeBytes ?? 0;
    const limitBytes = org.maxStorageGb * 1024 ** 3;
    if (usedBytes < limitBytes * STORAGE_ALMOST_FULL_RATIO) return [];
    return [
      {
        objectId: organizationId,
        // AT_RISK: nothing is blocked until the limit itself is reached.
        severity: 'AT_RISK' as const,
        openedAt: null,
        subject: {
          usedBytes,
          limitBytes,
          percent: Math.floor((usedBytes / limitBytes) * 100),
        },
      },
    ];
  }

  /**
   * ACC-261 — the organisation has not confirmed where its files go
   * (`Organization.storageConfirmedAt` is null), so every upload is refused
   * with STORAGE_NOT_CONFIRMED until a tenant admin confirms (ACC-177). One row
   * per organisation (objectId is the organisation); it clears on the first pass
   * after Confirm. BLOCKS_WORK: nobody can add a file. The platform organisation
   * is exempt structurally: the reconciler iterates tenants only.
   */
  async storageNotConfirmed(organizationId: string): Promise<DetectedCondition[]> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { storageConfirmedAt: true },
    });
    if (!org || org.storageConfirmedAt) return [];
    return [{ objectId: organizationId, severity: 'BLOCKS_WORK' as const, openedAt: null, subject: {} }];
  }

  /**
   * ACC-185 — the organisation's SharePoint can no longer be reached. Reads the
   * flag the hourly probe maintains (SharePointAccessService.probe, the single
   * recomputer); it opens on the probe's first failing pass and closes on the
   * first pass after access works again. BLOCKS_WORK: uploads and downloads of
   * files stored there are refused until it is fixed.
   */
  async storageAccessWithdrawn(organizationId: string): Promise<DetectedCondition[]> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { storageProvider: true, storageAccessLostAt: true, storageAccessLostReason: true },
    });
    if (!org || org.storageProvider !== 'SHAREPOINT' || !org.storageAccessLostAt) return [];
    return [
      {
        objectId: organizationId,
        severity: 'BLOCKS_WORK' as const,
        openedAt: org.storageAccessLostAt,
        subject: { reason: org.storageAccessLostReason },
      },
    ];
  }

  /**
   * ACC-185 — the SharePoint client secret expires within
   * SECRET_EXPIRY_DAYS days, by the date the tenant admin entered. Open from
   * then until the date changes (a replaced secret) or passes — after which the
   * probe finds the secret invalid and STORAGE_ACCESS_WITHDRAWN takes over. No
   * date entered, no condition: the expiry cannot be known.
   */
  async storageSecretExpiring(organizationId: string, now: Date = new Date()): Promise<DetectedCondition[]> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { storageProvider: true, storageConfirmedAt: true, storageConfig: true },
    });
    if (!org || org.storageProvider !== 'SHAREPOINT' || !org.storageConfirmedAt) return [];
    const expiresOn = readStorageConfig(org.storageConfig).sharepoint?.secretExpiresOn;
    if (!expiresOn) return [];
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const daysLeft = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - today) / DAY_MS);
    if (Number.isNaN(daysLeft) || daysLeft < 0 || daysLeft > SECRET_EXPIRY_DAYS) return [];
    return [
      {
        objectId: organizationId,
        severity: 'AT_RISK' as const,
        openedAt: null,
        subject: { expiresOn, daysLeft },
      },
    ];
  }

  async openEndedActingHeads(
    organizationId: string,
  ): Promise<DetectedCondition[]> {
    const now = Date.now();
    const threshold = new Date(now - OPEN_ENDED_ACTING_DAYS * 24 * 60 * 60 * 1000);

    const assignments = await this.prisma.orgUnitHeadAssignment.findMany({
      where: {
        organizationId,
        kind: 'ACTING',
        validTo: null,
        validFrom: { lte: threshold },
      },
      select: {
        id: true,
        validFrom: true,
        reason: true,
        orgUnit: { select: { id: true, nameEn: true, nameAr: true } },
        user: { select: { id: true, name: true } },
      },
    });

    return assignments.map((a) => ({
      objectId: a.orgUnit.id,
      // AT_RISK, not BLOCKS_WORK. Nothing is stuck: an acting head resolves for
      // assignment and for escalation (resolveHeadEscalationTargets falls back
      // to acting coverage), so work reaches a person. It follows the severity
      // ORG_UNIT_WITHOUT_HEAD already gives a unit covered by an acting head —
      // consistent with the existing scale rather than a fresh judgement.
      severity: 'AT_RISK' as const,
      // The object DOES carry a timestamp for entering this condition, and it is
      // not validFrom: the appointment began then, but it only became a
      // reportable condition on the day it passed 90. Using validFrom would age
      // every row 90 days too old on a page that labels age.
      openedAt: new Date(
        a.validFrom.getTime() + OPEN_ENDED_ACTING_DAYS * 24 * 60 * 60 * 1000,
      ),
      subject: {
        assignmentId: a.id,
        orgUnitId: a.orgUnit.id,
        orgUnitNameEn: a.orgUnit.nameEn,
        orgUnitNameAr: a.orgUnit.nameAr,
        actingUserId: a.user.id,
        actingUserName: a.user.name,
        // The wording differs by reason and is chosen in the frontend, which is
        // where the plural object for the day count lives (ACC-94). A number,
        // never a formatted string.
        reason: a.reason,
        validFrom: a.validFrom.toISOString(),
        daysActing: Math.floor((now - a.validFrom.getTime()) / (24 * 60 * 60 * 1000)),
      },
    }));
  }
}
