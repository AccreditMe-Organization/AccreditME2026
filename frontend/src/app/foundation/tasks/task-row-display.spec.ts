import { taskRecordHref } from './task-row-display';

// ACC-120 — a task row links its record when the record has a page and the
// server named it. The name is the server's "may open" (committees:view, or
// an active member of the committee, ACC-281); no permission is read here.

describe('taskRecordHref (ACC-120)', () => {
  it('links a named committee to its page', () => {
    expect(taskRecordHref({ type: 'COMMITTEE', id: 'c-9', nameEn: 'Infection Prevention & Control', nameAr: null })).toEqual([
      '/committees',
      'c-9',
    ]);
  });

  it('does not link a committee the server left unnamed', () => {
    expect(taskRecordHref({ type: 'COMMITTEE', id: 'c-9', nameEn: null, nameAr: null })).toBeNull();
  });

  it('does not link a meeting, which has no page yet', () => {
    expect(taskRecordHref({ type: 'MEETING', id: 'm-1', nameEn: 'Board meeting', nameAr: null })).toBeNull();
  });
});
