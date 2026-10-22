import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  COMMITTEES_PERMISSIONS,
  ORG_PERMISSIONS,
  SETUP_PERMISSIONS,
  USERS_PERMISSIONS,
} from '../../common/constants/permissions';
import { committeeStagesAndCounts } from '../committees/committee-stage-counts';
import type { IOrgUnitType } from './interfaces/org-unit.interface';
import type {
  IOrgChartNode,
  IOrgChartResponse,
  IOrgStructureNode,
  IOrgStructureResponse,
  IOrgUnitAttention,
  IOrgUnitCommitteeItem,
  IOrgUnitPathItem,
  IOrgUnitPerson,
  IOrgUnitPositionInUse,
  IOrgUnitSummary,
} from './interfaces/org-structure.interface';
import { buildOrgUnitTypeResolver } from './org-unit-type-resolver';
import { findCurrentHeadHoldersForUnits, findRunningActingCoversForUnits } from './unit-headship';

/** The chart never shows more than four levels from its root (OS L570). */
export const CHART_MAX_DEPTH = 4;

/** The Setup health types whose subject is an org unit (objectId = the unit). */
const UNIT_CONDITION_TYPES: IOrgUnitAttention['code'][] = [
  'ORG_UNIT_WITHOUT_HEAD',
  'ORG_UNIT_WITHOUT_TYPE',
  'ACTING_HEAD_OPEN_ENDED',
];
const SEVERITY_RANK: Record<IOrgUnitAttention['severity'], number> = { BLOCKS_WORK: 0, AT_RISK: 1 };

