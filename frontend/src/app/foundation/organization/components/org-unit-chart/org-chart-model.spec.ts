import { OrgChartNodeDto, OrgChartResponseDto } from '../../services/org-unit.service';
import { BOX, allBoxes, boxSize, buildChart, headSubject, initialsOf, moveFocus } from './org-chart-model';

// ACC-120 slice 11, PR E — the chart's model: the window as a tree, the tall
// levels, and where each arrow key goes in both directions.

export function chartNode(id: string, parentId: string | null, depth: number, over: Partial<OrgChartNodeDto> = {}): OrgChartNodeDto {
  return {
    id,
    parentId,
    nameEn: id,
    nameAr: null,
    code: id.toUpperCase(),
    type: null,
    sortOrder: 0,
    isActive: true,
    childCount: 0,
    heads: [],
    acting: null,
    headcount: 1,
    committees: { count: 0 },
    depth,
    ...over,
  };
}

/** root → a, b, c; a → a1, a2; a1 → a1x (level 4, with 3 hidden children); c → c1 (level 3, 2 hidden). */
export function chartFixture(): OrgChartResponseDto {
  return {
    root: { id: 'root', path: [{ id: 'top', nameEn: 'Top', nameAr: null }, { id: 'root', nameEn: 'Root', nameAr: 'الجذر' }] },
    depth: 4,
    asOf: '2026-10-22T09:00:00.000Z',
    nodes: [
      chartNode('root', 'top', 0, { childCount: 3 }),
      chartNode('a', 'root', 1, { childCount: 2 }),
      chartNode('a1', 'a', 2, { childCount: 1 }),
      chartNode('a1x', 'a1', 3, { childCount: 3 }),
      chartNode('a2', 'a', 2),
      chartNode('b', 'root', 1, { committees: { count: 2 } }),
      chartNode('c', 'root', 1, { childCount: 1 }),
      chartNode('c1', 'c', 2, { childCount: 2 }),
    ],
  };
}

