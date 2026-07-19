export type LookupLayer = 'SYSTEM' | 'TENANT';

export interface ILookupValue {
  id: string;
  organizationId: string | null;
  categoryId: string;
  key: string;
  labelEn: string;
  labelAr: string;
  layer: LookupLayer;
  attributes: Record<string, unknown> | null;
  isActive: boolean;
  isHidden: boolean;
  labelOverrideEn: string | null;
  labelOverrideAr: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
