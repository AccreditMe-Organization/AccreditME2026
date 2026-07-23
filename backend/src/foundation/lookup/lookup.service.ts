import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { SYSTEM_LOOKUP_SEED } from './lookup.seed';
import { ILookupCategory } from './interfaces/lookup-category.interface';
import { ILookupValue } from './interfaces/lookup-value.interface';
import { UpdateLookupCategoryDto } from './dto/update-lookup-category.dto';
import { CreateLookupValueDto } from './dto/create-lookup-value.dto';
import { UpdateLookupValueDto } from './dto/update-lookup-value.dto';
import { OverrideLabelDto } from './dto/override-label.dto';

export interface SuggestedValue {
  key: string;
  labelEn: string;
  labelAr: string;
}

@Injectable()
export class LookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ── Seed ─────────────────────────────────────────────────────────────────

  async seedSystemData(): Promise<void> {
    for (const category of SYSTEM_LOOKUP_SEED) {
      const existing = await this.prisma.lookupCategory.findFirst({
        where: { key: category.key, organizationId: null },
      });

      const categoryData = {
        labelEn:         category.labelEn,
        labelAr:         category.labelAr,
        isSystem:        true,
        isExtensible:    category.isExtensible,
        attributeSchema: category.attributeSchema
          ? (category.attributeSchema as Prisma.InputJsonValue)
          : Prisma.DbNull,
        sortOrder: category.sortOrder,
      };

      let seededCategory;
      if (existing) {
        seededCategory = await this.prisma.lookupCategory.update({
          where: { id: existing.id },
          data:  categoryData,
        });
      } else {
        seededCategory = await this.prisma.lookupCategory.create({
          data: {
            key:            category.key,
            organizationId: null,
            isActive:       true,
            ...categoryData,
          },
        });
      }

      for (const value of category.values) {
        const existingValue = await this.prisma.lookupValue.findFirst({
          where: {
            categoryId:     seededCategory.id,
            key:            value.key,
            organizationId: null,
          },
        });

        const valueData = {
          labelEn:    value.labelEn,
          labelAr:    value.labelAr,
          attributes: value.attributes
            ? (value.attributes as Prisma.InputJsonValue)
            : Prisma.DbNull,
          sortOrder: value.sortOrder,
        };

        if (existingValue) {
          await this.prisma.lookupValue.update({
            where: { id: existingValue.id },
            data:  valueData,
          });
        } else {
          await this.prisma.lookupValue.create({
            data: {
              categoryId:     seededCategory.id,
              organizationId: null,
              key:            value.key,
              layer:          'SYSTEM',
              isActive:       true,
              isHidden:       false,
              ...valueData,
            },
          });
        }
      }
    }
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async getCategories(organizationId: string): Promise<ILookupCategory[]> {
    const categories = await this.prisma.lookupCategory.findMany({
      where: { isActive: true, organizationId: null },
      orderBy: { sortOrder: 'asc' },
    });

    void organizationId;
    return categories.map((c) => this.mapCategory(c));
  }

  async getCategoryByKey(
    key: string,
    organizationId: string,
  ): Promise<ILookupCategory> {
    const category = await this.prisma.lookupCategory.findFirst({
      where: { key, organizationId: null },
    });

    if (!category) {
      throw new NotFoundException(`Lookup category '${key}' not found`);
    }

    void organizationId;
    return this.mapCategory(category);
  }

  async updateCategory(
    key: string,
    organizationId: string,
    dto: UpdateLookupCategoryDto,
    actorId: string,
  ): Promise<ILookupCategory> {
    const category = await this.prisma.lookupCategory.findFirst({
      where: { key, organizationId: null },
    });

    if (!category) {
      throw new NotFoundException(`Lookup category '${key}' not found`);
    }

    const updated = await this.prisma.lookupCategory.update({
      where: { id: category.id },
      data: {
        ...(dto.labelEn         !== undefined && { labelEn:         dto.labelEn }),
        ...(dto.labelAr         !== undefined && { labelAr:         dto.labelAr }),
        ...(dto.attributeSchema !== undefined && { attributeSchema: dto.attributeSchema as Prisma.InputJsonValue }),
        ...(dto.sortOrder       !== undefined && { sortOrder:       dto.sortOrder }),
      },
    });

    await this.auditLog.log({
      tenantId:   organizationId,
      actorId,
      action:     'UPDATE',
      objectType: 'LookupCategory',
      objectId:   category.id,
      before:     { labelEn: category.labelEn, labelAr: category.labelAr, sortOrder: category.sortOrder },
      after:      { labelEn: updated.labelEn,   labelAr: updated.labelAr,   sortOrder: updated.sortOrder },
    });

    return this.mapCategory(updated);
  }

  async deactivateCategory(
    key: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const category = await this.prisma.lookupCategory.findFirst({
      where: { key, organizationId: null },
    });

    if (!category) {
      throw new NotFoundException(`Lookup category '${key}' not found`);
    }

    if (!category.isActive) {
      return;
    }

    await this.prisma.lookupCategory.update({
      where: { id: category.id },
      data:  { isActive: false },
    });

    await this.auditLog.log({
      tenantId:   organizationId,
      actorId,
      action:     'UPDATE',
      objectType: 'LookupCategory',
      objectId:   category.id,
      before:     { isActive: true },
      after:      { isActive: false },
    });
  }

  // ── Values ────────────────────────────────────────────────────────────────

  async getValues(
    categoryKey: string,
    organizationId: string,
  ): Promise<ILookupValue[]> {
    const category = await this.prisma.lookupCategory.findFirst({
      where: { key: categoryKey, organizationId: null },
    });

    if (!category) {
      throw new NotFoundException(`Lookup category '${categoryKey}' not found`);
    }

    const systemValues = await this.prisma.lookupValue.findMany({
      where: { categoryId: category.id, organizationId: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    const tenantRecords = await this.prisma.lookupValue.findMany({
      where: { categoryId: category.id, organizationId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    const tenantByKey = new Map(tenantRecords.map((r) => [r.key, r]));
    const result: ILookupValue[] = [];

    for (const sv of systemValues) {
      const override = tenantByKey.get(sv.key);

      if (override?.isHidden) {
        tenantByKey.delete(sv.key);
        continue;
      }

      if (override) {
        result.push(
          this.mapValue({
            ...sv,
            labelEn:         override.labelOverrideEn ?? sv.labelEn,
            labelAr:         override.labelOverrideAr ?? sv.labelAr,
            labelOverrideEn: override.labelOverrideEn,
            labelOverrideAr: override.labelOverrideAr,
          }),
        );
        tenantByKey.delete(sv.key);
      } else {
        result.push(this.mapValue(sv));
      }
    }

    for (const tv of tenantByKey.values()) {
      result.push(this.mapValue(tv));
    }

    result.sort((a, b) => a.sortOrder - b.sortOrder);

    return result;
  }

  async addValue(
    categoryKey: string,
    organizationId: string,
    dto: CreateLookupValueDto,
    actorId: string,
  ): Promise<ILookupValue> {
    const category = await this.prisma.lookupCategory.findFirst({
      where: { key: categoryKey, organizationId: null },
    });

    if (!category) {
      throw new NotFoundException(`Lookup category '${categoryKey}' not found`);
    }

    if (!category.isExtensible) {
      throw new ForbiddenException(
        `Lookup category '${categoryKey}' does not allow tenant-defined values`,
      );
    }

    const existing = await this.prisma.lookupValue.findUnique({
      where: {
        categoryId_key_organizationId: {
          categoryId:     category.id,
          key:            dto.key,
          organizationId,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `A value with key '${dto.key}' already exists in category '${categoryKey}'`,
      );
    }

    const value = await this.prisma.lookupValue.create({
      data: {
        categoryId:     category.id,
        organizationId,
        key:            dto.key,
        labelEn:        dto.labelEn,
        labelAr:        dto.labelAr,
        layer:          'TENANT',
        attributes:     dto.attributes ? (dto.attributes as Prisma.InputJsonValue) : Prisma.DbNull,
        isActive:       dto.isActive ?? true,
        isHidden:       false,
        sortOrder:      dto.sortOrder ?? 0,
      },
    });

    await this.auditLog.log({
      tenantId:   organizationId,
      actorId,
      action:     'CREATE',
      objectType: 'LookupValue',
      objectId:   value.id,
      after:      { key: value.key, categoryKey, layer: 'TENANT' },
    });

    return this.mapValue(value);
  }

  async updateValue(
    id: string,
    organizationId: string,
    dto: UpdateLookupValueDto,
    actorId: string,
  ): Promise<ILookupValue> {
    const value = await this.prisma.lookupValue.findFirst({
      where: { id, organizationId },
    });

    if (!value) {
      throw new NotFoundException(`Lookup value '${id}' not found`);
    }

    if (value.layer === 'SYSTEM') {
      throw new ForbiddenException(
        'System lookup values cannot be edited directly. Use hide or override-label instead.',
      );
    }

    const updated = await this.prisma.lookupValue.update({
      where: { id },
      data: {
        ...(dto.labelEn    !== undefined && { labelEn:    dto.labelEn }),
        ...(dto.labelAr    !== undefined && { labelAr:    dto.labelAr }),
        ...(dto.attributes !== undefined && { attributes: dto.attributes as Prisma.InputJsonValue }),
        ...(dto.isActive   !== undefined && { isActive:   dto.isActive }),
        ...(dto.sortOrder  !== undefined && { sortOrder:  dto.sortOrder }),
      },
    });

    await this.auditLog.log({
      tenantId:   organizationId,
      actorId,
      action:     'UPDATE',
      objectType: 'LookupValue',
      objectId:   id,
      before:     { labelEn: value.labelEn,   labelAr: value.labelAr },
      after:      { labelEn: updated.labelEn, labelAr: updated.labelAr },
    });

    return this.mapValue(updated);
  }

  async removeValue(
    id: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const value = await this.prisma.lookupValue.findFirst({
      where: { id, organizationId },
    });

    if (!value) {
      throw new NotFoundException(`Lookup value '${id}' not found`);
    }

    if (value.layer === 'SYSTEM') {
      throw new ForbiddenException(
        'System lookup values cannot be deleted. Use hide instead.',
      );
    }

    await this.prisma.lookupValue.update({
      where: { id },
      data:  { isActive: false },
    });

    await this.auditLog.log({
      tenantId:   organizationId,
      actorId,
      action:     'DELETE',
      objectType: 'LookupValue',
      objectId:   id,
      before:     { key: value.key, isActive: true },
      after:      { isActive: false },
    });
  }

  async hideSystemValue(
    valueId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const systemValue = await this.prisma.lookupValue.findFirst({
      where: { id: valueId, organizationId: null, layer: 'SYSTEM' },
    });

    if (!systemValue) {
      throw new NotFoundException(`System lookup value '${valueId}' not found`);
    }

    await this.prisma.lookupValue.upsert({
      where: {
        categoryId_key_organizationId: {
          categoryId:     systemValue.categoryId,
          key:            systemValue.key,
          organizationId,
        },
      },
      create: {
        categoryId:     systemValue.categoryId,
        organizationId,
        key:            systemValue.key,
        labelEn:        systemValue.labelEn,
        labelAr:        systemValue.labelAr,
        layer:          'TENANT',
        isActive:       true,
        isHidden:       true,
        sortOrder:      systemValue.sortOrder,
      },
      update: { isHidden: true },
    });

    await this.auditLog.log({
      tenantId:   organizationId,
      actorId,
      action:     'UPDATE',
      objectType: 'LookupValue',
      objectId:   valueId,
      after:      { isHidden: true, systemValueKey: systemValue.key },
    });
  }

  async unhideSystemValue(
    valueId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const systemValue = await this.prisma.lookupValue.findFirst({
      where: { id: valueId, organizationId: null, layer: 'SYSTEM' },
    });

    if (!systemValue) {
      throw new NotFoundException(`System lookup value '${valueId}' not found`);
    }

    await this.prisma.lookupValue.updateMany({
      where: {
        categoryId:     systemValue.categoryId,
        key:            systemValue.key,
        organizationId,
        layer:          'TENANT',
      },
      data: { isHidden: false },
    });

    await this.auditLog.log({
      tenantId:   organizationId,
      actorId,
      action:     'UPDATE',
      objectType: 'LookupValue',
      objectId:   valueId,
      after:      { isHidden: false, systemValueKey: systemValue.key },
    });
  }

  async overrideLabel(
    valueId: string,
    organizationId: string,
    dto: OverrideLabelDto,
    actorId: string,
  ): Promise<void> {
    const systemValue = await this.prisma.lookupValue.findFirst({
      where: { id: valueId, organizationId: null, layer: 'SYSTEM' },
    });

    if (!systemValue) {
      throw new NotFoundException(`System lookup value '${valueId}' not found`);
    }

    await this.prisma.lookupValue.upsert({
      where: {
        categoryId_key_organizationId: {
          categoryId:     systemValue.categoryId,
          key:            systemValue.key,
          organizationId,
        },
      },
      create: {
        categoryId:      systemValue.categoryId,
        organizationId,
        key:             systemValue.key,
        labelEn:         systemValue.labelEn,
        labelAr:         systemValue.labelAr,
        layer:           'TENANT',
        isActive:        true,
        isHidden:        false,
        sortOrder:       systemValue.sortOrder,
        labelOverrideEn: dto.labelOverrideEn,
        labelOverrideAr: dto.labelOverrideAr,
      },
      update: {
        labelOverrideEn: dto.labelOverrideEn,
        labelOverrideAr: dto.labelOverrideAr,
      },
    });

    await this.auditLog.log({
      tenantId:   organizationId,
      actorId,
      action:     'UPDATE',
      objectType: 'LookupValue',
      objectId:   valueId,
      after:      { labelOverrideEn: dto.labelOverrideEn, labelOverrideAr: dto.labelOverrideAr },
    });
  }

  async suggestValues(
    categoryKey: string,
    organizationId: string,
    _actorId: string,
  ): Promise<SuggestedValue[]> {
    const category = await this.prisma.lookupCategory.findFirst({
      where: { key: categoryKey, organizationId: null },
    });

    if (!category) {
      throw new NotFoundException(`Lookup category '${categoryKey}' not found`);
    }

    // AI stub — when activated, call:
    //   this.aiProvider.complete(prompt, organizationId, { actorId, feature: 'lookup.suggestValues' })
    // organizationId and actorId must both be threaded through to satisfy
    // AiProvider's tenant-scoped signature and AiInteractionLog's actor field.
    void organizationId;
    return [];
  }

  // ── Private mappers ───────────────────────────────────────────────────────

  private mapCategory(c: {
    id: string;
    organizationId: string | null;
    key: string;
    labelEn: string;
    labelAr: string;
    isSystem: boolean;
    isExtensible: boolean;
    attributeSchema: unknown;
    isActive: boolean;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }): ILookupCategory {
    return {
      id:              c.id,
      organizationId:  c.organizationId,
      key:             c.key,
      labelEn:         c.labelEn,
      labelAr:         c.labelAr,
      isSystem:        c.isSystem,
      isExtensible:    c.isExtensible,
      attributeSchema: (c.attributeSchema as Record<string, unknown>) ?? null,
      isActive:        c.isActive,
      sortOrder:       c.sortOrder,
      createdAt:       c.createdAt,
      updatedAt:       c.updatedAt,
    };
  }

  private mapValue(v: {
    id: string;
    organizationId: string | null;
    categoryId: string;
    key: string;
    labelEn: string;
    labelAr: string;
    layer: string;
    attributes: unknown;
    isActive: boolean;
    isHidden: boolean;
    labelOverrideEn: string | null;
    labelOverrideAr: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }): ILookupValue {
    return {
      id:              v.id,
      organizationId:  v.organizationId,
      categoryId:      v.categoryId,
      key:             v.key,
      labelEn:         v.labelEn,
      labelAr:         v.labelAr,
      layer:           v.layer as 'SYSTEM' | 'TENANT',
      attributes:      (v.attributes as Record<string, unknown>) ?? null,
      isActive:        v.isActive,
      isHidden:        v.isHidden,
      labelOverrideEn: v.labelOverrideEn,
      labelOverrideAr: v.labelOverrideAr,
      sortOrder:       v.sortOrder,
      createdAt:       v.createdAt,
      updatedAt:       v.updatedAt,
    };
  }
}
