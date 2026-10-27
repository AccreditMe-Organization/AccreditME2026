import { BIN_18, BIN_NOW, OMAR, binItem } from './recycle-bin-fixtures';
import { comparators, deletedBand, deleters, fileKind, isRecordGone, matchesFilters, recordTypes, totals } from './recycle-bin-view';

// ACC-260, PR D — the recycle bin's rules, pinned without a component.

describe('recycle bin rules (ACC-260, PR D)', () => {
  it('names a file by its type, from the MIME type first, then the extension', () => {
    expect(fileKind({ name: 'a.pdf', mimeType: 'application/pdf' })).toBe('pdf');
    expect(fileKind({ name: 'a.heic', mimeType: 'image/heic' })).toBe('image');
    expect(fileKind({ name: 'a.csv', mimeType: 'text/csv' })).toBe('csv');
    expect(fileKind({ name: 'a.txt', mimeType: 'text/plain' })).toBe('text');
    expect(fileKind({ name: 'a.DOCX', mimeType: 'application/octet-stream' })).toBe('word');
    expect(fileKind({ name: 'a.xls', mimeType: 'application/vnd.ms-excel' })).toBe('excel');
    expect(fileKind({ name: 'a.pptx', mimeType: 'x' })).toBe('powerpoint');
    expect(fileKind({ name: 'README', mimeType: 'x' })).toBe('file');
  });

  it('a record is gone after FILE_RECORD_GONE, or when a task file has no task name', () => {
    const live = binItem();
    expect(isRecordGone(live, new Set())).toBeFalse();
    expect(isRecordGone(live, new Set([live.id]))).toBeTrue();
    expect(isRecordGone(binItem({ record: { type: 'TASK', id: 't', name: null } }), new Set())).toBeTrue();
    // Another record type with no name is not judged gone: its name is never read.
    expect(isRecordGone(binItem({ record: { type: 'MEETING', id: 'm', name: null } }), new Set())).toBeFalse();
  });

  it('the Deleted bands: the last 24 hours, the last 7 days, older', () => {
    expect(deletedBand(binItem({ daysAgo: 0.2 }), BIN_NOW)).toBe('day');
    expect(deletedBand(binItem({ daysAgo: 1 }), BIN_NOW)).toBe('day');
    expect(deletedBand(binItem({ daysAgo: 1.01 }), BIN_NOW)).toBe('week');
    expect(deletedBand(binItem({ daysAgo: 7 }), BIN_NOW)).toBe('week');
    expect(deletedBand(binItem({ daysAgo: 7.5 }), BIN_NOW)).toBe('older');
  });

  it('every filter must match, and "Unknown" is the files with no deleter left', () => {
    const none = { recordType: null, deletedBy: null, deleted: null };
    expect(BIN_18.filter((i) => matchesFilters(i, none, BIN_NOW)).length).toBe(18);
    expect(BIN_18.filter((i) => matchesFilters(i, { ...none, deletedBy: OMAR.id, deleted: 'week' }, BIN_NOW)).map((i) => i.id)).toEqual(['f-10']);
    expect(BIN_18.filter((i) => matchesFilters(i, { ...none, deletedBy: '__none__' }, BIN_NOW)).map((i) => i.id)).toEqual(['f-18']);
  });

  it('totals, the deleters by name and the record types', () => {
    expect(totals([binItem({ sizeBytes: 100 }), binItem({ sizeBytes: 250 })])).toEqual({ count: 2, bytes: 350 });
    expect(deleters(BIN_18).map((d) => d.name)).toEqual(['Dana Chalabi', 'Hessa Al-Dosari', 'Nora Al-Otaibi', 'Omar Haddad']);
    expect(recordTypes(BIN_18)).toEqual(['MEETING', 'TASK']);
  });

  it('Days left sorts by days, then the purge time, then the name: a total order', () => {
    const c = comparators('en', () => '');
    const a = binItem({ id: 'a', name: 'B', daysAgo: 5 });
    const b = binItem({ id: 'b', name: 'A', daysAgo: 5 });
    const later = binItem({ id: 'c', name: 'C', daysAgo: 4.5 });
    expect([a, later, b].sort(c['daysLeft']).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
});
