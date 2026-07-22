import { IRole } from '../interfaces/role.interface';

export class RoleResponseDto implements IRole {
  id!: string;
  organizationId!: string;
  key!: string | null;
  nameEn!: string;
  nameAr!: string;
  description!: string | null;
  isSystem!: boolean;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
  permissions?: string[];
}
