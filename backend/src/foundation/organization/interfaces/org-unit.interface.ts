export interface IOrgUnit {
  id: string;
  organizationId: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string | null;
  code: string;
  type: string | null;
  description: string | null;
  isActive: boolean;
  isCodeLocked: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  children?: IOrgUnit[];
}
