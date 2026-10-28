import { PermissionDto } from '../services/role.service';
import { GROUP_THRESHOLD, PERMISSION_GROUPS } from './permission-groups';

/**
 * ACC-272 — a role's permissions as a grouped LIST, as data apart from the
 * screen (it replaced ACC-120 slice 5's six-column grid).
 *
 * Pure functions over the catalogue and two key sets — the set the page
 * LOADED and the set as edited now — so the rules (what is shown, what a box
 * toggles, what a filter shows, what counts as a change) are tested without
 * rendering anything. No row implies another: a box grants only its own keys.
 */

export interface MatrixPermission {
  key: string;
  module: string;
  action: string;
}

/** A module's rows, under a group name, or under none (`id` null). */
export interface MatrixGroup {
  id: string | null;
  permissions: MatrixPermission[];
  keys: string[];
}

export interface MatrixModule {
  module: string;
  /** One unnamed group, or the module's named groups from PERMISSION_GROUPS. */
  groups: MatrixGroup[];
  /** Every row of the module, in the order shown. */
  permissions: MatrixPermission[];
  keys: string[];
}

/** All, some or none of a set of keys granted. */
export type TriState = 'all' | 'some' | 'none';

/** A row's mark: held or not, as saved, or changed and not saved yet. */
export type RowMark = 'on' | 'off' | 'granted' | 'revoked';

/** What the list shows: never what is saved (the design's decision 5). */
export interface ListFilter {
  /** Matched against each row's sentence in the reader's language. */
  query: string;
  /** Held rows (as edited now), and every changed row. */
  grantedOnly: boolean;
}

export const NO_FILTER: ListFilter = { query: '', grantedOnly: false };

/**
 * D3 — modules in a FIXED product order. A module not listed (one added
 * later) comes after every listed one, in the order the catalogue gives it,
 * so a new module is appended rather than shuffled into the middle.
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

/**
 * The modules and permissions the list shows.
 *
 * ONLY keys some code checks today (`inUse`, R2): a key nothing decides with
 * would be a checkbox that does nothing, and the server keeps those as the
 * role holds them whatever is sent. Platform keys are hidden INSIDE A TENANT
 * (D2). ACC-258: a `rootRoleOnly` key (workflows:manage) is shown only on the
 * root role, whose list is read-only.
 *
 * Modules come in the fixed product order. A module over GROUP_THRESHOLD rows
 * is split into the groups of PERMISSION_GROUPS, in the table's order; every
 * other module keeps catalogue order under one unnamed group.
 */
export function buildMatrix(catalogue: readonly PermissionDto[], opts: { isTenant: boolean; isRootRole?: boolean }): MatrixModule[] {
  const firstSeen = new Map<string, number>();
  const byModule = new Map<string, MatrixPermission[]>();
  catalogue.forEach((p, i) => {
    if (!p.inUse) return;
    if (opts.isTenant && p.module === 'platform') return;
    if (p.rootRoleOnly && !opts.isRootRole) return;
    if (!firstSeen.has(p.module)) firstSeen.set(p.module, i);
    const list = byModule.get(p.module) ?? [];
    list.push({ key: `${p.module}:${p.action}`, module: p.module, action: p.action });
    byModule.set(p.module, list);
  });

  return [...byModule.entries()]
    .sort(([a], [b]) => moduleRank(a) - moduleRank(b) || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0))
    .map(([module, perms]) => {
      const groups = groupsOf(module, perms);
      const permissions = groups.flatMap((g) => g.permissions);
      return { module, groups, permissions, keys: permissions.map((p) => p.key) };
    });
}

function groupsOf(module: string, perms: MatrixPermission[]): MatrixGroup[] {
  const defs = PERMISSION_GROUPS[module];
  const group = (id: string | null, list: MatrixPermission[]): MatrixGroup => ({ id, permissions: list, keys: list.map((p) => p.key) });
  if (!defs || perms.length <= GROUP_THRESHOLD) return [group(null, perms)];
  const byKey = new Map(perms.map((p) => [p.key, p]));
  const placed = new Set<string>();
  const named = defs
    .map((d) => {
      const list = d.keys.map((k) => byKey.get(k)).filter((p): p is MatrixPermission => !!p && !placed.has(p.key));
      list.forEach((p) => placed.add(p.key));
      return group(d.id, list);
    })
    .filter((g) => g.permissions.length > 0);
  // A shown key no group names is never dropped: it keeps catalogue order at
  // the end (permission-groups.spec.ts fails the table before it gets here).
  const rest = perms.filter((p) => !placed.has(p.key));
  return rest.length ? [...named, group(null, rest)] : named;
}

export function heldCount(keys: readonly string[], selected: ReadonlySet<string>): number {
  return keys.filter((k) => selected.has(k)).length;
}

export function triState(keys: readonly string[], selected: ReadonlySet<string>): TriState {
  const held = heldCount(keys, selected);
  if (held === 0) return 'none';
  return held === keys.length ? 'all' : 'some';
}

export function markOf(key: string, selected: ReadonlySet<string>, loaded: ReadonlySet<string>): RowMark {
  const now = selected.has(key);
  if (now === loaded.has(key)) return now ? 'on' : 'off';
  return now ? 'granted' : 'revoked';
}

/**
 * Toggle a group of keys the way a tri-state box does: if every one is
 * granted, revoke them all; otherwise grant them all. A mixed or empty box
 * grants every row; a full one revokes every row.
 */
export function toggleKeys(keys: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const allHeld = keys.length > 0 && keys.every((k) => next.has(k));
  for (const k of keys) {
    if (allHeld) next.delete(k);
    else next.add(k);
  }
  return next;
}

export function filterActive(filter: ListFilter): boolean {
  return filter.query.trim() !== '' || filter.grantedOnly;
}

/**
 * Whether a row shows under the filter. The query matches the row's sentence
 * in the reader's language, ignoring case; "Show granted only" keeps the rows
 * held as edited now AND every changed row, so an unsaved revocation is never
 * hidden by the filter that would otherwise drop it.
 */
export function rowVisible(
  key: string,
  sentence: string,
  filter: ListFilter,
  selected: ReadonlySet<string>,
  loaded: ReadonlySet<string>,
): boolean {
  const query = filter.query.trim().toLocaleLowerCase();
  if (query && !sentence.toLocaleLowerCase().includes(query)) return false;
  if (filter.grantedOnly && !selected.has(key) && !loaded.has(key)) return false;
  return true;
}

/** The keys of `permissions` that show under the filter, in order. */
export function visibleKeys(
  permissions: readonly MatrixPermission[],
  sentenceOf: (key: string) => string,
  filter: ListFilter,
  selected: ReadonlySet<string>,
  loaded: ReadonlySet<string>,
): string[] {
  return permissions.filter((p) => rowVisible(p.key, sentenceOf(p.key), filter, selected, loaded)).map((p) => p.key);
}

export interface MatrixChanges {
  added: MatrixPermission[];
  removed: MatrixPermission[];
}

/**
 * What a save would change, in the list's own row order. Only shown keys can
 * be changed, so a held hidden key never appears here; it is sent back as held.
 */
export function changesOf(
  modules: readonly MatrixModule[],
  selected: ReadonlySet<string>,
  loaded: ReadonlySet<string>,
): MatrixChanges {
  const added: MatrixPermission[] = [];
  const removed: MatrixPermission[] = [];
  for (const m of modules) {
    for (const p of m.permissions) {
      const mark = markOf(p.key, selected, loaded);
      if (mark === 'granted') added.push(p);
      else if (mark === 'revoked') removed.push(p);
    }
  }
  return { added, removed };
}
