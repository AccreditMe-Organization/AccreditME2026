import type { PrismaService } from '../../prisma/prisma.service';

const CATEGORY = 'committee_type';

/**
 * ACC-246 — a committee's OWN type, with its label, as the committee read
 * carries it.
 *
 * The Edit dialog's type picker used to show its placeholder until the
 * dialog's own `committee_type` list arrived, because the committee carried
 * only an id. With the label here the dialog shows the type the moment it
 * opens, and a type the organisation has since deactivated or hidden (which
 * `LookupService.getValues()` leaves out) still shows, marked, instead of the
 * placeholder.
 *
 * The labels follow `getValues()` exactly: a system value carries the tenant's
 * label override, if one is active. `offered` is whether `getValues()` would
 * return this value today — false for a deactivated value, a system value the
 * tenant has hidden, or a tenant row that is an override of a system key
 * (whose id `getValues()` never returns). The org-unit form's ACC-137 split,
 * for committees: shown, never offered as a new choice.
 *
 * Every read is scoped by organisation: another organisation's value, or an id
 * that is no committee type at all, resolves to nothing.
 */
export interface CommitteeTypeValue {
  id: string;
  key: string;
  labelEn: string;
  labelAr: string | null;
  offered: boolean;
}

export async function committeeTypeValues(
  prisma: Pick<PrismaService, 'lookupCategory' | 'lookupValue'>,
  organizationId: string,
  typeValueIds: string[],
): Promise<Map<string, CommitteeTypeValue>> {
  const result = new Map<string, CommitteeTypeValue>();
  const ids = [...new Set(typeValueIds.filter(Boolean))];
  if (ids.length === 0) return result;

  const category = await prisma.lookupCategory.findFirst({ where: { key: CATEGORY, organizationId: null }, select: { id: true } });
  if (!category) return result;

  const rows = await prisma.lookupValue.findMany({
    where: { id: { in: ids }, categoryId: category.id, OR: [{ organizationId: null }, { organizationId }] },
  });
  // The tenant's own rows for the same keys: overrides of the system values.
  const keys = [...new Set(rows.map((r) => r.key))];
  const tenantRows = await prisma.lookupValue.findMany({
    where: { categoryId: category.id, organizationId, key: { in: keys } },
  });
  const systemKeys = new Set(
    (await prisma.lookupValue.findMany({ where: { categoryId: category.id, organizationId: null, key: { in: keys } }, select: { key: true } })).map(
      (r) => r.key,
    ),
  );

  for (const row of rows) {
    if (row.organizationId === null) {
      const override = tenantRows.find((t) => t.key === row.key && t.isActive);
      result.set(row.id, {
        id: row.id,
        key: row.key,
        labelEn: override?.labelOverrideEn ?? row.labelEn,
        labelAr: override?.labelOverrideAr ?? row.labelAr,
        offered: row.isActive && !override?.isHidden,
      });
    } else {
      const isOverride = systemKeys.has(row.key);
      result.set(row.id, {
        id: row.id,
        key: row.key,
        labelEn: row.labelOverrideEn ?? row.labelEn,
        labelAr: row.labelOverrideAr ?? row.labelAr,
        offered: row.isActive && !isOverride,
      });
    }
  }
  return result;
}
