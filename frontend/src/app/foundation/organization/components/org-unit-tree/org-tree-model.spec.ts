import type { OrgStructureNodeDto } from '../../services/org-unit.service';
import { NO_TYPE, childrenOf, defaultExpanded, depthsOf, filterTree, matchesQuery, unitAndLevelCount } from './org-tree-model';

// ACC-120 slice 11 (PR C) — the tree's pure model: what the toolbar keeps,
// what it dims, and what "units · levels" counts.

const node = (id: string, parentId: string | null, over: Partial<OrgStructureNodeDto> = {}): OrgStructureNodeDto => ({
  id,
  parentId,
  nameEn: id,
  nameAr: null,
  code: id.toUpperCase(),
  type: { id: 't-dept', key: 'department', labelEn: 'Department', labelAr: 'قسم', isRetired: false },
  sortOrder: 0,
  isActive: true,
  childCount: 0,
  heads: [],
  acting: null,
  headcount: 0,
  committees: { count: 0 },
  ...over,
});

const SECTION = { id: 't-sec', key: 'section', labelEn: 'Section', labelAr: 'قسم فرعي', isRetired: false };

// root › Medical Services › Pharmacy › {Inpatient Pharmacy, Outpatient Pharmacy}
//      › Laboratory (no type)                 › Retired Pharmacy (inactive)
const NODES: OrgStructureNodeDto[] = [
  node('root', null, { nameEn: 'Al Nakheel Specialist Hospital' }),
  node('med', 'root', { nameEn: 'Medical Services' }),
  node('pharm', 'med', { nameEn: 'Pharmacy', nameAr: 'الصيدلية', code: 'PHARM' }),
  node('pharm-ip', 'pharm', { nameEn: 'Inpatient Pharmacy', type: SECTION }),
  node('pharm-op', 'pharm', { nameEn: 'Outpatient Pharmacy', type: SECTION }),
  node('pharm-old', 'pharm', { nameEn: 'Retired Pharmacy', isActive: false }),
  node('lab', 'root', { nameEn: 'Laboratory', type: null }),
];

const all = (o: Partial<{ query: string; types: string[]; showInactive: boolean }> = {}) =>
  filterTree(NODES, { query: '', types: [], showInactive: false, ...o });

describe('org-tree-model (ACC-120 slice 11)', () => {
  it('counts active units and levels from 1: "6 units · 4 levels"', () => {
    expect(unitAndLevelCount(NODES)).toEqual({ units: 6, levels: 4 });
  });

  it('depth walks parents, and a loop in the data ends the walk', () => {
    expect(depthsOf(NODES).get('pharm-ip')).toBe(3);
    const loop = [node('a', 'b'), node('b', 'a')];
    expect([...depthsOf(loop).values()].every((d) => d <= 1)).toBeTrue();
  });

  it('children keep the server order; a unit whose parent is absent starts a branch', () => {
    const map = childrenOf(NODES.filter((n) => n.id !== 'med'));
    expect(map.get(null)!.map((n) => n.id)).toEqual(['root', 'pharm']);
    expect(map.get('pharm')!.map((n) => n.id)).toEqual(['pharm-ip', 'pharm-op', 'pharm-old']);
  });

  it('with nothing to narrow, every active unit shows and none is a "match"', () => {
    const f = all();
    expect(f.narrowing).toBeFalse();
    expect(f.visible.size).toBe(6);
    expect(f.visible.has('pharm-old')).toBeFalse();
    expect(f.ancestors.size).toBe(0);
  });

  it('search "pharm": the matches, their ancestors as context, and no unmatched sibling', () => {
    const f = all({ query: 'pharm' });
    expect(f.narrowing).toBeTrue();
    expect([...f.matches].sort()).toEqual(['pharm', 'pharm-ip', 'pharm-op']);
    expect([...f.ancestors].sort()).toEqual(['med', 'root']);
    expect(f.visible.has('lab')).withContext('a sibling that does not match goes').toBeFalse();
  });

  it('search reads the Arabic name and the code, in any letter case', () => {
    expect(matchesQuery(NODES[2]!, 'الصيدلية')).toBeTrue();
    expect(matchesQuery(NODES[2]!, 'phARM')).toBeTrue();
    expect(matchesQuery(NODES[6]!, 'pharm')).toBeFalse();
  });

  it('the Type filter takes several values, "(No type)" included, and keeps ancestors', () => {
    const sections = all({ types: ['t-sec'] });
    expect([...sections.matches].sort()).toEqual(['pharm-ip', 'pharm-op']);
    expect([...sections.ancestors].sort()).toEqual(['med', 'pharm', 'root']);
    const untyped = all({ types: [NO_TYPE] });
    expect([...untyped.matches]).toEqual(['lab']);
    const both = all({ types: ['t-sec', NO_TYPE] });
    expect([...both.matches].sort()).toEqual(['lab', 'pharm-ip', 'pharm-op']);
  });

  it('search and Type narrow together', () => {
    expect([...all({ query: 'outpatient', types: ['t-sec'] }).matches]).toEqual(['pharm-op']);
    expect(all({ query: 'laboratory', types: ['t-sec'] }).matches.size).toBe(0);
  });

  it('inactive units only with showInactive', () => {
    expect(all({ query: 'retired' }).matches.size).toBe(0);
    expect([...all({ query: 'retired', showInactive: true }).matches]).toEqual(['pharm-old']);
  });

  it('the default expansion opens the top level only, so level 2 shows collapsed', () => {
    expect([...defaultExpanded(NODES)]).toEqual(['root']);
  });
});
