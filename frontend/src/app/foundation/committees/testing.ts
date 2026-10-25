import type { CommitteeStageRulesDto } from './services/committee.service';

/**
 * ACC-255 PR 3 — for specs only: what the server answers as `stageRules` for a
 * committee in each stage of the SEEDED committee workflow (the backend's
 * workflow.seed.ts, after PR 2: a dissolved committee allows no member change).
 * A spec passes the server's answer, never a stage key, exactly as the page
 * receives it. Named by meaning; no stage key is written here.
 */
const rules = (actions: (keyof CommitteeStageRulesDto['actions'])[], flags: string[] = []): CommitteeStageRulesDto => ({
  actions: {
    edit_details: actions.includes('edit_details'),
    add_member: actions.includes('add_member'),
    remove_member: actions.includes('remove_member'),
    change_member_role: actions.includes('change_member_role'),
    request_change: actions.includes('request_change'),
  },
  flags,
});

const MEMBERS = ['add_member', 'remove_member', 'change_member_role'] as const;

/** The seeded stages' answers, in lifecycle order, with the name each stage is seeded with. */
export const SEEDED_STAGE_RULES: readonly { stage: string; rules: CommitteeStageRulesDto }[] = [
  { stage: 'Formation', rules: rules(['edit_details', ...MEMBERS]) },
  { stage: 'Terms Review', rules: rules([...MEMBERS]) },
  { stage: 'Active', rules: rules([...MEMBERS, 'request_change'], ['IN_FORCE']) },
  { stage: 'Suspended', rules: rules([...MEMBERS, 'request_change'], ['IN_FORCE']) },
  { stage: 'Dissolution Pending', rules: rules([...MEMBERS], ['DISSOLVING']) },
  { stage: 'Dissolved', rules: rules([], ['DISSOLVING']) },
];

export const FORMATION_RULES = SEEDED_STAGE_RULES[0]!.rules;
export const TERMS_REVIEW_RULES = SEEDED_STAGE_RULES[1]!.rules;
export const ACTIVE_RULES = SEEDED_STAGE_RULES[2]!.rules;
export const DISSOLVED_RULES = SEEDED_STAGE_RULES[5]!.rules;

/** A stage a tenant configured to allow exactly `actions`, with `flags`. */
export const tenantStageRules = rules;
