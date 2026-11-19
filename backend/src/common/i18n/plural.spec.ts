import { counted } from './plural';

const FORMS = {
  en: { one: 'one:{count}', other: 'other:{count}' },
  ar: { zero: 'zero:{count}', one: 'one:{count}', two: 'two:{count}', few: 'few:{count}', many: 'many:{count}', other: 'other:{count}' },
} as const;

describe('counted() — ACC-95', () => {
  it.each([
    [0, 'zero'],
    [1, 'one'],
    [2, 'two'],
    [3, 'few'],
    [10, 'few'],
    [11, 'many'],
    [99, 'many'],
    [100, 'other'],
    [101, 'other'],
    [102, 'other'], // CLDR: two is exactly 2
    [103, 'few'],
  ])('Arabic %i takes the %s form', (n, category) => {
    expect(counted(n, FORMS).ar).toBe(`${category}:${n}`);
  });

  it.each([
    [0, 'other'],
    [1, 'one'],
    [2, 'other'],
    [11, 'other'],
  ])('English %i takes the %s form', (n, category) => {
    expect(counted(n, FORMS).en).toBe(`${category}:${n}`);
  });

  it('writes the count in Latin digits in both languages, with a thousands separator', () => {
    // 1,234 ends in 34: Arabic many.
    expect(counted(1234, FORMS)).toEqual({ en: 'other:1,234', ar: 'many:1,234' });
  });

  it('returns the form exactly, every {count} replaced and nothing else touched', () => {
    const forms = {
      en: { one: 'A {count} B {count}', other: 'x' },
      ar: { zero: 'z', one: '«{count}» واحد', two: 't', few: 'f', many: 'm', other: 'o' },
    };
    expect(counted(1, forms)).toEqual({ en: 'A 1 B 1', ar: '«1» واحد' });
  });
});
