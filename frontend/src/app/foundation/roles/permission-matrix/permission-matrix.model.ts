import { PermissionDto } from '../services/role.service';
import { MATRIX_COLUMNS, MatrixColumn, Placement, moduleRank, placementOf } from './permission-columns';

/**
 * ACC-120 slice 5, PR B — the matrix as data, apart from the screen.
 *
 * Pure functions over the catalogue and two key sets — the set the page
 * LOADED and the set as edited now — so the rules (what is shown, what a click
 * toggles, what counts as a change) are tested without rendering anything.
 */

export interface MatrixPermission {
  key: string;
  module: string;
  action: string;
  placement: Placement;
}

export interface MatrixModule {
  module: string;
  permissions: MatrixPermission[];
  /** Every key of the module, whole-row grants included. */
  keys: string[];
  /** The module's keys in each column. Empty where the module has none: that cell is hatched. */
  byColumn: Record<MatrixColumn, string[]>;
}

export type MatrixRow =
  | { kind: 'module'; module: MatrixModule }
  | { kind: 'permission'; module: MatrixModule; permission: MatrixPermission };

/** All, some or none of a set of keys granted. */
export type TriState = 'all' | 'some' | 'none';

/** A single key's cell: saved on or off, or changed and not saved yet. */
export type CellMark = 'on' | 'off' | 'granted' | 'revoked';

/** The column-0 slot, before the six action columns. Cells are numbered 0–6. */
export const LABEL_CELL = 0;
export const CELL_COUNT = 1 + MATRIX_COLUMNS.length;

/**
 * The modules and permissions the matrix shows.
 *
 * ONLY keys some code checks today (`inUse`, R2): a key nothing decides with
 * would be a checkbox that does nothing, and the server keeps those as the
 * role holds them whatever is sent. Platform keys are hidden INSIDE A TENANT
 * (D2): they mean nothing there, and a tenant role may not gain one (R1).
 *
 * Modules come in the fixed product order (D3). Inside a module, rows follow
 * the columns left to right, then the whole-row grants; within one column,
 * catalogue order.
 */
export function buildMatrix(catalogue: readonly PermissionDto[], opts: { isTenant: boolean }): MatrixModule[] {
  const firstSeen = new Map<string, number>();
  const byModule = new Map<string, MatrixPermission[]>();
  catalogue.forEach((p, i) => {
    if (!p.inUse) return;
    if (opts.isTenant && p.module === 'platform') return;
    if (!firstSeen.has(p.module)) firstSeen.set(p.module, i);
    const key = `${p.module}:${p.action}`;
    const list = byModule.get(p.module) ?? [];
    list.push({ key, module: p.module, action: p.action, placement: placementOf(key) });
    byModule.set(p.module, list);
  });

  const placementRank = (pl: Placement): number =>
    pl === 'row' ? MATRIX_COLUMNS.length : MATRIX_COLUMNS.indexOf(pl);

  return [...byModule.entries()]
    .sort(([a], [b]) => moduleRank(a) - moduleRank(b) || (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0))
    .map(([module, perms]) => {
      // A stable sort keeps catalogue order within a column.
      const permissions = [...perms].sort((x, y) => placementRank(x.placement) - placementRank(y.placement));
      const byColumn = Object.fromEntries(
        MATRIX_COLUMNS.map((c) => [c, permissions.filter((p) => p.placement === c).map((p) => p.key)]),
      ) as Record<MatrixColumn, string[]>;
      return { module, permissions, keys: permissions.map((p) => p.key), byColumn };
    });
}

/** The rows in reading order: each module's header row, then its permissions. */
export function matrixRows(modules: readonly MatrixModule[]): MatrixRow[] {
  return modules.flatMap((module) => [
    { kind: 'module' as const, module },
    ...module.permissions.map((permission) => ({ kind: 'permission' as const, module, permission })),
  ]);
}

/**
 * The keys a cell toggles, or null where the cell toggles nothing (hatched, or
 * a column-placed permission's label).
 *
 * - A module row: its label toggles the WHOLE module (the tri-state checkbox);
 *   each column toggles that module's keys in the column.
 * - A whole-row grant: its label is the toggle, and all six cells are hatched.
 * - Any other permission: exactly one column is its toggle.
 */
export function cellKeys(row: MatrixRow, cell: number): string[] | null {
  if (row.kind === 'module') {
    if (cell === LABEL_CELL) return row.module.keys.length > 0 ? row.module.keys : null;
    const keys = row.module.byColumn[MATRIX_COLUMNS[cell - 1]];
    return keys.length > 0 ? keys : null;
  }
  const { permission } = row;
  if (cell === LABEL_CELL) return permission.placement === 'row' ? [permission.key] : null;
  return MATRIX_COLUMNS[cell - 1] === permission.placement ? [permission.key] : null;
}

/** What Shift+Space toggles: the module's every key, or the permission's one. */
export function rowKeys(row: MatrixRow): string[] {
  return row.kind === 'module' ? row.module.keys : [row.permission.key];
}

export function triState(keys: readonly string[], selected: ReadonlySet<string>): TriState {
  const held = keys.filter((k) => selected.has(k)).length;
  if (held === 0) return 'none';
  return held === keys.length ? 'all' : 'some';
}

export function markOf(key: string, selected: ReadonlySet<string>, loaded: ReadonlySet<string>): CellMark {
  const now = selected.has(key);
  if (now === loaded.has(key)) return now ? 'on' : 'off';
  return now ? 'granted' : 'revoked';
}

/**
 * Toggle a group of keys the way a tri-state checkbox does: if every one is
 * granted, revoke them all; otherwise grant them all. A partial group is
 * completed, never emptied, by one press.
 */
export function toggleKeys(keys: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const allHeld = keys.every((k) => next.has(k));
  for (const k of keys) {
    if (allHeld) next.delete(k);
    else next.add(k);
  }
  return next;
}

export interface MatrixChanges {
  added: MatrixPermission[];
  removed: MatrixPermission[];
}

/**
 * What a save would change, in the matrix's own row order. Only shown keys can
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

/** Whether any key in a group differs from what was loaded. */
export function groupChanged(keys: readonly string[], selected: ReadonlySet<string>, loaded: ReadonlySet<string>): boolean {
  return keys.some((k) => selected.has(k) !== loaded.has(k));
}
