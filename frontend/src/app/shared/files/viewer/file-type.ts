/**
 * ACC-189 — how a file's type is NAMED in the viewer and its lists: the type
 * label in "PDF · 2.4 MB", the badge in the type icon, and which "no preview
 * yet" sentence a download-only type gets. Product names (Word, Excel,
 * PowerPoint) and format names (PDF, JPEG, HEIC) are not translated.
 */
export type NoPreviewFamily = 'word' | 'excel' | 'powerpoint' | 'photo' | 'other';

export interface IFileType {
  /** "PDF", "JPEG", "Word" — the run before the size. */
  label: string;
  /** The type icon's letters: PDF, IMG, TXT, CSV, DOC, XLS, PPT, FILE. */
  badge: string;
  family: NoPreviewFamily;
}

const TYPES: Readonly<Record<string, IFileType>> = {
  'application/pdf': { label: 'PDF', badge: 'PDF', family: 'other' },
  'image/png': { label: 'PNG', badge: 'IMG', family: 'other' },
  'image/jpeg': { label: 'JPEG', badge: 'IMG', family: 'other' },
  'image/gif': { label: 'GIF', badge: 'IMG', family: 'other' },
  'image/webp': { label: 'WEBP', badge: 'IMG', family: 'other' },
  'image/heic': { label: 'HEIC', badge: 'IMG', family: 'photo' },
  'image/heif': { label: 'HEIF', badge: 'IMG', family: 'photo' },
  'text/plain': { label: 'TXT', badge: 'TXT', family: 'other' },
  'text/csv': { label: 'CSV', badge: 'CSV', family: 'other' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { label: 'Word', badge: 'DOC', family: 'word' },
  'application/msword': { label: 'Word', badge: 'DOC', family: 'word' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { label: 'Excel', badge: 'XLS', family: 'excel' },
  'application/vnd.ms-excel': { label: 'Excel', badge: 'XLS', family: 'excel' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { label: 'PowerPoint', badge: 'PPT', family: 'powerpoint' },
  'application/vnd.ms-powerpoint': { label: 'PowerPoint', badge: 'PPT', family: 'powerpoint' },
};

export function fileTypeOf(mimeType: string): IFileType {
  return TYPES[mimeType] ?? { label: 'FILE', badge: 'FILE', family: 'other' };
}

/**
 * The drawing's middle truncation: a long name keeps its END visible — the
 * extension and the version are what tell files apart. The head shrinks with
 * an ellipsis; the tail never does. The full name stays the tooltip and the
 * dialog's accessible name.
 */
export function splitName(name: string): { head: string; tail: string } {
  if (name.length <= 34) return { head: name, tail: '' };
  const dot = name.lastIndexOf('.');
  const cut = Math.max((dot > 0 ? dot : name.length) - 10, 0);
  return cut > 0 ? { head: name.slice(0, cut), tail: name.slice(cut) } : { head: name, tail: '' };
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG = /[A-Za-zÀ-ɏ֐-ࣿיִ-﷿ﹰ-﻿]/;

/**
 * A name's own direction, from its first strong character: an Arabic name
 * reads right to left and a Latin one left to right, in either interface
 * language. Both halves of a truncated name take it, so they read as one.
 */
export function textDirection(text: string): 'rtl' | 'ltr' {
  const first = STRONG.exec(text)?.[0];
  return first && RTL.test(first) ? 'rtl' : 'ltr';
}
