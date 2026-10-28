/**
 * ACC-272 — the role permissions list's GROUPS: a module with more than
 * GROUP_THRESHOLD shown permissions is split into labelled groups, each with
 * its own tri-state box and count (the design's Q1, "from more than six").
 *
 * One small table, so the groups are data, not layout. A group lists its keys
 * in the order they are shown; a module's groups must cover every key it shows
 * exactly once (`permission-groups.spec.ts` fails otherwise, and fails a module
 * over the threshold with no groups). Each group's name is
 * `roles.matrix.group.<module>.<id>` in both languages.
 *
 * It names keys but checks none, so the backend's permissions-in-use spec lists
 * this file among the ones that only declare keys.
 */

/** A module with MORE than this many shown permissions is split into groups. */
export const GROUP_THRESHOLD = 6;

export interface PermissionGroupDef {
  /** The group's id, for its name `roles.matrix.group.<module>.<id>`. */
  id: string;
  /** Its keys, in the order the rows are shown. */
  keys: readonly string[];
}

export const PERMISSION_GROUPS: Readonly<Record<string, readonly PermissionGroupDef[]>> = {
  committees: [
    {
      id: 'records',
      keys: ['committees:view', 'committees:create', 'committees:edit_details', 'committees:approve', 'committees:manage'],
    },
    { id: 'members', keys: ['committees:add_member', 'committees:remove_member', 'committees:change_member_role'] },
    // The four task rows every task-bearing module will get (the design's decision 3).
    {
      id: 'tasks',
      keys: ['committees:view_all_tasks', 'committees:view_unit_tasks', 'committees:create_tasks', 'committees:manage_tasks'],
    },
  ],
};
