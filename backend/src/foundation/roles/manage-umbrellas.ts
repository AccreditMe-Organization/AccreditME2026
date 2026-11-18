import * as Catalogue from '../../common/constants/permissions';

/**
 * ACC-77 — ACC-44's umbrella rule, as data: a role that holds a module's
 * umbrella key holds every one of that module's specific keys DIRECTLY, at seed
 * time. Nothing implies anything at runtime (getUserPermissions() resolves the
 * strings a role holds, and nothing more).
 *
 * An UMBRELLA is `{module}:manage`, or a record type's `{type}:manage_tasks`
 * (ACC-244 replaced the flat tasks:* keys with per-type task keys, so the task
 * half of the rule is the task group's own umbrella). Its SPECIFICS are the
 * other keys of its own `*_PERMISSIONS` group, less any key no code checks yet
 * (PERMISSIONS_NOT_YET_CHECKED): a key that cannot be granted is never seeded
 * by this rule.
 *
 * Read by manage-umbrellas.spec.ts (the seed holds it) and by
 * backfill:acc77-manage-umbrellas (existing system roles are given it).
 */
const UMBRELLA = /:(manage|manage_tasks)$/;
const notYetChecked = new Set(Catalogue.PERMISSIONS_NOT_YET_CHECKED);

const GROUPS: readonly (readonly string[])[] = Object.entries(Catalogue)
  .filter(([name, value]) => name.endsWith('_PERMISSIONS') && !!value && typeof value === 'object' && !Array.isArray(value))
  .map(([, group]) => Object.values(group as Record<string, string>));

/** umbrella → its specific keys, for every umbrella in the catalogue. */
export const MANAGE_UMBRELLAS: ReadonlyMap<string, readonly string[]> = new Map(
  GROUPS.flatMap((keys) =>
    keys.filter((k) => UMBRELLA.test(k)).map((umbrella) => [umbrella, keys.filter((k) => k !== umbrella && !notYetChecked.has(k))] as const),
  ),
);

/** The specifics a role holding `held` lacks, umbrella by umbrella (empty when it lacks none). */
export function missingSpecifics(held: ReadonlySet<string>): { umbrella: string; missing: string[] }[] {
  return [...MANAGE_UMBRELLAS]
    .filter(([umbrella]) => held.has(umbrella))
    .map(([umbrella, specifics]) => ({ umbrella, missing: specifics.filter((k) => !held.has(k)) }))
    .filter((g) => g.missing.length > 0);
}
