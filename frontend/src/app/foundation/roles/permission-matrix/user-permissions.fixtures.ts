import type { UserPermissionGrantDto } from '../services/role.service';
import type { IUserDto } from '../../user/services/user.service';

/**
 * ACC-272 — the design's "A user's permissions" examples, for the specs and
 * the browser proof. Not imported by the app.
 *
 * Noura Al-Mutairi: 16 permissions through 3 active roles. Quality Editor's
 * 14, plus "See tasks on committees your unit or its sub-units own" from Unit
 * Head and "Approve terms, changes and dissolutions" from Patient Safety
 * Reviewer; Committees 9 of 12. Committee Secretary is held but inactive.
 */

export const QE_KEYS = [
  'tenant:view',
  'org:view',
  'users:view',
  'lookups:view',
  'workflows:view',
  'committees:view',
  'committees:create',
  'committees:edit_details',
  'committees:add_member',
  'committees:change_member_role',
  'committees:view_all_tasks',
  'committees:create_tasks',
  'meetings:view',
  'positions:view',
];

export interface GrantFixture {
  name: string;
  nameAr?: string | null;
  key?: string | null;
  source?: UserPermissionGrantDto['source'];
  isActive?: boolean;
  isSystem?: boolean;
  permissions: string[];
  positionId?: string | null;
  unitId?: string | null;
  grantedAt?: string;
  /** The names the server reads for a head grant; null when it found none. */
  headPosition?: { nameEn: string; nameAr: string | null } | null;
  headUnit?: { nameEn: string; nameAr: string | null } | null;
}

export function grant(over: GrantFixture): UserPermissionGrantDto {
  const source = over.source ?? 'DIRECT';
  const slug = over.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id: `ur-${slug}`,
    role: {
      id: `role-${slug}`,
      organizationId: 'org-1',
      key: over.key ?? null,
      nameEn: over.name,
      nameAr: over.nameAr ?? null,
      description: null,
      isSystem: over.isSystem ?? false,
      isActive: over.isActive ?? true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    grantedAt: over.grantedAt ?? '2026-10-03T09:00:00.000Z',
    source,
    grantedViaHeadPositionId: source === 'DIRECT' ? null : (over.positionId ?? 'pos-qd'),
    grantedViaHeadPositionOrgUnitId: source === 'HEAD_POSITION_UNIT' ? (over.unitId ?? 'unit-qd') : null,
    permissions: [...over.permissions].sort(),
    headPosition: source === 'DIRECT' ? null : (over.headPosition ?? null),
    headUnit: source === 'HEAD_POSITION_UNIT' ? (over.headUnit ?? null) : null,
  };
}

/** The server's order: oldest grant first. The page reorders. */
export function nouraGrants(): UserPermissionGrantDto[] {
  return [
    grant({ name: 'Quality Editor', nameAr: 'محرر الجودة', permissions: QE_KEYS }),
    grant({
      name: 'Committee Secretary',
      nameAr: 'أمين سر اللجنة',
      isActive: false,
      grantedAt: '2026-08-12T09:00:00.000Z',
      permissions: ['committees:add_member', 'committees:remove_member'],
    }),
    grant({
      name: 'Unit Head',
      nameAr: 'رئيس وحدة',
      source: 'HEAD_POSITION_UNIT',
      headPosition: { nameEn: 'Quality Director', nameAr: 'مدير الجودة' },
      headUnit: { nameEn: 'Quality Department', nameAr: 'إدارة الجودة' },
      permissions: ['org:view', 'users:view', 'committees:view', 'committees:view_unit_tasks', 'committees:create_tasks', 'meetings:view'],
    }),
    grant({
      name: 'Patient Safety Reviewer',
      nameAr: 'مراجع سلامة المرضى',
      source: 'HEAD_POSITION_UNIT',
      // An acting headship: the unit is the record's acting unit, and the head
      // position is that unit's, not the person's own.
      positionId: 'pos-psl',
      unitId: 'unit-ps',
      headPosition: { nameEn: 'Patient Safety Lead', nameAr: 'رئيس سلامة المرضى' },
      headUnit: { nameEn: 'Patient Safety Unit', nameAr: 'وحدة سلامة المرضى' },
      permissions: ['committees:view', 'committees:approve', 'committees:view_unit_tasks'],
    }),
  ];
}

/** Every shown key, through the root role alone (Layla Al-Harbi). */
export function rootGrants(allShownKeys: readonly string[]): UserPermissionGrantDto[] {
  return [
    grant({
      name: 'Organization Administrator',
      nameAr: 'مسؤول المنشأة',
      key: 'TENANT_ADMIN',
      isSystem: true,
      grantedAt: '2026-01-01T09:00:00.000Z',
      permissions: [...allShownKeys, 'platform:admin'],
    }),
  ];
}

/** Held, but inactive: no permissions. */
export function noActiveGrants(): UserPermissionGrantDto[] {
  return [nouraGrants()[1]!];
}

export function person(over: Partial<IUserDto> = {}): IUserDto {
  return {
    id: 'user-noura',
    organizationId: 'org-1',
    email: 'n.almutairi@alnakheel.example',
    name: 'Noura Al-Mutairi',
    avatarUrl: null,
    status: 'ACTIVE',
    language: 'en',
    positionId: 'pos-qd',
    primaryOrgUnitId: 'unit-qd',
    managerId: null,
    outOfOfficeFrom: null,
    outOfOfficeTo: null,
    actingUserId: null,
    actingOrgUnitId: 'unit-ps',
    actingOrgUnitUntil: null,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    references: {
      position: { nameEn: 'Quality Director', nameAr: 'مدير الجودة' },
      primaryOrgUnit: { nameEn: 'Quality Department', nameAr: 'إدارة الجودة' },
      actingOrgUnit: { nameEn: 'Patient Safety Unit', nameAr: 'وحدة سلامة المرضى' },
      manager: null,
      actingUser: null,
    },
    ...over,
  };
}

export function layla(): IUserDto {
  return person({
    id: 'user-layla',
    name: 'Layla Al-Harbi',
    email: 'l.alharbi@alnakheel.example',
    positionId: 'pos-sa',
    primaryOrgUnitId: 'unit-admin',
    actingOrgUnitId: null,
    references: {
      position: { nameEn: 'Systems Administrator', nameAr: 'مسؤول الأنظمة' },
      primaryOrgUnit: { nameEn: 'Administration', nameAr: 'الإدارة' },
      actingOrgUnit: null,
      manager: null,
      actingUser: null,
    },
  });
}
