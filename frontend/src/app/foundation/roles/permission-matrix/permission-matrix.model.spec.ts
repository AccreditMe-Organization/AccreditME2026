import en from '../../../../assets/i18n/en.json';
import { PermissionDto } from '../services/role.service';
import {
  NO_FILTER,
  buildMatrix,
  changesOf,
  filterActive,
  heldCount,
  markOf,
  rowVisible,
  toggleKeys,
  triState,
  visibleKeys,
} from './permission-matrix.model';

// ACC-272 — the list's rules, apart from the screen.
const perm = (key: string, inUse = true): PermissionDto => {
  const [module, action] = key.split(':');
  return { id: key, module, action, description: null, inUse, rootRoleOnly: key === 'workflows:manage' };
};

const SENTENCES = (en as { roles: { matrix: { sentence: Record<string, string> } } }).roles.matrix.sentence;
// The product's in-use keys: the sentence table is exactly that list
// (check:permission-sentences fails on a missing or a stray sentence). Given
// in a shuffled order, so the order the list shows is proved to be its own.
const IN_USE = Object.keys(SENTENCES).reverse();
const CATALOGUE: PermissionDto[] = [...IN_USE.map((k) => perm(k)), perm('documents:view', false), perm('kpi:verify', false)];
const sentenceOf = (key: string): string => SENTENCES[key] ?? key;

const tenant = () => buildMatrix(CATALOGUE, { isTenant: true });
const committees = () => tenant().find((m) => m.module === 'committees')!;

describe('buildMatrix (ACC-272)', () => {
  it('shows only keys in use (R2), and no platform key inside a tenant (D2)', () => {
    const keys = tenant().flatMap((m) => m.keys);
    expect(keys).not.toContain('documents:view');
    expect(keys).not.toContain('kpi:verify');
    expect(keys.some((k) => k.startsWith('platform:'))).toBeFalse();
    expect(buildMatrix(CATALOGUE, { isTenant: false }).some((m) => m.module === 'platform')).toBeTrue();
  });

  it('shows workflows:manage only on the root role (ACC-258)', () => {
    expect(tenant().flatMap((m) => m.keys)).not.toContain('workflows:manage');
    expect(buildMatrix(CATALOGUE, { isTenant: true, isRootRole: true }).flatMap((m) => m.keys)).toContain('workflows:manage');
  });

  it('orders modules by the product order (D3), whatever order the catalogue gives', () => {
    expect(tenant().map((m) => m.module)).toEqual([
      'tenant',
      'org',
      'users',
      'roles',
      'lookups',
      'workflows',
      'committees',
      'meetings',
      'positions',
      'setup',
      'admin',
    ]);
  });

  it('splits Committees into its three groups in the table order; a module of six or fewer has one unnamed group', () => {
    const c = committees();
    expect(c.groups.map((g) => g.id)).toEqual(['records', 'members', 'tasks']);
    expect(c.groups.map((g) => g.keys)).toEqual([
      ['committees:view', 'committees:create', 'committees:edit_details', 'committees:approve', 'committees:manage'],
      ['committees:add_member', 'committees:remove_member', 'committees:change_member_role'],
      ['committees:view_all_tasks', 'committees:view_unit_tasks', 'committees:create_tasks', 'committees:manage_tasks'],
    ]);
    expect(c.keys).toEqual(c.groups.flatMap((g) => g.keys));
    const users = tenant().find((m) => m.module === 'users')!;
    expect(users.keys.length).toBe(6);
    expect(users.groups.map((g) => g.id)).toEqual([null]);
  });

  it('keeps catalogue order outside groups', () => {
    const cat = [perm('users:view'), perm('users:invite'), perm('users:deactivate')];
    expect(buildMatrix(cat, { isTenant: true })[0]!.keys).toEqual(['users:view', 'users:invite', 'users:deactivate']);
    expect(buildMatrix([...cat].reverse(), { isTenant: true })[0]!.keys).toEqual(['users:deactivate', 'users:invite', 'users:view']);
  });

  it('a grouped module showing six or fewer keys is not split', () => {
    const cat = ['committees:view', 'committees:create', 'committees:add_member'].map((k) => perm(k));
    expect(buildMatrix(cat, { isTenant: true })[0]!.groups.map((g) => g.id)).toEqual([null]);
  });

  it('never drops a shown key the table does not name: it follows the groups, unnamed', () => {
    const cat = [...IN_USE.filter((k) => k.startsWith('committees:')).map((k) => perm(k)), perm('committees:archive')];
    const c = buildMatrix(cat, { isTenant: true })[0]!;
    expect(c.groups.map((g) => g.id)).toEqual(['records', 'members', 'tasks', null]);
    expect(c.groups.at(-1)!.keys).toEqual(['committees:archive']);
  });
});

