/**
 * ACC-120 slice 5, PR B — WHERE a permission sits in the matrix (D1, D3).
 *
 * The matrix has six columns. Every key lands in exactly ONE of them, or is a
 * WHOLE-ROW grant: a key that fits no column, whose toggle sits in the label
 * column's checkbox slot while all six cells are hatched.
 *
 * ONE function decides, in this order:
 *   1. an explicit override, for the keys whose action name does not say
 *      their column (`users:manage` is an edit; `incidents:report` is how an
 *      incident is created);
 *   2. the action-name rules: `view*` → View, `create*` / `invite` → Create,
 *      `approve*` / `publish` / `verify` / `close` → Approve, `export*` → Audit;
 *   3. otherwise a whole-row grant.
 *
 * The rules come before the fallback so that keys nobody has written yet still
 * land somewhere sensible with no layout change: the task-permission rework's
 * `*:view_all_tasks` reads as View, `*:create_tasks` as Create, and
 * `*:manage_tasks` as a whole-row grant — as committees' did (ACC-244), which
 * retired the flat tasks:* keys. The table in
 * backend/Plans/step-120-5-permission-matrix.md, section A, is what the
 * overrides and rules reproduce. The spec checks every catalogue key against
 * it.
 */

export const MATRIX_COLUMNS = ['view', 'create', 'edit', 'delete', 'approve', 'audit'] as const;
export type MatrixColumn = (typeof MATRIX_COLUMNS)[number];

/** A column, or `'row'` for a whole-row grant. */
export type Placement = MatrixColumn | 'row';

/** Keys whose action name does not say their column. Keyed by the full key. */
const OVERRIDES: Readonly<Record<string, Placement>> = {
  'tenant:update': 'edit',
  'tenant:manage_config': 'edit',
  'users:manage': 'edit',
  'users:transfer': 'edit',
  'users:deactivate': 'delete',
  'committees:edit_details': 'edit',
  'committees:add_member': 'edit',
  'committees:remove_member': 'edit',
  'committees:change_member_role': 'edit',
  'meetings:record_minutes': 'edit',
  'documents:submit': 'edit',
  'documents:review': 'edit',
  'documents:manage_templates': 'edit',
  'documents:manage_numbering': 'edit',
  'standards:link_evidence': 'edit',
  'audits:execute': 'edit',
  'audits:report': 'edit',
  'incidents:report': 'create',
  'incidents:investigate': 'edit',
  'kpi:enter_data': 'edit',
};

/** The column for a key — see the header for the order of the three steps. */
export function placementOf(key: string): Placement {
  const override = OVERRIDES[key];
  if (override) return override;

  const action = key.slice(key.indexOf(':') + 1);
  if (action.startsWith('view')) return 'view';
  if (action.startsWith('create') || action === 'invite') return 'create';
  if (action.startsWith('approve') || action === 'publish' || action === 'verify' || action === 'close') {
    return 'approve';
  }
  if (action.startsWith('export')) return 'audit';
  return 'row';
}

/**
 * D3 — modules in a FIXED product order: the order of the plan's table. A
 * module not listed (one added later) comes after every listed one, in the
 * order the catalogue gives it, so a new module is appended rather than
 * shuffled into the middle.
 */
export const MODULE_ORDER: readonly string[] = [
  'tenant',
  'org',
  'users',
  'roles',
  'lookups',
  'workflows',
  'tasks',
  'committees',
  'notifications',
  'meetings',
  'documents',
  'standards',
  'audits',
  'incidents',
  'billing',
  'reports',
  'positions',
  'setup',
  'kpi',
  'admin',
  'platform',
];

/** Sort key for a module: its place in MODULE_ORDER, else after all of them. */
export function moduleRank(module: string): number {
  const i = MODULE_ORDER.indexOf(module);
  return i === -1 ? MODULE_ORDER.length : i;
}
