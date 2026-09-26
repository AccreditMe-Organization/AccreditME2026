import { withArabicLam } from './arabic-prefix.util';

// The names are written as escapes in the assertions' expectations so a reader
// can see WHICH character moved; the inputs are literal so the test reads like
// the screen it protects.
describe('withArabicLam (ACC-120)', () => {
  it('attaches to a name that does not begin with the article', () => {
    // ل + قسم الصيدلة → لقسم الصيدلة, which is what the design's own Arabic
    // artboard draws.
    expect(withArabicLam('قسم الصيدلة')).toBe('لقسم الصيدلة');
  });

  // THE DEFECT. Found in a browser on this dialog's title: the shipped string
  // produced لـالعناية, a preposition standing outside a word it belongs to.
  it('ELIDES the article alif, which is the bug this exists for', () => {
    expect(withArabicLam('العناية المركزة لحديثي الولادة')).toBe(
      'للعناية المركزة لحديثي الولادة',
    );
  });

  it('drops exactly one character, never the whole article', () => {
    const out = withArabicLam('الأشعة');
    expect(out).toBe('للأشعة');
    // لل, not ل or للل — the lam of the article survives.
    expect(out.startsWith('لل')).toBeTrue();
  });

  // nameAr is optional on an org unit, so an Arabic session routinely renders a
  // Latin name. A bare lam there gives "لNeonatal ICU".
  it('keeps the preposition detached for a non-Arabic name', () => {
    expect(withArabicLam('Neonatal ICU')).toBe('لـ Neonatal ICU');
  });

  it('returns nothing for an empty name, not a stray preposition', () => {
    expect(withArabicLam('')).toBe('');
    expect(withArabicLam('   ')).toBe('');
    expect(withArabicLam(null)).toBe('');
    expect(withArabicLam(undefined)).toBe('');
  });

  it('trims, so a padded name does not separate the preposition', () => {
    expect(withArabicLam('  قسم الصيدلة  ')).toBe('لقسم الصيدلة');
  });
});
