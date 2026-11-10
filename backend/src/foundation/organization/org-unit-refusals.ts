import { ConflictException } from '@nestjs/common';

/**
 * ACC-120 slice 11 — a unit can't be placed under itself or under one of its
 * own sub-units.
 *
 * Moving a unit moves its whole subtree, so a parent inside that subtree would
 * detach the branch from the root and close a loop: every walk up the tree
 * (the breadcrumb, head resolution, the chart's root path) would then never
 * reach the top. The dialog greys these choices out; this is the rule the
 * server keeps regardless of what a client sends.
 *
 * The screen says it from `code`, never from the English `message`.
 */
export const ORG_UNIT_PARENT_CYCLE = 'ORG_UNIT_PARENT_CYCLE';

export class OrgUnitParentCycleRefusal extends ConflictException {
  readonly code = ORG_UNIT_PARENT_CYCLE;

  constructor() {
    super({
      statusCode: 409,
      message: "A unit can't be placed under itself or one of its own sub-units.",
      error: 'Conflict',
      code: ORG_UNIT_PARENT_CYCLE,
    });
  }
}

/**
 * ACC-120 slice 11 — a unit that still has active dependencies can't be
 * deactivated. Each blocker is a code and a count, so the screen can say each
 * one in the reader's language and link to it (Show in tree, Show in Users).
 * `message` stays, in English, for clients that read only it.
 */
export const ORG_UNIT_HAS_DEPENDENCIES = 'ORG_UNIT_HAS_DEPENDENCIES';

export type OrgUnitDependencyCode = 'ACTIVE_CHILDREN' | 'ACTIVE_USERS' | 'ACTIVE_COMMITTEES';

export interface OrgUnitDependencyBlocker {
  code: OrgUnitDependencyCode;
  count: number;
}

export class OrgUnitHasDependenciesRefusal extends ConflictException {
  readonly code = ORG_UNIT_HAS_DEPENDENCIES;

  constructor(readonly blockers: OrgUnitDependencyBlocker[]) {
    super({
      statusCode: 409,
      message: 'Cannot deactivate org unit — active dependencies exist',
      error: 'Conflict',
      code: ORG_UNIT_HAS_DEPENDENCIES,
      blockers,
    });
  }
}

/**
 * ACC-288 — the root unit always keeps a head or an acting head in force
 * (Ahmad, 10 Nov). A change that would leave it with neither is refused.
 *
 * The body names the root (`unitNameEn` / `unitNameAr`, the organisation's own
 * name) so the screen can say the sentence in the reader's language with the
 * name in place; the screen says it from `code`, never from the English
 * `message`. Thrown only by `root-unit-head.invariant.ts`.
 */
export const ROOT_UNIT_NEEDS_HEAD = 'ROOT_UNIT_NEEDS_HEAD';

export class RootUnitNeedsHeadRefusal extends ConflictException {
  readonly code = ROOT_UNIT_NEEDS_HEAD;

  constructor(
    readonly unitId: string,
    readonly unitNameEn: string,
    readonly unitNameAr: string | null,
  ) {
    super({
      statusCode: 409,
      message: `${unitNameEn} must always have a head or an acting head. Appoint a successor or an acting head first.`,
      error: 'Conflict',
      code: ROOT_UNIT_NEEDS_HEAD,
      unitId,
      unitNameEn,
      unitNameAr,
    });
  }
}
