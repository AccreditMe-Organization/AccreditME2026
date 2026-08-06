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
  VIEW:    'committees:view',
  MANAGE:  'committees:manage',
  APPROVE: 'committees:approve',
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

export const KPI_PERMISSIONS = {
  VIEW_OWN:        'kpi:view_own',
  VIEW_DEPARTMENT: 'kpi:view_department',
  VIEW_ALL:        'kpi:view_all',
  ENTER_DATA:      'kpi:enter_data',
  VERIFY:          'kpi:verify',
  MANAGE:          'kpi:manage',
  MANAGE_SYSTEM:   'kpi:manage_system',
} as const;
