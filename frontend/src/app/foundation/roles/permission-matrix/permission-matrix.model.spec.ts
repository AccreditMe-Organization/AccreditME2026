import { PermissionDto } from '../services/role.service';
import {
  buildMatrix,
  cellKeys,
  changesOf,
  markOf,
  matrixRows,
  rowKeys,
  toggleKeys,
  triState,
} from './permission-matrix.model';

// ACC-120 slice 5, PR B — the matrix's rules, apart from the screen.
const perm = (key: string, inUse = true): PermissionDto => {
  const [module, action] = key.split(':');
  return { id: key, module, action, description: null, inUse };
};

const CATALOGUE: PermissionDto[] = [
  perm('committees:manage'),
  perm('committees:view'),
  perm('committees:approve'),
  perm('committees:create'),
  perm('users:view'),
  perm('users:deactivate'),
  perm('platform:admin'),
  perm('documents:view', false),
  perm('kpi:verify', false),
];

describe('buildMatrix', () => {
  it('shows only keys in use (R2) and hides platform keys inside a tenant (D2)', () => {
    const keys = buildMatrix(CATALOGUE, { isTenant: true }).flatMap((m) => m.keys);
    expect(keys).not.toContain('documents:view');
    expect(keys).not.toContain('kpi:verify');
    expect(keys).not.toContain('platform:admin');
    expect(keys).toContain('users:view');
  });

  it('shows platform keys in the platform organisation', () => {
    const modules = buildMatrix(CATALOGUE, { isTenant: false }).map((m) => m.module);
    expect(modules).toContain('platform');
  });

  it('orders modules by the product order (D3), not the catalogue order', () => {
    expect(buildMatrix(CATALOGUE, { isTenant: false }).map((m) => m.module)).toEqual([
      'users',
      'committees',
      'platform',
    ]);
  });

  it('orders a module\'s rows by column, whole-row grants last', () => {
    const committees = buildMatrix(CATALOGUE, { isTenant: true }).find((m) => m.module === 'committees');
    expect(committees?.keys).toEqual(['committees:view', 'committees:create', 'committees:approve', 'committees:manage']);
    expect(committees?.byColumn.delete).toEqual([]);
    expect(committees?.byColumn.approve).toEqual(['committees:approve']);
  });
});

describe('cellKeys and rowKeys', () => {
  const rows = matrixRows(buildMatrix(CATALOGUE, { isTenant: true }));
  const rowOf = (key: string) => rows.find((r) => r.kind === 'permission' && r.permission.key === key)!;
  const moduleRow = (m: string) => rows.find((r) => r.kind === 'module' && r.module.module === m)!;

  it('a whole-row grant toggles from its LABEL cell and has no column cell (D1)', () => {
    const row = rowOf('committees:manage');
    expect(cellKeys(row, 0)).toEqual(['committees:manage']);
    for (let c = 1; c <= 6; c++) expect(cellKeys(row, c)).toBeNull();
  });

  it('a column permission toggles from exactly one cell, and its label from none', () => {
    const row = rowOf('committees:approve');
    expect(cellKeys(row, 0)).toBeNull();
    expect([1, 2, 3, 4, 5, 6].filter((c) => cellKeys(row, c) !== null)).toEqual([5]);
  });

  it('a module row\'s label is the whole module, each column that column\'s keys, empty columns hatched', () => {
    const row = moduleRow('committees');
    expect(cellKeys(row, 0)).toEqual(['committees:view', 'committees:create', 'committees:approve', 'committees:manage']);
    expect(cellKeys(row, 5)).toEqual(['committees:approve']);
    expect(cellKeys(row, 4)).toBeNull();
    expect(rowKeys(row)).toEqual(cellKeys(row, 0)!);
  });
});

describe('the tri-state', () => {
  it('reads all, some and none', () => {
    expect(triState(['a', 'b'], new Set(['a', 'b']))).toBe('all');
    expect(triState(['a', 'b'], new Set(['a']))).toBe('some');
    expect(triState(['a', 'b'], new Set())).toBe('none');
  });

  it('one press completes a partial group, and empties only a full one', () => {
    expect([...toggleKeys(['a', 'b'], new Set(['a', 'x']))].sort()).toEqual(['a', 'b', 'x']);
    expect([...toggleKeys(['a', 'b'], new Set(['a', 'b', 'x']))]).toEqual(['x']);
  });
});

describe('changes', () => {
  const modules = buildMatrix(CATALOGUE, { isTenant: true });

  it('marks unsaved grants and revocations against the LOADED set', () => {
    const loaded = new Set(['users:view']);
    expect(markOf('users:view', new Set(['users:view']), loaded)).toBe('on');
    expect(markOf('users:view', new Set(), loaded)).toBe('revoked');
    expect(markOf('committees:view', new Set(['committees:view']), loaded)).toBe('granted');
    expect(markOf('committees:view', new Set(), loaded)).toBe('off');
  });

  it('lists changes in row order, never a hidden key', () => {
    const loaded = new Set(['users:view', 'documents:view']);
    const selected = new Set(['committees:approve', 'committees:view', 'documents:view']);
    const { added, removed } = changesOf(modules, selected, loaded);
    expect(added.map((p) => p.key)).toEqual(['committees:view', 'committees:approve']);
    expect(removed.map((p) => p.key)).toEqual(['users:view']);
  });
});
