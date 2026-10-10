import { Observable } from 'rxjs';
import { IFileDownload } from '../files.service';

/**
 * ACC-189 — the in-app file viewer's contract. A HOST (task evidence today;
 * meetings and documents later) owns its list, its permissions and its mints;
 * the viewer owns everything about showing the bytes. A host passes only real
 * files — links and notes are never in `files`, so "n / total" counts files.
 */
export interface IViewableFile {
  id: string;
  name: string;
  /** The SERVER's type, judged from content at upload. Nothing the browser guesses. */
  mimeType: string;
  sizeBytes: number;
}

export interface IFileViewerRequest {
  files: readonly IViewableFile[];
  startIndex: number;
  /**
   * The "From …" line under the file name, as a translation key and its
   * parameters, so it follows a language switch while the viewer is open.
   */
  context: { key: string; params?: Record<string, unknown> };
  /** The host's VIEW mint — the same entitlement as its download. */
  access: (file: IViewableFile) => Observable<IFileDownload>;
  /** The host's existing download. */
  download: (file: IViewableFile) => void;
  /**
   * Called with the file last SHOWN when the viewer closes, so the host can
   * return focus to that row — not to the one the viewer was opened from.
   */
  closed?: (lastShown: IViewableFile) => void;
}

/** Which renderer a file gets. Anything not listed is download only (ACC-192). */
export type PreviewKind = 'pdf' | 'image' | 'text' | 'csv' | 'none';

/**
 * Mirrors the backend's PREVIEWABLE_MIME_TYPES (file-content.ts). The backend
 * list is the one that decides — a view mint for anything else is refused
 * 409 PREVIEW_NOT_AVAILABLE — so a type missing here only costs a request.
 */
const KIND_BY_MIME_TYPE: Readonly<Record<string, PreviewKind>> = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'text/plain': 'text',
  'text/csv': 'csv',
};

export function previewKindFor(mimeType: string): PreviewKind {
  return KIND_BY_MIME_TYPE[mimeType] ?? 'none';
}

/**
 * Why a file could not be shown. Each is its own state with its own words,
 * never the generic one:
 * - `deleted` — the file or its evidence was deleted; no Download either.
 * - `withdrawn` — the organisation's SharePoint access was withdrawn; no Download.
 * - `noPreview` — a type the viewer does not render yet; Download offered.
 * - `storageBlocked` — the organisation's own storage refused the browser's
 *   cross-origin fetch (a MinIO CORS policy, D3); Download offered.
 * - `failed` — anything else; Download offered.
 */
export type FileViewProblem = 'deleted' | 'withdrawn' | 'noPreview' | 'storageBlocked' | 'failed';

export class FileViewError extends Error {
  constructor(
    readonly problem: FileViewProblem,
    readonly status: number | null = null,
  ) {
    super(problem);
    this.name = 'FileViewError';
  }
}

/** Download stays available in every state except these two (the drawing). */
export function downloadAllowed(problem: FileViewProblem | null): boolean {
  return problem !== 'deleted' && problem !== 'withdrawn';
}
