import type { PrismaService } from '../../prisma/prisma.service';
import { committeeTypeValues } from './committee-type-values';

// ACC-246 — a committee's own type, labelled as getValues() labels it, and
// whether getValues() still offers it.

const ORG = 'org-a';
const CAT = 'cat-type';

type Row = {
  id: string;
  organizationId: string | null;
  categoryId: string;
  key: string;
  labelEn: string;
  labelAr: string | null;
  isActive: boolean;
  isHidden: boolean;
  labelOverrideEn: string | null;
  labelOverrideAr: string | null;
};
const row = (over: Partial<Row>): Row => ({
  id: 'x',
  organizationId: null,
  categoryId: CAT,
  key: 'quality',
  labelEn: 'Quality Committee',
  labelAr: 'لجنة الجودة',
  isActive: true,
  isHidden: false,
  labelOverrideEn: null,
  labelOverrideAr: null,
  ...over,
});

/** A fake that answers each findMany by the filters the helper sends, the way Postgres would. */
function db(rows: Row[]) {
  const findMany = jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    rows.filter((r) => {
      if (where['categoryId'] && r.categoryId !== where['categoryId']) return false;
      const id = where['id'] as { in: string[] } | undefined;
      if (id && !id.in.includes(r.id)) return false;
      const key = where['key'] as { in: string[] } | undefined;
      if (key && !key.in.includes(r.key)) return false;
      if ('organizationId' in where && r.organizationId !== where['organizationId']) return false;
      const or = where['OR'] as { organizationId: string | null }[] | undefined;
      if (or && !or.some((o) => o.organizationId === r.organizationId)) return false;
      return true;
    }),
  );
  const prisma = {
    lookupCategory: { findFirst: jest.fn().mockResolvedValue({ id: CAT }) },
    lookupValue: { findMany },
  } as unknown as Pick<PrismaService, 'lookupCategory' | 'lookupValue'>;
  return { prisma, findMany };
}

describe('committeeTypeValues (ACC-246)', () => {
  it('labels a system value with the tenant override, and offers it', async () => {
    const { prisma } = db([
      row({ id: 'sys' }),
      row({ id: 'ov', organizationId: ORG, labelOverrideEn: 'Quality Council', labelOverrideAr: 'مجلس الجودة' }),
    ]);
    expect((await committeeTypeValues(prisma, ORG, ['sys'])).get('sys')).toEqual({
      id: 'sys',
      key: 'quality',
      labelEn: 'Quality Council',
      labelAr: 'مجلس الجودة',
      offered: true,
    });
  });

  it('a deactivated system value, and one the tenant hid, are labelled but not offered', async () => {
    const { prisma } = db([
      row({ id: 'off', key: 'old', isActive: false }),
      row({ id: 'sys', key: 'safety', labelEn: 'Safety' }),
      row({ id: 'hide', organizationId: ORG, key: 'safety', isHidden: true }),
    ]);
    const map = await committeeTypeValues(prisma, ORG, ['off', 'sys']);
    expect(map.get('off')).toMatchObject({ labelEn: 'Quality Committee', offered: false });
    expect(map.get('sys')).toMatchObject({ labelEn: 'Safety', offered: false });
  });

  it("a tenant's own value is offered while active; an override row's id never is", async () => {
    const { prisma } = db([
      row({ id: 'own', organizationId: ORG, key: 'ethics', labelEn: 'Ethics' }),
      row({ id: 'own-off', organizationId: ORG, key: 'legacy', labelEn: 'Legacy', isActive: false }),
      row({ id: 'sys' }),
      row({ id: 'ov', organizationId: ORG, labelOverrideEn: 'Quality Council' }),
    ]);
    const map = await committeeTypeValues(prisma, ORG, ['own', 'own-off', 'ov']);
    expect(map.get('own')).toMatchObject({ labelEn: 'Ethics', offered: true });
    expect(map.get('own-off')).toMatchObject({ labelEn: 'Legacy', offered: false });
    expect(map.get('ov')).toMatchObject({ labelEn: 'Quality Council', offered: false });
  });

  it("should NOT return records belonging to a different tenant — another organisation's value resolves to nothing", async () => {
    const { prisma, findMany } = db([row({ id: 'theirs', organizationId: 'org-b', key: 'ethics' })]);
    expect((await committeeTypeValues(prisma, ORG, ['theirs'])).size).toBe(0);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: [{ organizationId: null }, { organizationId: ORG }] }) }),
    );
  });

  it('asks nothing for no ids', async () => {
    const { prisma, findMany } = db([]);
    expect((await committeeTypeValues(prisma, ORG, [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
