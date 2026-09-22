export const TENANT_PERMISSIONS = {
  VIEW:          'tenant:view',
  UPDATE:        'tenant:update',
  MANAGE_CONFIG: 'tenant:manage_config',
  BOOTSTRAP:     'tenant:bootstrap',
} as const;

export const ORG_PERMISSIONS = {
  VIEW:   'org:view',
  MANAGE: 'org:manage',
} as const;

export const USERS_PERMISSIONS = {
  VIEW:       'users:view',
  MANAGE:     'users:manage',
  INVITE:     'users:invite',
  // Separate from MANAGE — CLAUDE.md's "Forced logout on role change or
  // account suspension" is a distinct, higher-stakes action than editing a
  // profile field (Step 9, Commit 7).
  DEACTIVATE: 'users:deactivate',
  // ACC-46 Section 2.6.g — a new, action-specific string rather than
  // overloading MANAGE, matching ACC-44's now-required richer-permission
  // pattern for module CRUD (see CLAUDE.md's Committee CRUD note). The
  // transfer wizard moves a person's unit/position/manager together and can
  // trigger a promotion — deliberately gated separately from ordinary
  // profile edits.
  TRANSFER:   'users:transfer',
} as const;

export const ROLES_PERMISSIONS = {
  VIEW:   'roles:view',
  MANAGE: 'roles:manage',
} as const;

export const LOOKUPS_PERMISSIONS = {
  VIEW:   'lookups:view',
  MANAGE: 'lookups:manage',
} as const;

export const WORKFLOWS_PERMISSIONS = {
  VIEW:   'workflows:view',
  MANAGE: 'workflows:manage',
} as const;

export const TASKS_PERMISSIONS = {
  VIEW:     'tasks:view',
  CREATE:   'tasks:create',
  REASSIGN: 'tasks:reassign',
  COMPLETE: 'tasks:complete',
  MANAGE:   'tasks:manage',
} as const;

export const COMMITTEES_PERMISSIONS = {
  VIEW:               'committees:view',
  MANAGE:             'committees:manage',
  APPROVE:            'committees:approve',
  // ACC-28 correction — replaces the Chairman-specific authority check
  // (assertCommitteeAuthority(), removed) with per-action permissions, same
  // model as every other module. A Chairman is often a figurehead who
  // delegates actual system use to a Secretary; a literal "are you the
  // Chairman" check would lock out the person actually doing the work —
  // tenants grant these to whichever role actually performs the action.
  CREATE:             'committees:create',
  EDIT_DETAILS:       'committees:edit_details',
  ADD_MEMBER:         'committees:add_member',
  REMOVE_MEMBER:      'committees:remove_member',
  CHANGE_MEMBER_ROLE: 'committees:change_member_role',
} as const;

export const NOTIFICATIONS_PERMISSIONS = {
  VIEW:   'notifications:view',
  MANAGE: 'notifications:manage',
} as const;

export const MEETINGS_PERMISSIONS = {
  VIEW:            'meetings:view',
  MANAGE:          'meetings:manage',
  RECORD_MINUTES:  'meetings:record_minutes',
  APPROVE_MINUTES: 'meetings:approve_minutes',
} as const;

export const DOCUMENTS_PERMISSIONS = {
  VIEW:             'documents:view',
  CREATE:           'documents:create',
  SUBMIT:           'documents:submit',
  REVIEW:           'documents:review',
  APPROVE:          'documents:approve',
  PUBLISH:          'documents:publish',
  MANAGE_TEMPLATES: 'documents:manage_templates',
  MANAGE_NUMBERING: 'documents:manage_numbering',
} as const;

export const STANDARDS_PERMISSIONS = {
  VIEW:          'standards:view',
  MANAGE:        'standards:manage',
  LINK_EVIDENCE: 'standards:link_evidence',
} as const;

export const AUDITS_PERMISSIONS = {
  VIEW:    'audits:view',
  CREATE:  'audits:create',
  EXECUTE: 'audits:execute',
  REPORT:  'audits:report',
  CLOSE:   'audits:close',
} as const;

export const INCIDENTS_PERMISSIONS = {
  VIEW:         'incidents:view',
  REPORT:       'incidents:report',
  INVESTIGATE:  'incidents:investigate',
  APPROVE_PLAN: 'incidents:approve_plan',
  CLOSE:        'incidents:close',
} as const;

export const BILLING_PERMISSIONS = {
  VIEW:   'billing:view',
  MANAGE: 'billing:manage',
} as const;

export const REPORTS_PERMISSIONS = {
  VIEW:   'reports:view',
  EXPORT: 'reports:export',
} as const;

export const PLATFORM_PERMISSIONS = {
  ADMIN:       'platform:admin',
  IMPERSONATE: 'platform:impersonate',
} as const;

export const POSITIONS_PERMISSIONS = {
  VIEW:   'positions:view',
  MANAGE: 'positions:manage',
} as const;

// ACC-82 — Setup health (SYSTEM-REFERENCE §13.6). VIEW only: the surface has no
// write action — no dismiss, no read flag, and, with no Hygiene condition
// shipping, no snooze. Replaces resolving recipients by the TENANT_ADMIN role
// NAME, which the condition notifications it supersedes all did.
export const SETUP_PERMISSIONS = {
  VIEW: 'setup:view',
} as const;

export const KPI_PERMISSIONS = {
  VIEW_OWN:        'kpi:view_own',
  VIEW_DEPARTMENT: 'kpi:view_department',
  VIEW_ALL:        'kpi:view_all',
  ENTER_DATA:      'kpi:enter_data',
  VERIFY:          'kpi:verify',
  MANAGE:          'kpi:manage',
  MANAGE_SYSTEM:   'kpi:manage_system',
} as const;

// ACC-123 — who may ADMINISTER this tenant, as a permission rather than a role
// name (ACC-79's rule, so a tenant's own custom admin role works with no
// special-casing).
//
// It exists because a "view" permission was doing two unrelated jobs. The task
// assignee picker reads GET /users, so a working role needs users:view; the
// rail read the same string as "may open the Users admin page". QUALITY_MANAGER
// holds users:view, org:view, lookups:view and workflows:view for pickers, and
// so was shown the whole Administration section — and write controls the server
// then refused one by one. Separating the two jobs is what this adds: the page
// permission stays exactly as it was, and this says whether the person is an
// administrator at all. BOTH are required for an Administration route.
//
// Deliberately NOT a permission on any module: administering is not an action
// on a thing, and pinning it to one ("tenant:administer") would imply the
// Tenant screens rather than the whole section.
export const ADMIN_PERMISSIONS = {
  ACCESS: 'admin:access',
} as const;
