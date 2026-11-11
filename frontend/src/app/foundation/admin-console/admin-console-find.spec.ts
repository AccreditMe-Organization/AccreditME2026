import { foldForFind, markFind, matchesFind } from './admin-console-find';

// ACC-292 — Find a setting's rule, without a page.
describe('admin-console-find (ACC-292)', () => {
  const calendar = {
    texts: ['Working Calendar', 'Working days, hours and holidays used for due dates.', 'التقويم الرسمي'],
    synonyms: ['holiday'],
  };

  it('an empty or blank query keeps everything', () => {
    expect(matchesFind(calendar, '')).toBe(true);
    expect(matchesFind(calendar, '   ')).toBe(true);
  });

  it('matches a name or a line, in either language, ignoring case', () => {
    expect(matchesFind(calendar, 'CALENDAR')).toBe(true);
    expect(matchesFind(calendar, 'due dates')).toBe(true);
    expect(matchesFind(calendar, 'تقويم')).toBe(true);
    expect(matchesFind(calendar, 'smtp')).toBe(false);
  });

  it('matches a synonym', () => {
    expect(matchesFind({ texts: ['Email Provider'], synonyms: ['smtp'] }, 'Smtp')).toBe(true);
  });

  it('folds Arabic marks, the tatweel and the alef forms', () => {
    expect(foldForFind('كلًّا')).toBe('كلا');
    expect(foldForFind('الإدارة')).toBe('الادارة');
    expect(matchesFind({ texts: ['الإدارة'], synonyms: [] }, 'الادارة')).toBe(true);
    expect(matchesFind({ texts: ['مدـير'], synonyms: [] }, 'مدير')).toBe(true);
  });

  describe('markFind', () => {
    it('English: marks exactly the match', () => {
      expect(markFind('Working Calendar', 'calendar')).toEqual([
        { text: 'Working ', mark: false },
        { text: 'Calendar', mark: true },
      ]);
    });

    it('Arabic: marks the whole word, so joined letters are never split', () => {
      expect(markFind('التقويم الرسمي', 'تقويم')).toEqual([
        { text: 'التقويم', mark: true },
        { text: ' الرسمي', mark: false },
      ]);
    });

    it('Arabic: a word ends at punctuation, and its marks come with it', () => {
      expect(markFind('ومن يرأس كلًّا منها.', 'كلا')).toEqual([
        { text: 'ومن يرأس ', mark: false },
        { text: 'كلًّا', mark: true },
        { text: ' منها.', mark: false },
      ]);
    });

    it('returns null when the query is not in this text, or is blank', () => {
      expect(markFind('Working Calendar', 'smtp')).toBeNull();
      expect(markFind('Working Calendar', ' ')).toBeNull();
    });
  });
});
