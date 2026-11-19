import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import type { AccessHistoryKind, IAccessHistoryRowDto } from '../../services/user.service';
import { AccessHistoryTextDeps, accessHistoryWhat, accessHistoryWhen } from './access-history-text';

// ACC-216 part 2 — the words of an Access history row, read through the REAL
// en.json and ar.json, so a missing key reads as the key and fails here.

type Tree = Record<string, unknown>;
const lookup = (tree: Tree, key: string): string | undefined => {
  const value = key.split('.').reduce<unknown>((node, k) => (node as Tree | undefined)?.[k], tree);
  return typeof value === 'string' ? value : undefined;
};

function deps(lang: 'en' | 'ar', viewerId: string | null = 'me'): AccessHistoryTextDeps {
  const tree = (lang === 'en' ? en : ar) as Tree;
  return {
    t: (key, params = {}) => {
      const template = lookup(tree, key);
      if (template === undefined) return key;
      return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params[name] ?? ''));
    },
    bilingual: (nameEn, nameAr) => (lang === 'ar' ? nameAr || nameEn : nameEn),
    dateTime: (value) => `<${value}>`,
    viewerId,
  };
}

const row = (kind: AccessHistoryKind, over: Partial<IAccessHistoryRowDto> = {}): IAccessHistoryRowDto => ({
  id: `audit:${kind}`,
  at: '2026-11-10T08:00:00.000Z',
  kind,
  actor: null,
  ...over,
});

const ALL_KINDS: AccessHistoryKind[] = [
  'INVITED',
  'INVITATION_ACCEPTED',
  'INVITATION_REVOKED',
  'PROFILE_EDITED',
  'OUT_OF_OFFICE_CHANGED',
  'TRANSFERRED',
  'HEAD_APPOINTMENT_FAILED',
  'DEACTIVATED',
  'REACTIVATED',
  'ROLE_GRANTED',
  'ROLE_REMOVED',
  'TWO_STEP_TURNED_ON',
  'TWO_STEP_TURNED_OFF',
  'TWO_STEP_RESET',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET',
  'SIGNED_IN_AS',
  'CHANGED',
];

const unit = (id: string, nameEn: string, nameAr: string | null) => ({ id, nameEn, nameAr });

describe('Access history text (ACC-216 part 2)', () => {
  for (const lang of ['en', 'ar'] as const) {
    it(`${lang}: every kind has its own translated sentence, never a key`, () => {
      const sentences = ALL_KINDS.map((kind) => accessHistoryWhat(row(kind), deps(lang)));
      for (const s of sentences) {
        expect(s).not.toContain('userRecord.');
        expect(s.trim().length).toBeGreaterThan(0);
      }
      // Each kind says something different (CHANGED included).
      expect(new Set(sentences).size).toBe(ALL_KINDS.length);
    });
  }

  it('an unknown kind from a newer server reads as the neutral "Changed"', () => {
    expect(accessHistoryWhat(row('SOMETHING_NEW' as AccessHistoryKind), deps('en'))).toBe('Changed');
    expect(accessHistoryWhat(row('SOMETHING_NEW' as AccessHistoryKind), deps('ar'))).toBe('تغيير');
  });

  it('a profile edit names the fields that changed, joined in each language', () => {
    const r = row('PROFILE_EDITED', { fields: ['name', 'position', 'manager'] });
    expect(accessHistoryWhat(r, deps('en'))).toBe('Profile edited: name, position, manager');
    expect(accessHistoryWhat(r, deps('ar'))).toBe('تعديل الملف الشخصي: الاسم، المسمى الوظيفي، المدير');
    expect(accessHistoryWhat(row('PROFILE_EDITED', { fields: [] }), deps('en'))).toBe('Profile saved');
  });

  it('a role is named when the server named it, by hand or with a head position', () => {
    const role = { id: 'r', nameEn: 'Quality Manager', nameAr: 'مدير الجودة' };
    expect(accessHistoryWhat(row('ROLE_GRANTED', { role, viaHeadship: false }), deps('en'))).toBe('Role granted: Quality Manager');
    expect(accessHistoryWhat(row('ROLE_REMOVED', { role, viaHeadship: true }), deps('ar'))).toBe('إزالة دور مع منصب رئاسة: مدير الجودة');
    expect(accessHistoryWhat(row('ROLE_GRANTED', { role: null, viaHeadship: false }), deps('en'))).toBe('A role granted');
    expect(accessHistoryWhat(row('ROLE_REMOVED', { role: null, viaHeadship: true }), deps('en'))).toBe('A role removed with a head position');
  });

  it('a transfer names both units, the position and the head appointment', () => {
    const transfer = {
      from: unit('u1', 'Cardiology', 'القلب'),
      to: unit('u2', 'Internal Medicine', 'الباطنة'),
      position: unit('p', 'Head Nurse', 'رئيس التمريض'),
      headAppointment: 'DONE' as const,
    };
    expect(accessHistoryWhat(row('TRANSFERRED', { transfer }), deps('en'))).toBe(
      'Transferred from Cardiology to Internal Medicine · Head Nurse · appointed head of the unit',
    );
    expect(accessHistoryWhat(row('TRANSFERRED', { transfer: { ...transfer, position: null, headAppointment: 'FAILED' } }), deps('ar'))).toBe(
      'النقل من القلب إلى الباطنة · عدم اكتمال التعيين لرئاسة الوحدة',
    );
    expect(accessHistoryWhat(row('TRANSFERRED', { transfer: { ...transfer, to: null, position: null, headAppointment: 'NONE' } }), deps('en'))).toBe(
      'Transferred from Cardiology to a unit no longer in the organisation',
    );
  });

  it('the second line: the date, then who did it; yourself reads "by you"; nobody named, the date alone', () => {
    const at = '2026-11-10T08:00:00.000Z';
    expect(accessHistoryWhen(row('DEACTIVATED', { actor: { id: 'u-admin', name: 'Ahmad' } }), deps('en'))).toBe(`<${at}> · by Ahmad`);
    expect(accessHistoryWhen(row('DEACTIVATED', { actor: { id: 'u-admin', name: 'Ahmad' } }), deps('ar'))).toBe(`<${at}> · بواسطة Ahmad`);
    expect(accessHistoryWhen(row('PASSWORD_RESET', { actor: { id: 'me', name: 'Me' } }), deps('en'))).toBe(`<${at}> · by you`);
    expect(accessHistoryWhen(row('PASSWORD_RESET', { actor: { id: 'me', name: 'Me' } }), deps('ar'))).toBe(`<${at}> · بواسطتك`);
    expect(accessHistoryWhen(row('SIGNED_IN_AS'), deps('en'))).toBe(`<${at}>`);
  });

  it('Arabic: the organisation is «منشأة», and no sentence addresses or describes a person by gender', () => {
    const tree = (ar as Tree)['userRecord'] as Tree;
    const all = JSON.stringify(tree['accessHistory']);
    expect(all).toContain('المنشأة');
    expect(all).not.toContain('المؤسسة');
    // Feminine-marked verbs or pronouns about the person would read «قامت», «هي», «ـتِ».
    for (const gendered of ['قامت', 'قام ', ' هي ', ' هو ', 'تمّت', 'أنتِ', 'أنتَ']) expect(all).not.toContain(gendered);
  });
});
