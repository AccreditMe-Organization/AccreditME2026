export interface IBilingualName {
  nameEn: string;
  nameAr: string | null;
}

// ACC-79 — display names for the ids on a user record, returned by
// GET /users/:id beside the record itself.
//
// Why the endpoint resolves them. The profile page shows position, unit,
// manager and acting fields to every viewer, read-only for a non-admin
// (ACC-43). It used to resolve the ids through the position, org-unit and
// user LISTS — endpoints gated on positions:view, org:view and users:view — so
// for a user viewing their own profile without those, every one 403'd and the
// fields rendered blank. These are names of things ON the record the viewer is
// already allowed to read; they disclose nothing a list would, only the one
// referenced row each.
export interface IUserReferenceNames {
  position: IBilingualName | null;
  primaryOrgUnit: IBilingualName | null;
  actingOrgUnit: IBilingualName | null;
  manager: string | null;
  actingUser: string | null;
}

export interface IUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  status: string;
  language: string | null;
  positionId: string | null;
  primaryOrgUnitId: string | null;
  managerId: string | null;
  outOfOfficeFrom: Date | null;
  outOfOfficeTo: Date | null;
  actingUserId: string | null;
  actingOrgUnitId: string | null;
  actingOrgUnitUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
