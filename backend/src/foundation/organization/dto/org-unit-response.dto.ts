import { IOrgUnit, IOrgUnitType } from '../interfaces/org-unit.interface';

export class OrgUnitResponseDto implements IOrgUnit {
  id!: string;
  organizationId!: string;
  parentId!: string | null;
  nameEn!: string;
  nameAr!: string | null;
  code!: string;
  /** ACC-137 — the superseded free-text key. Unchanged in name and shape so
   *  org-unit-tree's `{{ rowData.type }}` keeps rendering a string. */
  type!: string | null;
  typeValueId!: string | null;
  typeValue!: IOrgUnitType | null;
  description!: string | null;
  isActive!: boolean;
  isCodeLocked!: boolean;
  sortOrder!: number;
  createdAt!: Date;
  updatedAt!: Date;
  children?: OrgUnitResponseDto[];
}
