export interface IOrgPosition {
  id: string;
  organizationId: string;
  orgUnitId: string | null;
  nameEn: string;
  nameAr: string | null;
  grade: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
