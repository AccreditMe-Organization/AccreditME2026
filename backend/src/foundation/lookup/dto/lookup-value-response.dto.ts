import { ILookupValue, LookupLayer } from '../interfaces/lookup-value.interface';

export class LookupValueResponseDto implements ILookupValue {
  id!: string;
  organizationId!: string | null;
  categoryId!: string;
  key!: string;
  labelEn!: string;
  labelAr!: string;
  layer!: LookupLayer;
  attributes!: Record<string, unknown> | null;
  isActive!: boolean;
  isHidden!: boolean;
  labelOverrideEn!: string | null;
  labelOverrideAr!: string | null;
  sortOrder!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