describe('org chart model (ACC-120 slice 11, PR E)', () => {
  it('builds the window as a tree in the server’s order, with levels from 1', () => {
    const m = buildChart(chartFixture());
    expect(allBoxes(m).map((b) => `${b.node.id}:${b.level}`)).toEqual(['root:1', 'a:2', 'a1:3', 'a1x:4', 'a2:3', 'b:2', 'c:2', 'c1:3']);
    expect(m.byId.get('a2')!.parent!.node.id).toBe('a');
    expect(m.byId.get('b')!.index).toBe(2);
  });

  it('a box with hidden children carries the count; its level is tall', () => {
    const m = buildChart(chartFixture());
    expect(m.byId.get('a1x')!.below).toBe(3);
    expect(m.byId.get('c1')!.below).toBe(2);
    expect(m.byId.get('a1')!.below).toBe(0); // its child is rendered
    expect([...m.tallLevels].sort()).toEqual([3, 4]);
    expect([...m.committeeLevels]).toEqual([2]);
  });

  it('never renders past four levels, whatever the response holds', () => {
    const res = chartFixture();
    res.nodes.push(chartNode('deep', 'a1x', 4));
    const m = buildChart(res);
    expect(m.byId.has('deep')).toBe(false);
    expect(m.byId.get('a1x')!.below).toBe(3);
  });

  it('a node whose parent is not in the window is dropped; no root means no tree', () => {
    const res = chartFixture();
    res.nodes.push(chartNode('stray', 'nowhere', 1));
    expect(buildChart(res).byId.has('stray')).toBe(false);
    expect(buildChart({ ...res, root: { id: 'missing', path: [] } }).root).toBeNull();
  });

  describe('moveFocus', () => {
    const m = buildChart(chartFixture());
    it('LTR: down to the first child, up to the parent, right and left along the siblings', () => {
      expect(moveFocus(m, 'root', 'ArrowDown', false)).toBe('a');
      expect(moveFocus(m, 'a', 'ArrowUp', false)).toBe('root');
      expect(moveFocus(m, 'a', 'ArrowRight', false)).toBe('b');
      expect(moveFocus(m, 'b', 'ArrowLeft', false)).toBe('a');
      expect(moveFocus(m, 'c', 'ArrowRight', false)).toBeNull();
      expect(moveFocus(m, 'root', 'ArrowUp', false)).toBeNull();
      expect(moveFocus(m, 'a2', 'ArrowDown', false)).toBeNull();
    });

    it('RTL: the row is drawn right to left, so Right is the PREVIOUS sibling', () => {
      expect(moveFocus(m, 'b', 'ArrowRight', true)).toBe('a');
      expect(moveFocus(m, 'b', 'ArrowLeft', true)).toBe('c');
      expect(moveFocus(m, 'a', 'ArrowRight', true)).toBeNull();
      expect(moveFocus(m, 'root', 'ArrowDown', true)).toBe('a');
    });

    it('Home is the root; End the last box in reading order; an unknown id goes to the root', () => {
      expect(moveFocus(m, 'c1', 'Home', false)).toBe('root');
      expect(moveFocus(m, 'root', 'End', false)).toBe('c1');
      expect(moveFocus(m, 'gone', 'ArrowDown', false)).toBe('root');
    });
  });

  it('box sizes: the drawn ones, the tall level, Arabic +4 a line and 190 wide, committees', () => {
    expect(boxSize(1, false, { tall: false, committees: false })).toEqual({ width: 210, height: 96 });
    expect(boxSize(2, false, { tall: false, committees: false })).toEqual({ width: 210, height: 96 });
    expect(boxSize(3, false, { tall: false, committees: false })).toEqual({ width: 180, height: 84 });
    expect(boxSize(4, false, { tall: true, committees: false })).toEqual({ width: 180, height: 118 });
    expect(boxSize(2, true, { tall: false, committees: false })).toEqual({ width: 210, height: 112 });
    expect(boxSize(4, true, { tall: false, committees: false })).toEqual({ width: 190, height: 96 });
    expect(boxSize(4, true, { tall: true, committees: false })).toEqual({ width: 190, height: 96 + BOX.belowGap + BOX.belowButton + BOX.arPerLine });
    expect(boxSize(2, false, { tall: false, committees: true }).height).toBe(96 + BOX.committeeLine);
  });

  describe('the head line (D7)', () => {
    const t = (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k);
    const bi = (en: string, ar: string | null) => ar ?? en;
    const head = (name: string | null, role: 'substantive' | 'incoming' = 'substantive') => ({
      userId: `u-${name}`,
      name,
      positionId: 'p',
      positionNameEn: 'Director',
      positionNameAr: null,
      role,
      countedHere: true,
    });
    it('the name; without users:view, the position title the API returns', () => {
      expect(headSubject(chartNode('x', null, 0, { heads: [head('Dr. Fahad')] }), t, bi)!.text).toBe('Dr. Fahad');
      expect(headSubject(chartNode('x', null, 0, { heads: [head(null)] }), t, bi)!.text).toBe('Director');
    });
    it('a successor, an acting head, and nobody', () => {
      const two = headSubject(chartNode('x', null, 0, { heads: [head('Dr. Huda', 'incoming'), head('Dr. Fahad')] }), t, bi)!;
      expect(two.text).toBe('Dr. Fahad');
      expect(two.incoming).toBe('Dr. Huda');
      const acting = headSubject(chartNode('x', null, 0, { acting: { userId: 'h', name: 'Dr. Huda', reason: 'VACANCY', validFrom: '', validTo: null, countedHere: true } }), t, bi)!;
      expect(acting).toEqual(jasmine.objectContaining({ text: 'Dr. Huda', acting: true }));
      expect(headSubject(chartNode('x', null, 0), t, bi)).toBeNull();
    });
  });

  it('initials skip titles, and are empty for a withheld name', () => {
    expect(initialsOf('Dr. Fahad Al-Anazi')).toBe('FA');
    expect(initialsOf('Hessa')).toBe('H');
    expect(initialsOf(null)).toBe('');
  });
});
