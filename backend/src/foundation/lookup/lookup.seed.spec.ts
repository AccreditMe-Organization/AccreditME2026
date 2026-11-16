import { SYSTEM_LOOKUP_SEED } from './lookup.seed';

// ACC-310 — every attribute in every seeded attributeSchema carries its name in
// both languages, so a future attribute cannot ship English-only. The value form
// shows them through bilingual(); seedSystemData() rewrites the shared schemas
// on every deploy, so this is all an existing organisation needs.

const ARABIC = /[؀-ۿ]/;

interface AttributeDef {
  type?: unknown;
  labelEn?: unknown;
  labelAr?: unknown;
}

function attributes(): { category: string; key: string; def: AttributeDef }[] {
  return SYSTEM_LOOKUP_SEED.flatMap((category) => {
    const properties = (category.attributeSchema?.['properties'] ??
      {}) as Record<string, AttributeDef>;
    return Object.entries(properties).map(([key, def]) => ({
      category: category.key,
      key,
      def,
    }));
  });
}

describe('SYSTEM_LOOKUP_SEED attribute names (ACC-310)', () => {
  it('has attributes to check (the assertions below are not vacuous)', () => {
    // Today: committee_member_role.required and document_type's five.
    expect(attributes().length).toBeGreaterThanOrEqual(6);
    expect(attributes().map((a) => `${a.category}.${a.key}`)).toEqual(
      expect.arrayContaining([
        'committee_member_role.required',
        'document_type.numberingPrefix',
      ]),
    );
  });

  it.each(attributes().map((a) => [`${a.category}.${a.key}`, a.def] as const))(
    '%s has a non-empty labelEn and an Arabic labelAr',
    (_name, def) => {
      expect(typeof def.labelEn).toBe('string');
      expect((def.labelEn as string).trim()).not.toBe('');
      expect(typeof def.labelAr).toBe('string');
      expect((def.labelAr as string).trim()).not.toBe('');
      expect(def.labelAr as string).toMatch(ARABIC);
    },
  );

  it('keeps the old `label` on Required seat until the form stops reading it', () => {
    const roles = SYSTEM_LOOKUP_SEED.find(
      (c) => c.key === 'committee_member_role',
    );
    const required = (
      roles?.attributeSchema?.['properties'] as Record<
        string,
        Record<string, unknown>
      >
    )['required'];
    expect(required).toEqual({
      type: 'boolean',
      label: 'Required seat',
      labelEn: 'Required seat',
      labelAr: 'مقعد مطلوب',
    });
  });
});
