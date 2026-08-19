export interface IOrgPosition {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string | null;
  grade: number;
  isSingleAssignee: boolean;
  isUnitHeadPosition: boolean;
  roleId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