describe('tri-state and counts', () => {
  it('reads all, some and none, for a module and for a group', () => {
    const c = committees();
    const records = c.groups[0]!;
    const all = new Set(records.keys);
    expect(triState(records.keys, all)).toBe('all');
    expect(triState(c.keys, all)).toBe('some');
    expect(triState(c.keys, new Set())).toBe('none');
    expect(heldCount(c.keys, all)).toBe(5);
    expect(heldCount(c.keys, new Set(['committees:view', 'users:view']))).toBe(1);
  });

  it('a press on a mixed or empty box grants every key; on a full one revokes every key', () => {
    const keys = ['committees:view', 'committees:create'];
    expect([...toggleKeys(keys, new Set(['committees:view']))].sort()).toEqual(keys.sort());
    expect([...toggleKeys(keys, new Set())].sort()).toEqual(keys.sort());
    expect([...toggleKeys(keys, new Set(keys))]).toEqual([]);
    // Nothing else moves: no row implies another.
    expect([...toggleKeys(['committees:manage'], new Set(['users:view']))].sort()).toEqual(['committees:manage', 'users:view']);
    // An empty set of visible keys does nothing.
    expect([...toggleKeys([], new Set(['users:view']))]).toEqual(['users:view']);
  });
});

describe('the filter (shows, never saves)', () => {
  const loaded = new Set(['committees:view', 'committees:change_member_role']);
  // Edited: approve granted, change_member_role revoked.
  const selected = new Set(['committees:view', 'committees:approve']);

  it('is off by default; a query or Show granted only turns it on', () => {
    expect(filterActive(NO_FILTER)).toBeFalse();
    expect(filterActive({ query: '  ', grantedOnly: false })).toBeFalse();
    expect(filterActive({ query: 'member', grantedOnly: false })).toBeTrue();
    expect(filterActive({ query: '', grantedOnly: true })).toBeTrue();
  });

  it('matches the sentence in the reader language, ignoring case and outer spaces', () => {
    const f = { query: '  MEMBER ', grantedOnly: false };
    // "Open a committee record and its members" matches too.
    expect(visibleKeys(committees().permissions, sentenceOf, f, selected, loaded)).toEqual([
      'committees:view',
      'committees:add_member',
      'committees:remove_member',
      'committees:change_member_role',
    ]);
    // The reader's language only: an Arabic sentence matches Arabic, never English.
    expect(rowVisible('committees:add_member', 'إضافة أعضاء إلى اللجنة', { query: 'أعضاء', grantedOnly: false }, selected, loaded)).toBeTrue();
    expect(rowVisible('committees:add_member', 'إضافة أعضاء إلى اللجنة', { query: 'member', grantedOnly: false }, selected, loaded)).toBeFalse();
    // «أعضاء» is not «وأعضائها»: the design finds the two member rows only.
    expect(rowVisible('committees:view', 'فتح سجل اللجنة وأعضائها', { query: 'أعضاء', grantedOnly: false }, selected, loaded)).toBeFalse();
  });

  it('Show granted only uses the edited set, and keeps every changed row, a revocation included', () => {
    const f = { query: '', grantedOnly: true };
    expect(visibleKeys(committees().permissions, sentenceOf, f, selected, loaded)).toEqual([
      'committees:view',
      'committees:approve',
      'committees:change_member_role',
    ]);
  });

  it('both together: "member" and granted only', () => {
    expect(visibleKeys(committees().permissions, sentenceOf, { query: 'member', grantedOnly: true }, selected, loaded)).toEqual([
      'committees:view',
      'committees:change_member_role',
    ]);
  });

  it('a box under a filter acts only on the visible rows', () => {
    const visible = visibleKeys(committees().permissions, sentenceOf, { query: 'member', grantedOnly: false }, new Set(), new Set());
    const next = toggleKeys(visible, new Set(['committees:view']));
    expect([...next].sort()).toEqual(['committees:add_member', 'committees:change_member_role', 'committees:remove_member', 'committees:view']);
  });
});

describe('marks and the change list', () => {
  const loaded = new Set(['committees:view', 'lookups:view', 'committees:change_member_role']);
  const selected = new Set(['committees:view', 'committees:approve']);

  it('marks held, not held, newly granted and newly revoked against the LOADED set', () => {
    expect(markOf('committees:view', selected, loaded)).toBe('on');
    expect(markOf('users:view', selected, loaded)).toBe('off');
    expect(markOf('committees:approve', selected, loaded)).toBe('granted');
    expect(markOf('lookups:view', selected, loaded)).toBe('revoked');
  });

  it('lists the changes for the save confirmation in the list order, never a hidden key', () => {
    const changes = changesOf(tenant(), new Set([...selected, 'documents:view']), loaded);
    expect(changes.added.map((p) => p.key)).toEqual(['committees:approve']);
    // Lookups comes before Committees in the product order.
    expect(changes.removed.map((p) => p.key)).toEqual(['lookups:view', 'committees:change_member_role']);
  });
});
