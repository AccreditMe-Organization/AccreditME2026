export interface ILookupCategory {
  id: string;
  organizationId: string | null;
  key: string;
  labelEn: string;
  labelAr: string;
  isSystem: boolean;
  isExtensible: boolean;
  attributeSchema: Record<string, unknown> | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
