import {
  TENANT_PERMISSIONS,
  ORG_PERMISSIONS,
  USERS_PERMISSIONS,
  ROLES_PERMISSIONS,
  LOOKUPS_PERMISSIONS,
  WORKFLOWS_PERMISSIONS,
  TASKS_PERMISSIONS,
  COMMITTEES_PERMISSIONS,
  NOTIFICATIONS_PERMISSIONS,
  MEETINGS_PERMISSIONS,
  DOCUMENTS_PERMISSIONS,
  STANDARDS_PERMISSIONS,
  AUDITS_PERMISSIONS,
  INCIDENTS_PERMISSIONS,
  BILLING_PERMISSIONS,
  REPORTS_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  POSITIONS_PERMISSIONS,
  KPI_PERMISSIONS,
  SETUP_PERMISSIONS,
  ADMIN_PERMISSIONS,
} from '../../common/constants/permissions';

const ALL = [
  TENANT_PERMISSIONS, ORG_PERMISSIONS, USERS_PERMISSIONS, ROLES_PERMISSIONS,
  LOOKUPS_PERMISSIONS, WORKFLOWS_PERMISSIONS, TASKS_PERMISSIONS, COMMITTEES_PERMISSIONS,
  NOTIFICATIONS_PERMISSIONS, MEETINGS_PERMISSIONS, DOCUMENTS_PERMISSIONS,
  STANDARDS_PERMISSIONS, AUDITS_PERMISSIONS, INCIDENTS_PERMISSIONS, BILLING_PERMISSIONS,
  REPORTS_PERMISSIONS, POSITIONS_PERMISSIONS, KPI_PERMISSIONS,
  // ACC-82 — Setup health visibility. TENANT_ADMIN only, via this spread; not in
  // VIEWER's readOnly() list, which is explicit.
  SETUP_PERMISSIONS,
  // ACC-123 — admin:access, the Administration section's own gate. Reaches
  // TENANT_ADMIN through this spread and no other seeded role, which is the
  // whole point: QUALITY_MANAGER holds users:view and workflows:view for its
  // pickers, and that must no longer be read as "may administer".
  //
  // A tenant is free to grant it to a custom role — it is an ordinary
  // permission in the catalogue, editable on the Roles screen like any other.
  ADMIN_PERMISSIONS,
].flatMap((g) => Object.values(g));

const readOnly = (...groups: Record<string, string>[]) =>
  groups.map((g) => g['VIEW']).filter((v): v is string => Boolean(v));

export interface SeedRole {
  key: string;
  nameEn: string;
  nameAr: string;
  description: string;
  permissions: string[];
}

