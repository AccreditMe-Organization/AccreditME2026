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
} from '../../common/constants/permissions';

const ALL = [
  TENANT_PERMISSIONS, ORG_PERMISSIONS, USERS_PERMISSIONS, ROLES_PERMISSIONS,
  LOOKUPS_PERMISSIONS, WORKFLOWS_PERMISSIONS, TASKS_PERMISSIONS, COMMITTEES_PERMISSIONS,
  NOTIFICATIONS_PERMISSIONS, MEETINGS_PERMISSIONS, DOCUMENTS_PERMISSIONS,
  STANDARDS_PERMISSIONS, AUDITS_PERMISSIONS, INCIDENTS_PERMISSIONS, BILLING_PERMISSIONS,
  REPORTS_PERMISSIONS, POSITIONS_PERMISSIONS, KPI_PERMISSIONS,
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
    permissions: [
      DOCUMENTS_PERMISSIONS.VIEW,
      TASKS_PERMISSIONS.VIEW,
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
];
