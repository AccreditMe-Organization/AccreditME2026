import type { PrismaService } from '../../prisma/prisma.service';
import type { IOrgUnitType } from './interfaces/org-unit.interface';

// ACC-137 — the lookup category a unit's type comes from. Seeded as a SYSTEM
// category (organizationId null) and extensible, so a tenant may add its own
// values beside the six shipped ones — the seed already does, with `ward` for
// the hospital and `faculty`/`school`/`program`/`deanship` for the university.
export const ORG_UNIT_TYPE_CATEGORY = 'org_unit_type';

/**
 * The org_unit_type values visible to a tenant, by value id — ACC-137. Shared
 * since ACC-120 slice 11 by `OrganizationService` (writes and the old reads)
 * and `OrgStructureService` (the tree, the chart and the unit summary), so a
 * type resolves the same way on every surface.
 *
 * ## Why this is not `LookupService.getValues()`
 *
 * `getValues()` is the SELECTION list: it drops hidden values and inactive
 * ones, which is right for a picker and wrong here. A unit that already holds
 * a value the admin has since hidden must keep rendering its type, marked as
 * retired — an acceptance criterion, and the alternative is a type silently
 * vanishing from a column because someone tidied the Lookups page, which reads
 * as data loss.
 *
 * So this resolves the same TWO LAYERS by the same rules, and keeps what
 * `getValues()` discards:
 *
 *   - a SYSTEM value (organizationId null) is visible to every tenant;
 *   - a tenant row with the same key OVERRIDES its labels, and the id stays
 *     the SYSTEM row's, which is why the foreign key works for both layers;
 *   - a tenant row with a different key is that tenant's own value;
 *   - hidden or deactivated marks `isRetired` instead of removing the entry.
 *
 * Two queries per read, not per unit — the caller resolves the whole tree from
 * this map.
 */
export async function buildOrgUnitTypeResolver(
  prisma: Pick<PrismaService, 'lookupCategory' | 'lookupValue'>,
  organizationId: string,
): Promise<Map<string, IOrgUnitType>> {
  const category = await prisma.lookupCategory.findFirst({
    where: { key: ORG_UNIT_TYPE_CATEGORY, organizationId: null },
    select: { id: true },
  });
  if (!category) return new Map();

  const rows = await prisma.lookupValue.findMany({
    where: {
      categoryId: category.id,
      OR: [{ organizationId: null }, { organizationId }],
    },
  });

  const tenantByKey = new Map(
    rows.filter((r) => r.organizationId === organizationId).map((r) => [r.key, r]),
  );

  const resolved = new Map<string, IOrgUnitType>();
  for (const row of rows) {
    if (row.organizationId === null) {
      const override = tenantByKey.get(row.key);
      resolved.set(row.id, {
        id: row.id,
        key: row.key,
        labelEn: override?.labelOverrideEn ?? row.labelEn,
        labelAr: override?.labelOverrideAr ?? row.labelAr,
        isRetired: !row.isActive || (override ? override.isHidden || !override.isActive : false),
      });
    } else {
      resolved.set(row.id, {
        id: row.id,
        key: row.key,
        labelEn: row.labelOverrideEn ?? row.labelEn,
        labelAr: row.labelOverrideAr ?? row.labelAr,
        isRetired: !row.isActive || row.isHidden,
      });
    }
  }
  return resolved;
}
