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
  // ACC-83 — the mirror of DEACTIVATE, and a new string rather than reusing it,
  // because switching an account OFF and switching it back ON are different
  // decisions with different consequences: reactivation consumes a seat, can
  // restore administrative roles, and returns work to someone.
  //
  // "Only the tenant administrator may reactivate a user" (Ahmad, 3 Oct) is
  // expressed as THIS PERMISSION and nothing else. TENANT_ADMIN's seeded set is
  // ALL.filter(p => !p.startsWith('platform:')), so adding the constant here
  // gives it to Organization Administrator by default and to no other seeded
  // role — QUALITY_MANAGER names only USERS_PERMISSIONS.VIEW. No seed edit, no
  // backfill, and nothing keyed to a role NAME, which is the shape ACC-120
  // spent a day removing.
  REACTIVATE: 'users:reactivate',
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

// ACC-244 — THERE IS NO tasks:* GROUP ANY MORE. tasks:view, tasks:create,
// tasks:reassign and tasks:manage were the flat task keys; each is replaced by
// a key PER RECORD TYPE (COMMITTEE_TASKS_PERMISSIONS below, read through
// foundation/task/task-record-types.ts), and a relationship to a task needs no
// key at all. backfill:acc244-retire-flat-task-keys removes them from existing
// tenants. tasks:complete went the same way in ACC-162. Do not reintroduce a
// flat task key: retired-task-keys.spec.ts fails on any code that names one.

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

// ACC-244 — what a person may do with the TASKS on committee records, per
// record type rather than the flat tasks:* keys (the task screens' decision 3,
// Ahmad 18 Oct). The module is the record's, so the matrix shows them in the
// Committees block; the actions are the names permission-columns.ts already
// places (view_all_tasks → View, create_tasks → Create, manage_tasks → whole row).
//
// Its own group, not COMMITTEES_PERMISSIONS: QUALITY_MANAGER is seeded with
// every value of that group, and ACC-28's umbrella rule (committees:manage holds
// every committee string) is about committee CRUD, not task reach. Each grant
// of these is deliberate (role.seed.ts, and backfill:acc244-grant-task-keys for
// existing tenants).
//
// ACC-244 PR 2 — every task path reads them now, through the record-type
// registry (task-record-types.ts); the flat tasks:* keys are retired.
export const COMMITTEE_TASKS_PERMISSIONS = {
  // Every task on every committee the holder can see.
  VIEW_ALL:  'committees:view_all_tasks',
  // New task on a committee the holder can see.
  CREATE:    'committees:create_tasks',
  // Reassign, decide requests, Unassigned, and a departed creator's tasks.
  MANAGE:    'committees:manage_tasks',
  // Every task on committees owned by the holder's own unit and its sub-units.
  VIEW_UNIT: 'committees:view_unit_tasks',
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

// ACC-120 slice 5 (CC-91, R2) — the catalogue keys NO CODE CHECKS YET.
//
// A key is IN USE when some code decides something with it today: a backend
// @Permissions()/hasPermission() check, a frontend gate, or a requiredPermission
// on a seeded workflow transition of a record type that exists (Committee).
// Every key below is either referenced nowhere, or only by seeded transitions
// of record types not built yet (Meeting, Document, Audit, Incident).
//
// What it changes: GET roles/permissions marks these `inUse: false`; a role
// cannot GAIN one through PATCH roles/:id/permissions (400
// PERMISSION_NOT_IN_USE), and a role that already holds one KEEPS it whatever
// the request sends — a box nothing reads is not something to tick, and
// unticking it would quietly rewrite a seeded role for no effect.
//
// When a module starts checking a key, REMOVE it here in the same change.
// permissions-in-use.spec.ts reads the source and fails both ways: a listed key
// that code references, and an in-use key that nothing references.
//
// NOT a `*_PERMISSIONS` group: permission.seed.ts flattens only those, so this
// list can never be seeded as extra keys.
export const PERMISSIONS_NOT_YET_CHECKED: readonly string[] = [
  NOTIFICATIONS_PERMISSIONS.VIEW,
  NOTIFICATIONS_PERMISSIONS.MANAGE,
  MEETINGS_PERMISSIONS.MANAGE,
  MEETINGS_PERMISSIONS.RECORD_MINUTES,
  MEETINGS_PERMISSIONS.APPROVE_MINUTES,
  DOCUMENTS_PERMISSIONS.VIEW,
  DOCUMENTS_PERMISSIONS.CREATE,
  DOCUMENTS_PERMISSIONS.SUBMIT,
  DOCUMENTS_PERMISSIONS.REVIEW,
  DOCUMENTS_PERMISSIONS.APPROVE,
  DOCUMENTS_PERMISSIONS.PUBLISH,
  DOCUMENTS_PERMISSIONS.MANAGE_TEMPLATES,
  DOCUMENTS_PERMISSIONS.MANAGE_NUMBERING,
  STANDARDS_PERMISSIONS.VIEW,
  STANDARDS_PERMISSIONS.MANAGE,
  STANDARDS_PERMISSIONS.LINK_EVIDENCE,
  AUDITS_PERMISSIONS.VIEW,
  AUDITS_PERMISSIONS.CREATE,
  AUDITS_PERMISSIONS.EXECUTE,
  AUDITS_PERMISSIONS.REPORT,
  AUDITS_PERMISSIONS.CLOSE,
  INCIDENTS_PERMISSIONS.VIEW,
  INCIDENTS_PERMISSIONS.REPORT,
  INCIDENTS_PERMISSIONS.INVESTIGATE,
  INCIDENTS_PERMISSIONS.APPROVE_PLAN,
  INCIDENTS_PERMISSIONS.CLOSE,
  BILLING_PERMISSIONS.VIEW,
  BILLING_PERMISSIONS.MANAGE,
  REPORTS_PERMISSIONS.VIEW,
  REPORTS_PERMISSIONS.EXPORT,
  PLATFORM_PERMISSIONS.IMPERSONATE,
  KPI_PERMISSIONS.VIEW_OWN,
  KPI_PERMISSIONS.VIEW_DEPARTMENT,
  KPI_PERMISSIONS.VIEW_ALL,
  KPI_PERMISSIONS.ENTER_DATA,
  KPI_PERMISSIONS.VERIFY,
  KPI_PERMISSIONS.MANAGE,
  KPI_PERMISSIONS.MANAGE_SYSTEM,
];
