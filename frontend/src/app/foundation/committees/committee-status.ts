import { STAGE_FLAG_DISSOLVING, STAGE_FLAG_IN_FORCE } from './committee-offers';

/** A committee's state as the list shows and filters it, in lifecycle order. */
export const COMMITTEE_LIST_STATUSES = ['NOT_YET_IN_FORCE', 'IN_FORCE', 'DISSOLVING', 'INACTIVE'] as const;
export type CommitteeListStatus = (typeof COMMITTEE_LIST_STATUSES)[number];

// ACC-256 (Ahmad, 25 Oct) — read from the current stage's FLAGS, never its name
// or key, so a stage a tenant renames or adds reads by what it means:
//   - the committee record is inactive               → Inactive (Dissolved);
//   - the stage is flagged DISSOLVING                → Being dissolved;
//   - the stage is flagged IN_FORCE                  → In force (Active, Suspended);
//   - no flag, or no live stage at all (D14)         → Not yet in force
//                                                      (Formation, Terms Review).
//
// ACC-279 — moved here from the committees list so the list and Home's My
// committees read ONE rule. committeeStatusOf() is the rule; the list's
// committeeListStatus() feeds it from stageRules, Home from the row's booleans.
export function committeeStatusOf(c: { isActive: boolean; isDissolving: boolean; isInForce: boolean }): CommitteeListStatus {
  if (!c.isActive) return 'INACTIVE';
  if (c.isDissolving) return 'DISSOLVING';
  return c.isInForce ? 'IN_FORCE' : 'NOT_YET_IN_FORCE';
}

export function committeeListStatus(c: { isActive: boolean; stageRules?: { flags: readonly string[] } | null }): CommitteeListStatus {
  const flags = c.stageRules?.flags ?? [];
  return committeeStatusOf({
    isActive: c.isActive,
    isDissolving: flags.includes(STAGE_FLAG_DISSOLVING),
    isInForce: flags.includes(STAGE_FLAG_IN_FORCE),
  });
}
