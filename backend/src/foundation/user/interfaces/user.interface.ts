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
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
