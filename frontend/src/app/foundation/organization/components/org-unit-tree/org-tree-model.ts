import type { OrgStructureNodeDto } from '../../services/org-unit.service';

/**
 * ACC-120 slice 11 (PR C) — the tree's pure model, over PR B's structure
 * response. No Angular here, so every rule the toolbar applies is tested
 * directly: what matches, which ancestors stay as context, and what "levels"
 * means.
 */

/** The Type filter's value for a unit with no type: "(No type)". */
export const NO_TYPE = '__no-type__';

export function typeKeyOf(node: OrgStructureNodeDto): string {
  return node.type?.id ?? NO_TYPE;
}

/** Children by parent id, in the server's order (sortOrder, then name). */
export function childrenOf(nodes: OrgStructureNodeDto[]): Map<string | null, OrgStructureNodeDto[]> {
  const ids = new Set(nodes.map((n) => n.id));
  const map = new Map<string | null, OrgStructureNodeDto[]>();
  for (const node of nodes) {
    // A unit whose parent is not in the set starts a branch of its own.
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const list = map.get(parent) ?? [];
    list.push(node);
    map.set(parent, list);
  }
  return map;
}

/** Each unit's depth from its branch's top (0), walking parents with a visited set. */
export function depthsOf(nodes: OrgStructureNodeDto[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depths = new Map<string, number>();
  for (const node of nodes) {
    let depth = 0;
    let current = node;
    const seen = new Set<string>([node.id]);
    while (current.parentId && byId.has(current.parentId) && !seen.has(current.parentId)) {
      seen.add(current.parentId);
      current = byId.get(current.parentId)!;
      depth += 1;
    }
    depths.set(node.id, depth);
  }
  return depths;
}

/** "21 units · 4 levels": active units, and the deepest active level counted from 1. */
export function unitAndLevelCount(nodes: OrgStructureNodeDto[]): { units: number; levels: number } {
  const active = nodes.filter((n) => n.isActive);
  const depths = depthsOf(active);
  const deepest = active.reduce((max, n) => Math.max(max, depths.get(n.id) ?? 0), -1);
  return { units: active.length, levels: deepest + 1 };
}

export interface TreeFilter {
  /** Trimmed; empty means no search. */
  query: string;
  /** Type ids (and NO_TYPE); empty means every type. */
  types: string[];
  /** Inactive units too (org:manage only). */
  showInactive: boolean;
}

export interface FilterResult {
  /** Units shown: the matches and their ancestors. */
  visible: Set<string>;
  /** Units that satisfy the search and the Type filter. */
  matches: Set<string>;
  /** Shown only as the path to a match: dimmed. */
  ancestors: Set<string>;
  /** True when a search or a Type filter is narrowing the tree. */
  narrowing: boolean;
}

const fold = (s: string) => s.toLocaleLowerCase();

/** A search matches either name or the code, in any letter case. */
export function matchesQuery(node: OrgStructureNodeDto, query: string): boolean {
  if (!query) return true;
  const q = fold(query);
  return [node.nameEn, node.nameAr ?? '', node.code].some((text) => fold(text).includes(q));
}

/**
 * The tree the toolbar asks for (OS L530): matches stay, their ancestors stay
 * as muted context so the path reads, and siblings that don't match go.
 * Flattening would lose the one thing that tells three "Pharmacy" sections
 * apart.
 */
export function filterTree(nodes: OrgStructureNodeDto[], filter: TreeFilter): FilterResult {
  const inScope = nodes.filter((n) => filter.showInactive || n.isActive);
  const byId = new Map(inScope.map((n) => [n.id, n]));
  const narrowing = filter.query.length > 0 || filter.types.length > 0;
  const types = new Set(filter.types);

  const matches = new Set<string>();
  for (const node of inScope) {
    if (types.size > 0 && !types.has(typeKeyOf(node))) continue;
    if (!matchesQuery(node, filter.query)) continue;
    matches.add(node.id);
  }

  const ancestors = new Set<string>();
  if (narrowing) {
    for (const id of matches) {
      let parentId = byId.get(id)!.parentId;
      const seen = new Set<string>([id]);
      while (parentId && byId.has(parentId) && !seen.has(parentId)) {
        seen.add(parentId);
        if (!matches.has(parentId)) ancestors.add(parentId);
        parentId = byId.get(parentId)!.parentId;
      }
    }
  }

  const visible = new Set<string>([...matches, ...ancestors]);
  return { visible, matches, ancestors, narrowing };
}

/** The default: the top level open, so its children (level 2) show, collapsed (D9). */
export function defaultExpanded(nodes: OrgStructureNodeDto[]): Set<string> {
  const depths = depthsOf(nodes);
  return new Set(nodes.filter((n) => (depths.get(n.id) ?? 0) === 0).map((n) => n.id));
}
