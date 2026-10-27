import { IRecycleBinItem } from './recycle-bin.service';

// ACC-260, PR D — the recycle bin's rules as pure functions, so the page renders
// them and the specs can pin them without a component.

/** A file's type as the list names it ("PDF", "Word"…): a key under recycleBin.kind. */
export type FileKind = 'pdf' | 'word' | 'excel' | 'powerpoint' | 'csv' | 'text' | 'image' | 'file';

const BY_EXTENSION: Readonly<Record<string, FileKind>> = {
  pdf: 'pdf',
  doc: 'word',
  docx: 'word',
  xls: 'excel',
  xlsx: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  csv: 'csv',
  txt: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
};

/** The type from the stored MIME type, then the name's extension (the upload allow-list). */
export function fileKind(item: Pick<IRecycleBinItem, 'name' | 'mimeType'>): FileKind {
  const mime = item.mimeType.toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'text/csv') return 'csv';
  if (mime === 'text/plain') return 'text';
  const dot = item.name.lastIndexOf('.');
  const ext = dot > 0 ? item.name.slice(dot + 1).toLowerCase() : '';
  return BY_EXTENSION[ext] ?? 'file';
}

/**
 * Whether the record a file came from no longer exists, so it cannot be
 * restored. Two ways to know:
 * - a restore was refused FILE_RECORD_GONE this session (`goneIds`);
 * - a TASK file whose `record.name` is null: the API reads every task's title
 *   in one scoped query, so a null title means the task is not there (code
 *   over plan: the plan's G8 said gone could only be known after a refusal).
 */
export function isRecordGone(item: IRecycleBinItem, goneIds: ReadonlySet<string>): boolean {
  return goneIds.has(item.id) || (item.record.type === 'TASK' && item.record.name === null);
}

/** Days left at which the value turns amber (design: three or fewer). */
export const DAYS_LEFT_WARN = 3;

/** The "Deleted" filter's bands, by how long ago: no calendar day, so no zone. */
export const DELETED_BANDS = ['day', 'week', 'older'] as const;
export type DeletedBand = (typeof DELETED_BANDS)[number];

const HOUR_MS = 60 * 60 * 1000;

export function deletedBand(item: Pick<IRecycleBinItem, 'deletedAt'>, now: Date): DeletedBand {
  const ago = now.getTime() - new Date(item.deletedAt).getTime();
  if (ago <= 24 * HOUR_MS) return 'day';
  if (ago <= 7 * 24 * HOUR_MS) return 'week';
  return 'older';
}

/** The three filters, as the list carries them (null: not filtered). */
export interface BinFilters {
  recordType: string | null;
  deletedBy: string | null;
  deleted: string | null;
}

/** "Unknown" in the Deleted by filter: a file whose deleter's account is gone. */
export const DELETED_BY_NOBODY = '__none__';

export function matchesFilters(item: IRecycleBinItem, filters: BinFilters, now: Date): boolean {
  if (filters.recordType && item.record.type !== filters.recordType) return false;
  if (filters.deletedBy) {
    const by = item.deletedBy?.id ?? DELETED_BY_NOBODY;
    if (by !== filters.deletedBy) return false;
  }
  if (filters.deleted && deletedBand(item, now) !== filters.deleted) return false;
  return true;
}

/** Count and total size, for the header, the bulk bar and the dialogs. */
export function totals(items: readonly IRecycleBinItem[]): { count: number; bytes: number } {
  return { count: items.length, bytes: items.reduce((sum, i) => sum + i.sizeBytes, 0) };
}

/** Who deleted files in the bin, once each, by name (the Deleted by options). */
export function deleters(items: readonly IRecycleBinItem[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const i of items) if (i.deletedBy) seen.set(i.deletedBy.id, i.deletedBy.name);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The record types present, in a fixed order (the Record type options). */
export function recordTypes(items: readonly IRecycleBinItem[]): string[] {
  return [...new Set(items.map((i) => i.record.type))].sort();
}

/**
 * Sort comparators by column, ascending. Days left breaks ties by the purge
 * time, then the name, so "soonest to expire first" is a total order.
 */
export function comparators(
  locale: string,
  fromText: (item: IRecycleBinItem) => string,
): Record<string, (a: IRecycleBinItem, b: IRecycleBinItem) => number> {
  const text = (a: string, b: string): number => a.localeCompare(b, locale);
  return {
    name: (a, b) => text(a.name, b.name),
    from: (a, b) => text(fromText(a), fromText(b)),
    deletedBy: (a, b) => text(a.deletedBy?.name ?? '', b.deletedBy?.name ?? ''),
    deletedAt: (a, b) => a.deletedAt.localeCompare(b.deletedAt),
    daysLeft: (a, b) => a.daysLeft - b.daysLeft || a.purgesAt.localeCompare(b.purgesAt) || text(a.name, b.name),
  };
}
