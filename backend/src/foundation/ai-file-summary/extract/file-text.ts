import { parseCsv } from './csv';
import { decodeText } from './text-decode';
import { PdfTextExtractor } from './pdf-text-extractor';
import { estimateTokens } from '../../ai/token-estimate';

/**
 * ACC-193 — the text a summary reads, from the stored bytes, on the SERVER
 * (decision 4): the browser never sends text.
 *
 * Caps (decision 5, §4.3, §14.2), whichever comes first:
 *   PDF — pages in order, at most 100, and the token budget;
 *   CSV — the header and at most 500 data rows (the viewer's own cap), and the budget;
 *   TXT — from the start, the budget.
 * "Read" counts what was actually sent: whole pages, data rows, or bytes.
 */

export const SUMMARY_PAGE_CAP = 100;
export const SUMMARY_ROW_CAP = 500;
/** Fewer letters than this across everything read is "no readable text" (decision 6). */
export const MIN_LETTERS = 20;

export type SummarizableKind = 'pdf' | 'csv' | 'txt';
export type CoverageUnit = 'pages' | 'rows' | 'text';

const KIND_BY_MIME: Readonly<Record<string, SummarizableKind>> = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/plain': 'txt',
};

/** PDF, TXT and CSV only (decision 3) — the server's type, judged from content at upload. */
export function summarizableKind(mimeType: string): SummarizableKind | null {
  return KIND_BY_MIME[mimeType] ?? null;
}

export const COVERAGE_UNIT: Readonly<Record<SummarizableKind, CoverageUnit>> = { pdf: 'pages', csv: 'rows', txt: 'text' };

export { estimateTokens };

/**
 * NFKC (folds the Arabic presentation forms PDFs often carry), control
 * characters dropped except line breaks and tabs, spaces collapsed within a
 * line, at most one blank line in a row.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n\t]+/g, ' ')
    // Control characters (Unicode Cc), except the line breaks and tabs kept above.
    .replace(/[^\P{Cc}\n\t]/gu, '')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countLetters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

/** The longest prefix whose estimate fits `budget`, cut at a space where one is near; never inside a surrogate pair. */
export function cutToTokens(text: string, budget: number): string {
  if (estimateTokens(text) <= budget) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  let end = lo;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  const space = text.lastIndexOf(' ', end);
  if (space > end * 0.9) end = space;
  return text.slice(0, end).trimEnd();
}

export interface IFileText {
  /** What the model reads: normalised, with a "[page n]" line before each PDF page. */
  text: string;
  unit: CoverageUnit;
  /** Whole pages, data rows, or bytes actually sent. */
  unitsRead: number;
  /** The file's pages, data rows, or bytes. */
  unitsTotal: number;
  /** Letters in `text`: below MIN_LETTERS is "no readable text". */
  letters: number;
}

/**
 * Reads what the summary will send, never more than `budget` tokens by
 * estimateTokens(). Throws PdfUnreadableError / ExtractionBusyError (PDF only).
 */
export async function readFileText(
  kind: SummarizableKind,
  bytes: Uint8Array,
  budget: number,
  pdf: PdfTextExtractor,
  /** One deadline for the slot wait and the PDF read (§14.1). */
  deadline?: number,
): Promise<IFileText> {
  if (kind === 'pdf') return readPdf(bytes, budget, pdf, deadline);
  if (kind === 'csv') return readCsv(bytes, budget);
  return readTxt(bytes, budget);
}

async function readPdf(bytes: Uint8Array, budget: number, pdf: PdfTextExtractor, deadline?: number): Promise<IFileText> {
  const parts: string[] = [];
  let used = 0;
  let pagesRead = 0;
  const { numPages } = await pdf.read(bytes, {
    maxPages: SUMMARY_PAGE_CAP,
    deadline,
    onPage: (n, raw) => {
      const page = `[page ${n}]\n${normalizeText(raw)}`;
      const cost = estimateTokens(page) + 1;
      if (used + cost <= budget) {
        parts.push(page);
        used += cost;
        pagesRead = n;
        return true;
      }
      // Page 1 alone is over the budget: cut it, and it counts as read.
      if (n === 1) {
        parts.push(cutToTokens(page, budget));
        pagesRead = 1;
      }
      return false;
    },
  });
  const text = parts.join('\n');
  return { text, unit: 'pages', unitsRead: pagesRead, unitsTotal: numPages, letters: countLetters(text) };
}

function readCsv(bytes: Uint8Array, budget: number): IFileText {
  const { text: decoded } = decodeText(bytes, bytes.byteLength);
  // The header plus at most 500 data rows (the viewer's own cap), every record counted.
  const parsed = parseCsv(decoded, SUMMARY_ROW_CAP + 1);
  const dataTotal = Math.max(0, parsed.totalRows - 1);
  const lines: string[] = [];
  let used = 0;
  let dataRead = 0;
  for (const [i, row] of parsed.rows.entries()) {
    const line = normalizeText(row.join('\t').replace(/\n/g, ' '));
    const cost = estimateTokens(line) + 1;
    if (used + cost > budget) break;
    lines.push(line);
    used += cost;
    if (i > 0) dataRead += 1;
  }
  const text = lines.join('\n');
  return { text, unit: 'rows', unitsRead: dataRead, unitsTotal: dataTotal, letters: countLetters(text) };
}

function readTxt(bytes: Uint8Array, budget: number): IFileText {
  // estimateTokens() is bytes ÷ 3, so budget × 3 bytes is all the budget can hold.
  const maxBytes = budget * 3;
  const { text: decoded, truncated } = decodeText(bytes, maxBytes);
  const normalized = normalizeText(decoded);
  const text = cutToTokens(normalized, budget);
  // Read in full unless the decoder stopped early or the cut shortened it; a
  // partial read counts the bytes actually sent, always below the total.
  const partial = truncated || text.length < normalized.length;
  const unitsRead = partial ? Math.min(Buffer.byteLength(text, 'utf8'), bytes.byteLength - 1) : bytes.byteLength;
  return { text, unit: 'text', unitsRead, unitsTotal: bytes.byteLength, letters: countLetters(text) };
}
