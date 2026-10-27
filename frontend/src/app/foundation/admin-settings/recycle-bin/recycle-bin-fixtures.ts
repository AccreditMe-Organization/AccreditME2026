import { IRecycleBinItem } from './recycle-bin.service';

// ACC-260, PR D — recycle bin fixtures for the specs and the browser check
// (plan §5): empty, one file, 18 files across record types and deleters, three
// days left or fewer, and the task a refused restore names as gone.
//
// Times are relative to BIN_NOW, which every spec fixes as its clock.

export const BIN_NOW = new Date('2026-10-27T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

export const HESSA = { id: 'u-hessa', name: 'Hessa Al-Dosari' };
export const OMAR = { id: 'u-omar', name: 'Omar Haddad' };
export const DANA = { id: 'u-dana', name: 'Dana Chalabi' };
export const NORA = { id: 'u-nora', name: 'Nora Al-Otaibi' };

/** One file, deleted `daysAgo` days before BIN_NOW. */
export function binItem(over: Partial<IRecycleBinItem> & { daysAgo?: number } = {}): IRecycleBinItem {
  const { daysAgo = 2, ...rest } = over;
  const deletedAt = new Date(BIN_NOW.getTime() - daysAgo * DAY);
  const purgesAt = new Date(deletedAt.getTime() + 30 * DAY);
  return {
    id: 'f-1',
    name: 'Ward 6A observations.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 420_000,
    record: { type: 'TASK', id: 't-1', name: 'Re-audit wards 4B and 6A' },
    deletedBy: OMAR,
    deletedAt: deletedAt.toISOString(),
    purgesAt: purgesAt.toISOString(),
    daysLeft: Math.max(0, Math.ceil((purgesAt.getTime() - BIN_NOW.getTime()) / DAY)),
    ...rest,
  };
}

export const BIN_EMPTY: IRecycleBinItem[] = [];
export const BIN_ONE: IRecycleBinItem[] = [binItem()];

const NAMES = [
  'Audit summary.pdf',
  'Isolation room photo.heic',
  'Old policy draft.doc',
  'Hand hygiene audit.xlsx',
  'Committee slides.pptx',
  'Incident log.csv',
  'Notes.txt',
  'Medication safety review.pdf',
  'Ward round checklist.docx',
  'Fire drill photo.jpg',
  'Training register.xlsx',
  'Sterilisation record.pdf',
  'Infection control plan.docx',
  'Survey results.csv',
  'Lab turnaround.xlsx',
  'Discharge leaflet.pdf',
  'Pharmacy stock.xlsx',
  'Board paper.pdf',
] as const;
const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  heic: 'image/heic',
  jpg: 'image/jpeg',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
};
const BY = [HESSA, OMAR, DANA, NORA];

/**
 * 18 files: deleters cycle Hessa, Omar, Dana, Nora (one with no deleter left);
 * two are from a second record type (not a task) to exercise the filter; ages
 * run 0–28 days, so several have three days left or fewer.
 */
export const BIN_18: IRecycleBinItem[] = NAMES.map((name, i) => {
  const ext = name.slice(name.lastIndexOf('.') + 1);
  return binItem({
    id: `f-${String(i + 1).padStart(2, '0')}`,
    name,
    mimeType: MIME[ext]!,
    sizeBytes: 150_000 + i * 731_000,
    daysAgo: [28, 1, 27, 9, 0.5, 14, 26, 3, 20, 5, 11, 29, 2, 16, 7, 22, 6, 25][i]!,
    record:
      i === 4 || i === 9
        ? { type: 'MEETING', id: `m-${i}`, name: null }
        : { type: 'TASK', id: `t-${i}`, name: `Task ${i + 1}` },
    deletedBy: i === 17 ? null : BY[i % 4]!,
  });
});

/** Two files, one from a task that no longer exists (record.name null). */
export const BIN_WITH_GONE: IRecycleBinItem[] = [
  binItem({ id: 'f-live', name: 'Ward 6A observations.docx' }),
  binItem({ id: 'f-gone', name: 'Old policy draft.doc', mimeType: 'application/msword', record: { type: 'TASK', id: 't-gone', name: null }, daysAgo: 27 }),
];

/** A restore refused because the record is gone: what the API answers. */
export const RECORD_GONE_ERROR = {
  status: 409,
  error: { statusCode: 409, code: 'FILE_RECORD_GONE', message: 'The record this file came from no longer exists' },
};
