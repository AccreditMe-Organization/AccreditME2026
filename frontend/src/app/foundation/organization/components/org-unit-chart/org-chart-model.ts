import { OrgChartNodeDto, OrgChartResponseDto } from '../../services/org-unit.service';

/**
 * ACC-120 slice 11, PR E — the chart's model, kept out of the components so
 * the rules are pure and tested on their own: the window as a tree, which
 * levels carry the "N sub-units below" button, and where an arrow key goes.
 */

/** The chart shows this many levels from its root (OS L570). The API caps it too. */
export const CHART_LEVELS = 4;

export interface ChartBox {
  node: OrgChartNodeDto;
  /** 1-based: the window's root is level 1. */
  level: number;
  /** Active children not rendered (below the window's last level): the button's count. */
  below: number;
  children: ChartBox[];
  parent: ChartBox | null;
  /** Position among its siblings, 1-based, for aria-posinset. */
  index: number;
}

export interface ChartModel {
  root: ChartBox | null;
  byId: Map<string, ChartBox>;
  /** Levels where at least one box carries the button: every box there takes the tall height. */
  tallLevels: Set<number>;
  /** Levels where at least one box owns committees (only used while committees are shown). */
  committeeLevels: Set<number>;
}

/**
 * The response as a tree, in the server's order (siblings already sorted). A
 * node whose parent isn't in the window is dropped, apart from the root, so a
 * stray row can never draw a second tree.
 */
export function buildChart(res: OrgChartResponseDto): ChartModel {
  const byId = new Map<string, ChartBox>();
  const tallLevels = new Set<number>();
  const committeeLevels = new Set<number>();
  const rootNode = res.nodes.find((n) => n.id === res.root.id);
  if (!rootNode) return { root: null, byId, tallLevels, committeeLevels };

  const byParent = new Map<string, OrgChartNodeDto[]>();
  for (const n of res.nodes) {
    if (n.id === rootNode.id || !n.parentId) continue;
    byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
  }

  const make = (n: OrgChartNodeDto, level: number, parent: ChartBox | null, index: number): ChartBox => {
    const box: ChartBox = { node: n, level, below: 0, children: [], parent, index };
    byId.set(n.id, box);
    const kids = level < CHART_LEVELS ? (byParent.get(n.id) ?? []).filter((k) => !byId.has(k.id)) : [];
    box.children = kids.map((k, i) => make(k, level + 1, box, i + 1));
    box.below = box.children.length === 0 ? n.childCount : 0;
    if (box.below > 0) tallLevels.add(level);
    if (n.committees.count > 0) committeeLevels.add(level);
    return box;
  };
  return { root: make(rootNode, 1, null, 1), byId, tallLevels, committeeLevels };
}

/** The boxes in reading order (depth-first), for counting and for tests. */
export function allBoxes(model: ChartModel): ChartBox[] {
  const out: ChartBox[] = [];
  const walk = (b: ChartBox) => {
    out.push(b);
    b.children.forEach(walk);
  };
  if (model.root) walk(model.root);
  return out;
}

export type ChartKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/**
 * Where an arrow key moves focus, in VISUAL direction: up to the parent, down
 * to the first child, left and right to the neighbouring sibling as drawn. In
 * Arabic the row is drawn right to left, so Right goes to the PREVIOUS sibling
 * (OS L577). Home and End go to the root and to the last box in reading order.
 * Returns null where there is nowhere to go; focus then stays put.
 */
export function moveFocus(model: ChartModel, fromId: string, key: ChartKey, rtl: boolean): string | null {
  const from = model.byId.get(fromId);
  if (!from) return model.root?.node.id ?? null;
  const siblings = from.parent?.children ?? [from];
  const i = siblings.indexOf(from);
  switch (key) {
    case 'ArrowUp':
      return from.parent?.node.id ?? null;
    case 'ArrowDown':
      return from.children[0]?.node.id ?? null;
    case 'ArrowRight':
      return siblings[rtl ? i - 1 : i + 1]?.node.id ?? null;
    case 'ArrowLeft':
      return siblings[rtl ? i + 1 : i - 1]?.node.id ?? null;
    case 'Home':
      return model.root?.node.id ?? null;
    case 'End': {
      const all = allBoxes(model);
      return all[all.length - 1]?.node.id ?? null;
    }
  }
}

/** Initials from a visible name: the first letters of its last two capitalised words. */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return '';
  const words = name.split(/\s+/).filter((w) => /^\p{Lu}/u.test(w) && !/^(Dr\.?|Prof\.?)$/i.test(w));
  return words
    .slice(-2)
    .map((w) => w[0])
    .join('');
}

/**
 * The head line's subject (D7): the head's name, else — names withheld — the
 * position title the API returns, else "Head assigned". An acting head stands
 * in when there is no head. Null when the unit has neither.
 */
export function headSubject(
  node: OrgChartNodeDto,
  t: (key: string, params?: Record<string, unknown>) => string,
  bilingual: (en: string, ar: string | null) => string,
): { text: string; name: string | null; incoming: string | null; acting: boolean } | null {
  const heads = [...node.heads].sort((a, b) => (a.role === b.role ? 0 : a.role === 'substantive' ? -1 : 1));
  const head = heads[0];
  if (head) {
    const position = head.positionNameEn ? bilingual(head.positionNameEn, head.positionNameAr) : null;
    const incoming = heads.find((h) => h.role === 'incoming' && h !== head);
    return {
      text: head.name ?? position ?? t('headship.head.assigned'),
      name: head.name,
      incoming: incoming ? (incoming.name ?? t('headship.head.assigned')) : null,
      acting: false,
    };
  }
  if (node.acting) {
    return { text: node.acting.name ?? t('headship.cover.arranged'), name: node.acting.name, incoming: null, acting: true };
  }
  return null;
}

/**
 * The drawn box geometry (OS L569), in one place: the boxes, the layout spec
 * and the connectors all read it. Heights are FIXED per level, so a level's
 * row is level by construction and names are clamped to one line.
 *
 * - Levels 1–2: 210 × 96. Levels 3–4: 180 × 84.
 * - A level where any box has hidden children: every box there is 118 tall
 *   (84 + 7 gap + the 27px "N sub-units below" button).
 * - Arabic: +4 per text line (four lines on levels 1–2, three below, and the
 *   button's), and levels 3–4 are 190 wide.
 * - Showing committees adds the "◇ N committees" line on levels that have any.
 */
export const BOX = {
  wideWidth: 210,
  narrowWidth: 180,
  narrowWidthAr: 190,
  wideHeight: 96,
  narrowHeight: 84,
  belowGap: 7,
  belowButton: 27,
  committeeLine: 29,
  arPerLine: 4,
} as const;

/** Connector geometry: 1px lines, 14px stubs, sibling gaps 20 (under the root) and 14. */
export const CONNECTOR = { stub: 14, gapUnderRoot: 20, gap: 14 } as const;

export function boxSize(level: number, ar: boolean, opts: { tall: boolean; committees: boolean }): { width: number; height: number } {
  const wide = level <= 2;
  const lines = wide ? 4 : 3;
  let height = (wide ? BOX.wideHeight : BOX.narrowHeight) + (ar ? lines * BOX.arPerLine : 0);
  if (opts.tall) height += BOX.belowGap + BOX.belowButton + (ar ? BOX.arPerLine : 0);
  if (opts.committees) height += BOX.committeeLine + (ar ? BOX.arPerLine : 0);
  const width = wide ? BOX.wideWidth : ar ? BOX.narrowWidthAr : BOX.narrowWidth;
  return { width, height };
}
