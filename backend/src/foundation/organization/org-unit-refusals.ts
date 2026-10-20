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
