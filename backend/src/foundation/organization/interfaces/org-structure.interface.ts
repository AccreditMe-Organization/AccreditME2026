import type { IOrgUnitType } from './org-unit.interface';

/**
 * ACC-120 slice 11 — the read model the tree, the chart and the unit record
 * share (`OrgStructureService`). One node shape, so "who is head", the
 * headcount and the type mean the same thing on all three.
 *
 * WHAT A CALLER SEES (D7, Ahmad): every endpoint needs `org:view`, and
 *   - person names (heads, covers, people) need `users:view`, else null;
 *   - committee names and items need `committees:view`, else counts only;
 *   - `attention` needs `setup:view`, else the property is absent;
 *   - position titles and headcounts are shown to every `org:view` holder.
 * Ids, dates and reasons are never withheld (as `GET …/:id/head`, ACC-133).
 */

/** A head holder of the unit, by the holder rule (`headHolderWhere()`). */
export interface IOrgStructureHead {
  userId: string;
  /** Null without `users:view`. */
  name: string | null;
  positionId: string | null;
  positionNameEn: string | null;
  positionNameAr: string | null;
  /**
   * `incoming` for the pending successor (`OrgUnit.pendingHeadUserId`), who
   * holds the position from the moment they are appointed; `substantive`
   * otherwise. Two heads, one of each, while a successor is pending.
   */
  role: 'substantive' | 'incoming';
  /**
   * Whether this head is counted in the unit's own headcount. Always true for a
   * holder: the holder rule requires the unit to be their primary unit.
   */
  countedHere: boolean;
}

/** The acting cover in force, from `OrgUnitHeadAssignment`, never the cache. */
export interface IOrgStructureActing {
  userId: string;
  /** Null without `users:view`. */
  name: string | null;
  reason: 'VACANCY' | 'ABSENCE' | null;
  validFrom: Date;
  validTo: Date | null;
  /** False when the cover's primary unit is elsewhere: an acting head may come from anywhere. */
  countedHere: boolean;
}

/** The Setup health condition the unit is listed under, highest severity first. */
export interface IOrgUnitAttention {
  code: 'ORG_UNIT_WITHOUT_HEAD' | 'ORG_UNIT_WITHOUT_TYPE' | 'ACTING_HEAD_OPEN_ENDED';
  severity: 'BLOCKS_WORK' | 'AT_RISK';
  /** When that condition opened. */
  since: Date;
  /** How many unit conditions are open on this unit, this one included. */
  openCount: number;
}

export interface IOrgStructureNode {
  id: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string | null;
  code: string;
  /** Both labels, override-resolved (D5); the client picks one. */
  type: IOrgUnitType | null;
  sortOrder: number;
  isActive: boolean;
  /** ACTIVE direct children, including any below a chart's cut-off (D6). */
  childCount: number;
  heads: IOrgStructureHead[];
  acting: IOrgStructureActing | null;
  /** ACTIVE people whose primary unit this is. */
  headcount: number;
  /** ACTIVE committees this unit owns. A count for every caller. */
  committees: { count: number };
  /**
   * Present only for a caller with `setup:view`: the highest open condition,
   * or null when none is open. ABSENT otherwise, not null.
   */
  attention?: IOrgUnitAttention | null;
}

export interface IOrgUnitPathItem {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

/** `GET /organization/units/structure` */
export interface IOrgStructureResponse {
  nodes: IOrgStructureNode[];
  asOf: Date;
}

export interface IOrgChartNode extends IOrgStructureNode {
  /** 0 for the root of the window, up to `depth - 1`. */
  depth: number;
}

/** `GET /organization/units/chart` */
export interface IOrgChartResponse {
  root: {
    id: string;
    /** From the organisation's top unit down to the root of the window, inclusive. */
    path: IOrgUnitPathItem[];
  };
  /** The levels returned, after the cap of 4. */
  depth: number;
  nodes: IOrgChartNode[];
  asOf: Date;
}

/** A position held by the unit's people (positions have no unit of their own). */
export interface IOrgUnitPositionInUse {
  positionId: string;
  nameEn: string;
  nameAr: string | null;
  grade: number;
  isUnitHeadPosition: boolean;
  /** ACTIVE people of the unit holding it. */
  count: number;
}

export interface IOrgUnitPerson {
  userId: string;
  /** Null without `users:view`. */
  name: string | null;
  positionId: string | null;
  positionNameEn: string | null;
  positionNameAr: string | null;
  /** One of the unit's head holders. */
  isHead: boolean;
}

export interface IOrgUnitCommitteeItem {
  id: string;
  nameEn: string;
  nameAr: string | null;
  stageNameEn: string | null;
  stageNameAr: string | null;
}

/** `GET /organization/units/:id/summary` — the record page and the chart's side panel. */
export interface IOrgUnitSummary {
  unit: IOrgStructureNode & {
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  /** From the organisation's top unit down to this unit, inclusive. */
  path: IOrgUnitPathItem[];
  /** Direct ACTIVE children, in sibling order (sortOrder, then name). */
  children: IOrgStructureNode[];
  /** Grade high to low, then the most people, then the name. */
  positions: IOrgUnitPositionInUse[];
  /** ACTIVE people whose primary unit this is. */
  people: IOrgUnitPerson[];
  committees: {
    count: number;
    /** Null without `committees:view`. */
    items: IOrgUnitCommitteeItem[] | null;
  };
  asOf: Date;
}
