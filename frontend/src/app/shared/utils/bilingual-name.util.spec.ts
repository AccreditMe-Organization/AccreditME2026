import { pickBilingualName } from './bilingual-name.util';

describe('pickBilingualName (ACC-160)', () => {
  const EN = 'Quality Committee';
  const AR = 'لجنة الجودة';

  it('shows the Arabic name in an Arabic session', () => {
    expect(pickBilingualName(EN, AR, true)).toBe(AR);
  });

  it('shows the English name in an English session, even when Arabic exists', () => {
    expect(pickBilingualName(EN, AR, false)).toBe(EN);
  });

  // THE RULE. Each of these is a record with no usable Arabic name in an Arabic
  // session; each must show the English name rather than a blank.
  const missing: [string, string | null | undefined][] = [
    ['null', null],
    ['undefined', undefined],
    ["''", ''],
    ['whitespace only', ' \t '],
  ];
  for (const [label, ar] of missing) {
    it(`falls back to English when the Arabic name is ${label}`, () => {
      expect(pickBilingualName(EN, ar, true)).toBe(EN);
    });
  }

  // Display does not rewrite tenant data: padding is part of the emptiness
  // test, not something stripped from what is shown.
  it('returns the Arabic name as stored, not trimmed', () => {
    expect(pickBilingualName(EN, ' لجنة ', true)).toBe(' لجنة ');
  });

  it('never returns an empty string while an English name exists', () => {
    for (const ar of [null, undefined, '', '   ', AR]) {
      for (const arabic of [true, false]) {
        expect(pickBilingualName(EN, ar, arabic)).not.toBe('');
      }
    }
  });
});
