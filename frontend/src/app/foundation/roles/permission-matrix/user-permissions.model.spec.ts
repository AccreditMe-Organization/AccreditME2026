import { PermissionDto } from '../services/role.service';
import { ROOT_ROLE_KEY, orderGrants, summarise } from './user-permissions.model';
import en from '../../../../assets/i18n/en.json';
import { QE_KEYS, grant, nouraGrants } from './user-permissions.fixtures';

// ACC-272 — "A user's permissions" as data: the design's Noura Al-Mutairi
// example (16 permissions through 3 active roles; Committees 9 of 12).

const SENTENCES = (en as { roles: { matrix: { sentence: Record<string, string> } } }).roles.matrix.sentence;
const perm = (key: string, extra: Partial<PermissionDto> = {}): PermissionDto => {
  const [module, action] = key.split(':');
  return { id: key, module, action, description: null, inUse: true, rootRoleOnly: key === 'workflows:manage', ...extra };
};
// Every shown key, plus platform:admin and a key not in use, which are never shown in a tenant.
const CATALOGUE = [...Object.keys(SENTENCES).map((k) => perm(k)), perm('platform:admin'), perm('documents:view', { inUse: false })];

describe("A user's permissions, as data (ACC-272)", () => {
  it('orders roles: head positions first, then direct, then inactive; server order within each', () => {
    const ordered = orderGrants(nouraGrants()).map((g) => g.role.nameEn);
    expect(ordered).toEqual(['Unit Head', 'Patient Safety Reviewer', 'Quality Editor', 'Committee Secretary']);
    // An inactive head-position role goes with the inactive ones, after every
    // active role; inactive ones keep the server's order among themselves.
    const inactiveHead = grant({ name: 'Old Head', source: 'HEAD_POSITION_ORG_WIDE', isActive: false, permissions: [] });
    expect(orderGrants([inactiveHead, ...nouraGrants()]).map((g) => g.role.nameEn)).toEqual([
      'Unit Head',
      'Patient Safety Reviewer',
      'Quality Editor',
      'Old Head',
      'Committee Secretary',
    ]);
  });

  it('the union of the active roles: 16 permissions through 3 active roles', () => {
    const s = summarise(nouraGrants(), CATALOGUE, { isTenant: true });
    expect(s.activeRoles.length).toBe(3);
    expect(s.granted.size).toBe(16);
    expect([...s.granted]).toContain('committees:view_unit_tasks');
    expect([...s.granted]).toContain('committees:approve');
    // Committees: 9 of 12.
    const committees = s.modules.find((m) => m.module === 'committees')!;
    expect(committees.keys.filter((k) => s.granted.has(k)).length).toBe(9);
    expect(committees.keys.length).toBe(12);
  });

  it('an inactive role gives nothing, even keys no active role gives', () => {
    const s = summarise(nouraGrants(), CATALOGUE, { isTenant: true });
    const secretary = s.roles.find((r) => r.grant.role.nameEn === 'Committee Secretary')!;
    expect(secretary.active).toBeFalse();
    expect(secretary.gives).toEqual([]);
    expect(s.granted.has('committees:remove_member')).toBeFalse();
    expect(s.from.has('committees:remove_member')).toBeFalse();
  });

  it('"From" names every active role that gives a key, in the roles\' order, once each', () => {
    const s = summarise(nouraGrants(), CATALOGUE, { isTenant: true });
    const names = (k: string) => s.from.get(k)!.map((g) => g.role.nameEn);
    expect(names('committees:view')).toEqual(['Unit Head', 'Patient Safety Reviewer', 'Quality Editor']);
    expect(names('committees:approve')).toEqual(['Patient Safety Reviewer']);
    expect(names('tenant:view')).toEqual(['Quality Editor']);
  });

  it('"Gives n" counts the shown keys each role gives', () => {
    const s = summarise(nouraGrants(), CATALOGUE, { isTenant: true });
    const gives = Object.fromEntries(s.roles.map((r) => [r.grant.role.nameEn, r.gives.length]));
    expect(gives).toEqual({ 'Unit Head': 6, 'Patient Safety Reviewer': 3, 'Quality Editor': 14, 'Committee Secretary': 0 });
  });

  it('the shown set is the permissions page\'s: no key not in use, no platform key, no root-only key from another role', () => {
    const odd = grant({ name: 'Stale', permissions: ['documents:view', 'platform:admin', 'workflows:manage', 'users:view'] });
    const s = summarise([odd], CATALOGUE, { isTenant: true });
    expect(s.roles[0]!.gives).toEqual(['users:view']);
    expect([...s.granted]).toEqual(['users:view']);
    // And the modules carry no root-only row, so Workflows reads n of 1.
    expect(s.modules.find((m) => m.module === 'workflows')!.keys).toEqual(['workflows:view']);
  });

  it('the root role gives every shown key, workflows:manage included, and is the summary', () => {
    const allShown = Object.keys(SENTENCES).filter((k) => !k.startsWith('platform:'));
    const oa = grant({ name: 'Organization Administrator', key: ROOT_ROLE_KEY, isSystem: true, permissions: [...allShown, 'platform:admin'] });
    const s = summarise([oa], CATALOGUE, { isTenant: true });
    expect(s.viaRoot!.grant).toBe(oa);
    expect(s.granted.has('workflows:manage')).toBeTrue();
    expect(s.granted.size).toBe(allShown.length);
    expect(s.modules.find((m) => m.module === 'workflows')!.keys).toEqual(['workflows:view', 'workflows:manage']);
    expect(s.emptyModules).toEqual([]);
    // An INACTIVE root role is not the summary, and gives nothing.
    const off = summarise([{ ...oa, role: { ...oa.role, isActive: false } }], CATALOGUE, { isTenant: true });
    expect(off.viaRoot).toBeNull();
    expect(off.granted.size).toBe(0);
  });

  it('modules with nothing granted, in the product order', () => {
    const s = summarise(nouraGrants(), CATALOGUE, { isTenant: true });
    expect(s.emptyModules).toEqual(['roles', 'setup', 'admin']);
  });

  it('no active roles: nothing granted, every module empty', () => {
    const s = summarise([grant({ name: 'Old', isActive: false, permissions: QE_KEYS })], CATALOGUE, { isTenant: true });
    expect(s.activeRoles).toEqual([]);
    expect(s.granted.size).toBe(0);
    expect(s.emptyModules.length).toBe(s.modules.length);
  });

  it('the platform organisation shows platform keys', () => {
    const s = summarise([grant({ name: 'Platform', permissions: ['platform:admin'] })], CATALOGUE, { isTenant: false });
    expect([...s.granted]).toEqual(['platform:admin']);
  });
});