const UNIT_SELECT = {
  id: true,
  parentId: true,
  nameEn: true,
  nameAr: true,
  code: true,
  typeValueId: true,
  description: true,
  sortOrder: true,
  isActive: true,
  pendingHeadUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface UnitRow {
  id: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string | null;
  code: string;
  typeValueId: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  pendingHeadUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What the caller may see inside a response (D7), from their permissions. */
interface Viewer {
  names: boolean;
  committees: boolean;
  attention: boolean;
  manage: boolean;
}

export function viewerFrom(permissions: string[]): Viewer {
  return {
    names: permissions.includes(USERS_PERMISSIONS.VIEW),
    committees: permissions.includes(COMMITTEES_PERMISSIONS.VIEW),
    attention: permissions.includes(SETUP_PERMISSIONS.VIEW),
    manage: permissions.includes(ORG_PERMISSIONS.MANAGE),
  };
}

const bySiblingOrder = (a: UnitRow, b: UnitRow) => a.sortOrder - b.sortOrder || a.nameEn.localeCompare(b.nameEn);

/**
 * ACC-120 slice 11 — the organisation's read model: the tree
 * (`structure`), the chart (`chart`) and one unit's record (`summary`).
 *
 * Kept apart from `OrganizationService`, which owns the writes: this is
 * batched reads over one in-memory copy of the tenant's units.
 *
 * ## The cost, and why it does not grow with the tree
 *
 * The tenant's units are read ONCE (as `getTree` does), and the tree is walked
 * in memory. Everything else is one query per KIND of fact, over the whole set
 * of units in the response — never one per unit:
 *
 *   units 1 · types 2 · heads 1 · covers 1 · headcount 1 · committees 1
 *   · attention 1 (only for `setup:view`)
 *
 * ## Heads and covers
 *
 * From `unit-headship.ts`, the same rules the Headship panel reads, so the
 * tree, the chart and the panel cannot disagree. The cover is read from the
 * period table, never from `OrgUnit.actingHeadUserId` (ACC-133).
 *
 * ## Loops in the data
 *
 * `update()` refuses a parent inside the unit's own subtree since PR A, but
 * rows written before that, or directly, may still form one. Every walk here
 * keeps a visited set, so a loop ends a walk instead of hanging the request.
 */
@Injectable()
export class OrgStructureService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every ACTIVE unit, in tree order (each parent before its children,
   * siblings by sortOrder then name). Inactive units too only when the caller
   * holds `org:manage` and asks for them.
   */
  async structure(
    organizationId: string,
    permissions: string[],
    options: { includeInactive?: boolean } = {},
  ): Promise<IOrgStructureResponse> {
    const viewer = viewerFrom(permissions);
    const units = await this.loadUnits(organizationId);
    const included = options.includeInactive && viewer.manage ? units : units.filter((u) => u.isActive);

    const ordered = this.treeOrder(included);
    const nodes = await this.decorate(organizationId, ordered, units, viewer);
    return { nodes, asOf: new Date() };
  }

  /**
   * The chart's window: ACTIVE units from `rootId` (or the organisation's top
   * unit) down `depth` levels, capped at 4. Inactive units are never on the
   * chart (D6). A root that is not an active unit of this organisation is the
   * identical not-found, whether it exists elsewhere or not at all.
   */
  async chart(
    organizationId: string,
    permissions: string[],
    options: { rootId?: string; depth?: number } = {},
  ): Promise<IOrgChartResponse> {
    const viewer = viewerFrom(permissions);
    const depth = Math.min(Math.max(options.depth ?? CHART_MAX_DEPTH, 1), CHART_MAX_DEPTH);
    const units = await this.loadUnits(organizationId);
    const active = units.filter((u) => u.isActive);

    const root = options.rootId
      ? active.find((u) => u.id === options.rootId)
      : this.topUnit(active);
    if (!root) throw new NotFoundException('Org unit not found');

    const children = this.childrenMap(active);
    const window: Array<{ unit: UnitRow; depth: number }> = [];
    const visited = new Set<string>();
    const walk = (unit: UnitRow, level: number) => {
      if (visited.has(unit.id)) return;
      visited.add(unit.id);
      window.push({ unit, depth: level });
      if (level + 1 >= depth) return;
      for (const child of children.get(unit.id) ?? []) walk(child, level + 1);
    };
    walk(root, 0);

    const nodes = await this.decorate(organizationId, window.map((w) => w.unit), units, viewer);
    return {
      root: { id: root.id, path: this.pathTo(root, units) },
      depth,
      nodes: nodes.map((node, i): IOrgChartNode => ({ ...node, depth: window[i]!.depth })),
      asOf: new Date(),
    };
  }

  /**
   * One unit for its record page and the chart's side panel: the node, its
   * path, the positions its people hold, its people and its committees. A unit
   * of another organisation, or none, is the identical not-found.
   *
   * An inactive unit is returned, marked inactive, as `GET …/:id` returns it:
   * its record page shows the deactivated state.
   */
  async summary(organizationId: string, permissions: string[], id: string): Promise<IOrgUnitSummary> {
    const viewer = viewerFrom(permissions);
    const units = await this.loadUnits(organizationId);
    const unit = units.find((u) => u.id === id);
    if (!unit) throw new NotFoundException('Org unit not found');
    // The record's Sub-units panel: direct ACTIVE children (the same set
    // childCount counts), decorated by the unit's own batched queries.
    const children = units.filter((u) => u.parentId === id && u.isActive && u.id !== id).sort(bySiblingOrder);

    const [nodes, people, committees] = await Promise.all([
      this.decorate(organizationId, [unit, ...children], units, viewer),
      this.prisma.user.findMany({
        where: { organizationId, primaryOrgUnitId: id, status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          positionId: true,
          position: { select: { nameEn: true, nameAr: true, grade: true, isUnitHeadPosition: true } },
        },
      }),
      viewer.committees ? this.committeeItems(organizationId, id) : Promise.resolve(null),
    ]);
    const node = nodes[0]!;
    const headIds = new Set(node.heads.map((h) => h.userId));

    const positions = new Map<string, IOrgUnitPositionInUse>();
    for (const person of people) {
      if (!person.positionId || !person.position) continue;
      const entry = positions.get(person.positionId) ?? {
        positionId: person.positionId,
        nameEn: person.position.nameEn,
        nameAr: person.position.nameAr,
        grade: person.position.grade,
        isUnitHeadPosition: person.position.isUnitHeadPosition,
        count: 0,
      };
      entry.count += 1;
      positions.set(person.positionId, entry);
    }

    return {
      unit: { ...node, description: unit.description, createdAt: unit.createdAt, updatedAt: unit.updatedAt },
      path: this.pathTo(unit, units),
      children: nodes.slice(1),
      positions: [...positions.values()].sort(
        (a, b) => b.grade - a.grade || b.count - a.count || a.nameEn.localeCompare(b.nameEn),
      ),
      people: people.map(
        (p): IOrgUnitPerson => ({
          userId: p.id,
          name: viewer.names ? p.name : null,
          positionId: p.positionId,
          positionNameEn: p.position?.nameEn ?? null,
          positionNameAr: p.position?.nameAr ?? null,
          isHead: headIds.has(p.id),
        }),
      ),
      committees: { count: node.committees.count, items: committees },
      asOf: new Date(),
    };
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  private loadUnits(organizationId: string): Promise<UnitRow[]> {
    return this.prisma.orgUnit.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      select: UNIT_SELECT,
    });
  }

  private async committeeItems(organizationId: string, orgUnitId: string): Promise<IOrgUnitCommitteeItem[]> {
    const rows = await this.prisma.committee.findMany({
      where: { organizationId, orgUnitId, isActive: true },
      orderBy: { nameEn: 'asc' },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const facts = await committeeStagesAndCounts(this.prisma, organizationId, rows.map((r) => r.id));
    return rows.map((r) => {
      const fact = facts.get(r.id);
      return {
        id: r.id,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        stageNameEn: fact?.stageNameEn ?? null,
        stageNameAr: fact?.stageNameAr ?? null,
        stageKey: fact?.stageKey ?? null,
      };
    });
  }

  /**
   * The facts every node carries, for a set of units in one query per kind.
   * `all` is the tenant's full unit list, for childCount.
   */
  private async decorate(
    organizationId: string,
    units: UnitRow[],
    all: UnitRow[],
    viewer: Viewer,
  ): Promise<IOrgStructureNode[]> {
    if (units.length === 0) return [];
    const ids = units.map((u) => u.id);
    const now = new Date();

    const [types, holders, covers, headcounts, committeeCounts, conditions] = await Promise.all([
      buildOrgUnitTypeResolver(this.prisma, organizationId),
      findCurrentHeadHoldersForUnits(this.prisma, organizationId, ids),
      findRunningActingCoversForUnits(this.prisma, organizationId, ids, now),
      this.prisma.user.groupBy({
        by: ['primaryOrgUnitId'],
        where: { organizationId, status: 'ACTIVE', primaryOrgUnitId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.committee.groupBy({
        by: ['orgUnitId'],
        where: { organizationId, isActive: true, orgUnitId: { in: ids } },
        _count: { _all: true },
      }),
      viewer.attention
        ? this.prisma.setupCondition.findMany({
            where: { organizationId, clearedAt: null, type: { in: UNIT_CONDITION_TYPES }, objectId: { in: ids } },
            select: { objectId: true, type: true, severity: true, openedAt: true },
          })
        : Promise.resolve(null),
    ]);

    const activeChildCount = new Map<string, number>();
    for (const u of all) {
      if (u.isActive && u.parentId) activeChildCount.set(u.parentId, (activeChildCount.get(u.parentId) ?? 0) + 1);
    }
    const headcountByUnit = new Map(headcounts.map((r) => [r.primaryOrgUnitId, r._count._all]));
    const committeesByUnit = new Map(committeeCounts.map((r) => [r.orgUnitId, r._count._all]));
    const attentionByUnit = conditions ? this.highestCondition(conditions) : null;

    return units.map((u): IOrgStructureNode => {
      const cover = covers.get(u.id);
      const node: IOrgStructureNode = {
        id: u.id,
        parentId: u.parentId,
        nameEn: u.nameEn,
        nameAr: u.nameAr,
        code: u.code,
        type: this.typeOf(u, types),
        sortOrder: u.sortOrder,
        isActive: u.isActive,
        childCount: activeChildCount.get(u.id) ?? 0,
        heads: (holders.get(u.id) ?? []).map((h) => ({
          userId: h.id,
          name: viewer.names ? h.name : null,
          positionId: h.positionId,
          positionNameEn: h.position?.nameEn ?? null,
          positionNameAr: h.position?.nameAr ?? null,
          role: h.id === u.pendingHeadUserId ? 'incoming' : 'substantive',
          // The holder rule requires this unit to be their primary unit.
          countedHere: true,
        })),
        acting: cover
          ? {
              userId: cover.userId,
              name: viewer.names ? cover.userName : null,
              reason: cover.reason,
              validFrom: cover.validFrom,
              validTo: cover.validTo,
              countedHere: cover.userPrimaryOrgUnitId === u.id,
            }
          : null,
        headcount: headcountByUnit.get(u.id) ?? 0,
        committees: { count: committeesByUnit.get(u.id) ?? 0 },
      };
      if (attentionByUnit) node.attention = attentionByUnit.get(u.id) ?? null;
      return node;
    });
  }

  private highestCondition(
    rows: Array<{ objectId: string; type: string; severity: IOrgUnitAttention['severity']; openedAt: Date }>,
  ): Map<string, IOrgUnitAttention> {
    const byUnit = new Map<string, IOrgUnitAttention>();
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.objectId, (counts.get(row.objectId) ?? 0) + 1);
    for (const row of rows) {
      const current = byUnit.get(row.objectId);
      const better =
        !current ||
        SEVERITY_RANK[row.severity] < SEVERITY_RANK[current.severity] ||
        (row.severity === current.severity && row.openedAt < current.since);
      if (better) {
        byUnit.set(row.objectId, {
          code: row.type as IOrgUnitAttention['code'],
          severity: row.severity,
          since: row.openedAt,
          openCount: counts.get(row.objectId)!,
        });
      }
    }
    return byUnit;
  }

  // ── the tree, in memory ───────────────────────────────────────────────────

  private typeOf(u: UnitRow, types: Map<string, IOrgUnitType>): IOrgUnitType | null {
    return u.typeValueId ? (types.get(u.typeValueId) ?? null) : null;
  }

  private childrenMap(units: UnitRow[]): Map<string, UnitRow[]> {
    const map = new Map<string, UnitRow[]>();
    for (const u of units) {
      if (!u.parentId) continue;
      const list = map.get(u.parentId) ?? [];
      list.push(u);
      map.set(u.parentId, list);
    }
    for (const list of map.values()) list.sort(bySiblingOrder);
    return map;
  }

  /** The organisation's top unit: the active unit with no parent (ACC-134: one). */
  private topUnit(active: UnitRow[]): UnitRow | undefined {
    return active
      .filter((u) => u.parentId === null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  }

  /**
   * Parents before children, siblings in order. A unit whose parent is not in
   * the set starts a branch of its own; units only reachable through a loop
   * come last, so every unit appears exactly once.
   */
  private treeOrder(units: UnitRow[]): UnitRow[] {
    const ids = new Set(units.map((u) => u.id));
    const children = this.childrenMap(units);
    const starts = units.filter((u) => !u.parentId || !ids.has(u.parentId)).sort(bySiblingOrder);
    const out: UnitRow[] = [];
    const visited = new Set<string>();
    const walk = (u: UnitRow) => {
      if (visited.has(u.id)) return;
      visited.add(u.id);
      out.push(u);
      for (const child of children.get(u.id) ?? []) walk(child);
    };
    starts.forEach(walk);
    for (const u of [...units].sort(bySiblingOrder)) walk(u);
    return out;
  }

  /** From the top down to `unit`, inclusive, walking parentId with a visited set. */
  private pathTo(unit: UnitRow, all: UnitRow[]): IOrgUnitPathItem[] {
    const byId = new Map(all.map((u) => [u.id, u]));
    const path: IOrgUnitPathItem[] = [];
    const visited = new Set<string>();
    let current: UnitRow | undefined = unit;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      path.unshift({ id: current.id, nameEn: current.nameEn, nameAr: current.nameAr });
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
  }
}