export const SYSTEM_ROLE_SEED: SeedRole[] = [
  {
    key: 'PLATFORM_ADMIN',
    nameEn: 'Platform Administrator',
    nameAr: 'مسؤول المنصة',
    description:
      'AccreditMe platform staff — full access, used during impersonation (Step 12).',
    permissions: [...ALL, ...Object.values(PLATFORM_PERMISSIONS)],
  },
  {
    key: 'TENANT_ADMIN',
    nameEn: 'Organization Administrator',
    nameAr: 'مسؤول المؤسسة',
    description:
      'Full administrative access within the organization (excludes platform-level actions).',
    permissions: ALL.filter((p) => !p.startsWith('platform:')),
  },
  {
    key: 'QUALITY_MANAGER',
    nameEn: 'Quality Manager',
    nameAr: 'مدير الجودة',
    description:
      'Manages quality processes across documents, standards, audits, incidents, and meetings.',
    permissions: [
      ...Object.values(DOCUMENTS_PERMISSIONS),
      ...Object.values(STANDARDS_PERMISSIONS),
      ...Object.values(AUDITS_PERMISSIONS),
      ...Object.values(INCIDENTS_PERMISSIONS),
      ...Object.values(MEETINGS_PERMISSIONS),
      ...Object.values(COMMITTEES_PERMISSIONS),
      ...Object.values(TASKS_PERMISSIONS),
      ...Object.values(KPI_PERMISSIONS),
      ...Object.values(REPORTS_PERMISSIONS),
      ORG_PERMISSIONS.VIEW,
      USERS_PERMISSIONS.VIEW,
      LOOKUPS_PERMISSIONS.VIEW,
      WORKFLOWS_PERMISSIONS.VIEW,
    ],
  },
  {
    key: 'QUALITY_OFFICER',
    nameEn: 'Quality Officer',
    nameAr: 'مسؤول الجودة',
    description:
      'Operational quality tasks — drafting, reviewing, and executing day-to-day work.',
    permissions: [
      DOCUMENTS_PERMISSIONS.VIEW,
      DOCUMENTS_PERMISSIONS.CREATE,
      DOCUMENTS_PERMISSIONS.SUBMIT,
      DOCUMENTS_PERMISSIONS.REVIEW,
      STANDARDS_PERMISSIONS.VIEW,
      STANDARDS_PERMISSIONS.LINK_EVIDENCE,
      AUDITS_PERMISSIONS.VIEW,
      AUDITS_PERMISSIONS.EXECUTE,
      INCIDENTS_PERMISSIONS.VIEW,
      INCIDENTS_PERMISSIONS.REPORT,
      INCIDENTS_PERMISSIONS.INVESTIGATE,
      MEETINGS_PERMISSIONS.VIEW,
      MEETINGS_PERMISSIONS.RECORD_MINUTES,
      TASKS_PERMISSIONS.VIEW,
      TASKS_PERMISSIONS.MANAGE,
      KPI_PERMISSIONS.VIEW_DEPARTMENT,
      KPI_PERMISSIONS.ENTER_DATA,
      REPORTS_PERMISSIONS.VIEW,
    ],
  },
  {
    key: 'AUDITOR',
    nameEn: 'Auditor',
    nameAr: 'مراجع',
    description: 'Conducts and reports internal/external audits.',
    permissions: [
      ...Object.values(AUDITS_PERMISSIONS),
      STANDARDS_PERMISSIONS.VIEW,
      DOCUMENTS_PERMISSIONS.VIEW,
      INCIDENTS_PERMISSIONS.VIEW,
      INCIDENTS_PERMISSIONS.REPORT,
      TASKS_PERMISSIONS.VIEW,
      KPI_PERMISSIONS.VIEW_DEPARTMENT,
      REPORTS_PERMISSIONS.VIEW,
    ],
  },
  {
    key: 'BASE_USER',
    nameEn: 'Base User',
    nameAr: 'مستخدم أساسي',
    description:
      'Baseline full-user role — view assigned work and enter own KPI data. ' +
      'Deliberately not named "Staff" — see Business Rules for why, and how this ' +
      'differs from the "Staff member" portal-only user type (Step 17b).',
    // ACC-101 — tasks:view REMOVED, and its absence is load-bearing.
    //
    // It reads like the permission that lets someone see their own work, and it
    // is not. GET /tasks/my-tasks carries NO permission at all (ACC-70): it is
    // self-scoped by construction, filtering on the caller's own assignee rows.
    // What tasks:view actually gates is the tenant-wide reads —
    // GET /tasks?sourceType=…&sourceId=… and GET /tasks/:id — which can return
    // ANY task in the tenant, with assignee names and delegation labels on it.
    //
    // Granting that to the role every ordinary staff member gets meant every
    // staff member could read any committee's task list, given its id. The
    // parent check added in this ticket closes the disclosure; removing it here
    // stops the baseline role from claiming an administrative read it never
    // needed. A BASE_USER loses nothing they use: their own tasks still arrive
    // through my-tasks, and the My Tasks rail item carries no permission either.
    //
    // The exact set below is pinned in role.seed.spec.ts. Add nothing here
    // without deciding it belongs to everyone in the tenant.
    permissions: [
      DOCUMENTS_PERMISSIONS.VIEW,
      MEETINGS_PERMISSIONS.VIEW,
      KPI_PERMISSIONS.VIEW_OWN,
      KPI_PERMISSIONS.ENTER_DATA,
      NOTIFICATIONS_PERMISSIONS.VIEW,
    ],
  },
  {
    key: 'VIEWER',
    nameEn: 'Viewer',
    nameAr: 'مشاهد',
    description: 'Read-only access across all modules.',
    permissions: readOnly(
      ORG_PERMISSIONS,
      USERS_PERMISSIONS,
      ROLES_PERMISSIONS,
      LOOKUPS_PERMISSIONS,
      WORKFLOWS_PERMISSIONS,
      TASKS_PERMISSIONS,
      COMMITTEES_PERMISSIONS,
      MEETINGS_PERMISSIONS,
      DOCUMENTS_PERMISSIONS,
      STANDARDS_PERMISSIONS,
      AUDITS_PERMISSIONS,
      INCIDENTS_PERMISSIONS,
      REPORTS_PERMISSIONS,
    ),
  },
  {
    key: 'READ_ONLY_ADMIN',
    nameEn: 'Read-Only Administrator',
    nameAr: 'مسؤول للاطلاع فقط',
    description:
      'Sees every administrative screen and changes nothing. For surveyors, internal ' +
      'auditors and executives who must inspect how the tenant is configured without ' +
      'being able to alter it.',
    // ACC-123 — the role admin:access left the seed needing.
    //
    // WHY IT EXISTS, since at a glance it is VIEWER plus one string. ACC-123 split
    // "may open this page" from "is an administrator", and an Administration route
    // now requires BOTH. That left the entire section reachable by exactly one
    // seeded role — TENANT_ADMIN, which holds all 72 permissions. So the per-slice
    // verification gate every ACC-120 slice carries ("verify with someone who can
    // reach the page but lacks the write permission") became unsatisfiable by
    // construction: nobody could stand on an admin screen without also being able
    // to change everything on it. Measured before building — zero of the other
    // seven seeded roles can reach /users at all.
    //
    // NOT AN EXTENSION OF VIEWER, and that was measured too rather than assumed.
    // VIEWER holds 13 of these 22. readOnly() takes each group's plain VIEW key
    // only, so VIEWER lacks setup:view, billing:view, tenant:view, positions:view,
    // notifications:view and all three kpi:view_*; widening it would change what
    // VIEWER means for every tenant already using it. More decisively,
    // ADMIN_PERMISSIONS' own comment says admin:access exists so that holding view
    // permissions FOR PICKERS stops reading as "may administer" — VIEWER is the
    // clearest instance of that shape, so granting it admin:access would undo this
    // ticket rather than build on it. AUDITOR is further away still (15 missing)
    // and holds five write permissions; it is a doer, not a reader.
    //
    // DERIVED, NOT HAND-LISTED, and the derivation is the guarantee: every
    // view-shaped permission in the catalogue and nothing else. A hand-written list
    // is where a write permission eventually arrives by a paste, and this role's
    // whole value is that it cannot change anything.
    //
    // role.seed.spec.ts pins the resulting 22 EXACTLY, so a view-shaped permission
    // added later fails a test instead of silently joining the role a surveyor
    // holds — same reason BASE_USER's set is pinned (ACC-101). Note what the
    // derivation does NOT decide: whether a new read SHOULD be visible to an
    // inspector. kpi:view_all is a genuinely wide read and is in here; a future
    // documents:view_confidential would be too. Read the failing test as the
    // question it is.
    permissions: [
      ADMIN_PERMISSIONS.ACCESS,
      ...ALL.filter((p) => /:(view|view_[a-z_]+)$/.test(p)),
    ],
  },
];
