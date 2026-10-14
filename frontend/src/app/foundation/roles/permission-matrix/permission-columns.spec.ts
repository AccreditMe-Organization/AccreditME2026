import { MODULE_ORDER, Placement, moduleRank, placementOf } from './permission-columns';

// ACC-120 slice 5, PR B (D1, D3) — every catalogue key against the table in
// backend/Plans/step-120-5-permission-matrix.md, section A. Written out key by
// key rather than derived, so a change to the overrides or the rules that
// moves any key is a red test naming it.
describe('placementOf — the matrix column for every catalogue key (D1)', () => {
  const TABLE: Record<string, Placement> = {
    'tenant:view': 'view', 'tenant:update': 'edit', 'tenant:manage_config': 'edit', 'tenant:bootstrap': 'row',
    'org:view': 'view', 'org:manage': 'row',
    'users:view': 'view', 'users:invite': 'create', 'users:manage': 'edit', 'users:transfer': 'edit',
    'users:deactivate': 'delete', 'users:reactivate': 'row',
    'roles:view': 'view', 'roles:manage': 'row',
    'lookups:view': 'view', 'lookups:manage': 'row',
    'workflows:view': 'view', 'workflows:manage': 'row',
    'tasks:view': 'view', 'tasks:create': 'create', 'tasks:reassign': 'edit', 'tasks:manage': 'row',
    'committees:view': 'view', 'committees:create': 'create', 'committees:edit_details': 'edit',
    'committees:add_member': 'edit', 'committees:remove_member': 'edit', 'committees:change_member_role': 'edit',
    'committees:approve': 'approve', 'committees:manage': 'row',
    'notifications:view': 'view', 'notifications:manage': 'row',
    'meetings:view': 'view', 'meetings:record_minutes': 'edit', 'meetings:approve_minutes': 'approve',
    'meetings:manage': 'row',
    'documents:view': 'view', 'documents:create': 'create', 'documents:submit': 'edit', 'documents:review': 'edit',
    'documents:manage_templates': 'edit', 'documents:manage_numbering': 'edit', 'documents:approve': 'approve',
    'documents:publish': 'approve',
    'standards:view': 'view', 'standards:link_evidence': 'edit', 'standards:manage': 'row',
    'audits:view': 'view', 'audits:create': 'create', 'audits:execute': 'edit', 'audits:report': 'edit',
    'audits:close': 'approve',
    'incidents:view': 'view', 'incidents:report': 'create', 'incidents:investigate': 'edit',
    'incidents:approve_plan': 'approve', 'incidents:close': 'approve',
    'billing:view': 'view', 'billing:manage': 'row',
    'reports:view': 'view', 'reports:export': 'audit',
    'positions:view': 'view', 'positions:manage': 'row',
    'setup:view': 'view',
    'kpi:view_own': 'view', 'kpi:view_department': 'view', 'kpi:view_all': 'view', 'kpi:enter_data': 'edit',
    'kpi:verify': 'approve', 'kpi:manage': 'row', 'kpi:manage_system': 'row',
    'admin:access': 'row',
    'platform:admin': 'row', 'platform:impersonate': 'row',
  };

  it('covers the whole catalogue: 74 keys', () => {
    expect(Object.keys(TABLE).length).toBe(74);
  });

  for (const [key, expected] of Object.entries(TABLE)) {
    it(`places ${key} in ${expected}`, () => {
      expect(placementOf(key)).toBe(expected);
    });
  }

  // The task-permission rework adds these per record type. They must land by
  // the action-name rules, with no change to the layout or the overrides.
  it('places keys nobody has written yet by their action name, with no layout change', () => {
    expect(placementOf('meetings:view_all_tasks')).toBe('view');
    expect(placementOf('documents:create_tasks')).toBe('create');
    expect(placementOf('committees:manage_tasks')).toBe('row');
  });
});

describe('moduleRank — the fixed product order (D3)', () => {
  it('follows the plan table, and appends a module it does not know', () => {
    expect(moduleRank('tenant')).toBe(0);
    expect(moduleRank('users')).toBeLessThan(moduleRank('roles'));
    expect(moduleRank('platform')).toBe(MODULE_ORDER.length - 1);
    expect(moduleRank('somethingNew')).toBe(MODULE_ORDER.length);
  });
});
