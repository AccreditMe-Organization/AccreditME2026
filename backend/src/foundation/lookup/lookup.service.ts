import {
  BadRequestException,
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
import { OverrideAttributesDto } from './dto/override-attributes.dto';

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
            // ACC-286 — the organisation's own attribute values over the shared
            // ones, KEY BY KEY: a label-only override (a renamed seat) keeps
            // every shared default, such as Chairman being required.
            attributes:      mergeAttributes(sv.attributes, override.attributes),
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

  /**
   * ACC-286 — an organisation's own values for a SYSTEM value's attributes,
   * stored on its override row (the row that already carries hide and label
   * overrides) and read over the shared ones key by key (getValues()).
   *
   * Only keys the category's attributeSchema declares are accepted, each of its
   * declared type (boolean, number or string); anything else is 400
   * LOOKUP_ATTRIBUTE_INVALID naming the key, and nothing is written. null
   * removes the organisation's own value for that key, so the shared default
   * applies again. Keys not sent keep what the override already has.
   */
  async overrideAttributes(
    valueId: string,
    organizationId: string,
    dto: OverrideAttributesDto,
    actorId: string,
  ): Promise<void> {
    const systemValue = await this.prisma.lookupValue.findFirst({
      where: { id: valueId, organizationId: null, layer: 'SYSTEM' },
      include: { category: { select: { attributeSchema: true } } },
    });

    if (!systemValue) {
      throw new NotFoundException(`System lookup value '${valueId}' not found`);
    }

    const declared = schemaProperties(systemValue.category.attributeSchema);
    for (const [key, value] of Object.entries(dto.attributes)) {
      const type = declared.get(key);
      if (!type || (value !== null && typeof value !== type)) {
        throw new BadRequestException({
          statusCode: 400,
          message: `Lookup attribute '${key}' is not declared for this category, or has the wrong type`,
          error: 'Bad Request',
          code: 'LOOKUP_ATTRIBUTE_INVALID',
          key,
        });
      }
    }

    const existing = await this.prisma.lookupValue.findFirst({
      where: { categoryId: systemValue.categoryId, key: systemValue.key, organizationId },
      select: { attributes: true },
    });
    const before = asRecord(existing?.attributes) ?? {};
    const after: Record<string, unknown> = { ...before };
    for (const [key, value] of Object.entries(dto.attributes)) {
      if (value === null) delete after[key];
      else after[key] = value;
    }
    const stored = Object.keys(after).length > 0 ? (after as Prisma.InputJsonValue) : Prisma.DbNull;

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
        attributes:      stored,
      },
      update: { attributes: stored },
    });

    await this.auditLog.log({
      tenantId:   organizationId,
      actorId,
      action:     'UPDATE',
      objectType: 'LookupValue',
      objectId:   valueId,
      before:     { attributes: before },
      after:      { attributes: after },
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

    // AI stub — when activated, call the gateway, never the provider (ACC-194):
    //   this.aiService.run(featureKey, { organizationId, actorId }, { prompt, description })
    // with a priced feature key added to foundation/ai/ai.config.ts and an
    // AiFeatureCost row. `npm run check:ai-gateway` refuses a direct provider call.
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
    labelAr: string | null;
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

/** A stored JSON value as a plain object, or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * ACC-286 — a SYSTEM value's attributes with the organisation's override over
 * them, key by key (never the whole object replaced). Null when neither has any.
 */
export function mergeAttributes(shared: unknown, own: unknown): Prisma.JsonValue {
  const base = asRecord(shared);
  const mine = asRecord(own);
  if (!base && !mine) return (shared ?? null) as Prisma.JsonValue;
  return { ...(base ?? {}), ...(mine ?? {}) } as Prisma.JsonValue;
}

/** The property name → primitive type an attributeSchema declares ('boolean' | 'number' | 'string'). */
function schemaProperties(schema: unknown): Map<string, string> {
  const properties = asRecord(asRecord(schema)?.['properties']) ?? {};
  const out = new Map<string, string>();
  for (const [key, def] of Object.entries(properties)) {
    const type = asRecord(def)?.['type'];
    out.set(key, type === 'boolean' || type === 'number' ? type : 'string');
  }
  return out;
}
