import bidiFactory from 'bidi-js';

/**
 * ACC-224 — a PDF page's text, in reading order.
 *
 * pdf-text.worker.mjs sends a page's text items with their positions; this
 * builds the text the model reads. Most PDFs store text in reading order and
 * come out exactly as before ACC-224: each item's text, then a line break
 * after an end-of-line item and a space after any other.
 *
 * Some generators — Chrome among them — store a right-to-left line in VISUAL
 * order: left to right on the page, often one glyph per item, with word spaces
 * as separate items. Read as stored, Arabic comes out backwards and spaced
 * letter by letter. Such a line is rebuilt in visual order and put back into
 * reading order with the Unicode Bidirectional Algorithm (UAX #9), which keeps
 * numbers, codes and Latin words inside it the right way round ("95%", "IPC-07").
 *
 * Plan: backend/Plans/step-224-arabic-pdf-order.md (§2, §3).
 */

/** One pdfjs text item, as the worker sends it. */
export interface IPdfTextItem {
  /** The item's text. pdfjs has already put it in reading order WITHIN the item. */
  s: string;
  /** pdfjs's own direction for the item. */
  rtl: boolean;
  /** Left edge and baseline, in page units. */
  x: number;
  y: number;
  /** Width, in page units. */
  w: number;
  /** Font size, in page units. */
  size: number;
  /** The item ends a line. */
  eol: boolean;
}

/**
 * A horizontal gap wider than this, in ems, is a word space (§2.3). Measured
 * on Chrome's Arabic output: 0.000–0.001 em between glyphs of one word, 0.278
 * em across a space.
 */
export const WORD_GAP_EM = 0.15;

/** A baseline jump of more than this, in ems, starts a new line even with no end-of-line mark. */
const LINE_JUMP_EM = 0.5;

const RTL_LETTER = /(?=\p{L})(?:\p{Script=Arabic}|\p{Script=Hebrew})/u;
const RTL_LETTERS = /(?=\p{L})(?:\p{Script=Arabic}|\p{Script=Hebrew})/gu;
const OTHER_LETTERS = /(?!\p{Script=Arabic}|\p{Script=Hebrew})\p{L}/gu;
const MARKS_ONLY = /^\s*\p{M}+\s*$/u;
const SPACE_ONLY = /^\s+$/;

/**
 * Q1 (Ahmad, 13 Oct): Chrome maps the yeh and heh glyphs to PERSIAN forms,
 * which NFKC turns into ی and ھ. The glyphs are drawn the same as Arabic's,
 * so in a reordered line they are folded back to the Arabic letters.
 */
const PERSIAN_YEH = /[ﯾﯿ]/g;
const PERSIAN_HEH = /[ﮬﮭھ]/g;

type Direction = 'ltr' | 'rtl';

const bidi = bidiFactory();

function countOf(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

/** The text exactly as before ACC-224. */
function asStored(line: readonly IPdfTextItem[]): string {
  let text = '';
  for (const item of line) text += item.s + (item.eol ? '\n' : ' ');
  return text;
}

/**
 * Stored in visual order: the line has right-to-left letters, and its
 * right-to-left items run rightwards (more steps to a larger x than to a
 * smaller one). Word and most generators run them leftwards, and a line pdfjs
 * returns as one item has no pair to compare: both are left as they are.
 */
export function isVisualOrderLine(line: readonly IPdfTextItem[]): boolean {
  const rtl = line.filter((item) => RTL_LETTER.test(item.s));
  let rightwards = 0;
  let leftwards = 0;
  for (let k = 1; k < rtl.length; k++) {
    const dx = rtl[k]!.x - rtl[k - 1]!.x;
    if (dx > 0.01) rightwards++;
    else if (dx < -0.01) leftwards++;
  }
  return rightwards > leftwards;
}

/** Right-to-left wins a tie (§3). */
function majority(text: string, tie: Direction): Direction {
  const rtl = countOf(text, RTL_LETTERS);
  const other = countOf(text, OTHER_LETTERS);
  return rtl > other ? 'rtl' : other > rtl ? 'ltr' : tie;
}

/** An item's own text in visual order: the inverse of what pdfjs did to it. */
function visualOf(item: Pick<IPdfTextItem, 's' | 'rtl'>): string {
  if (!item.rtl) return item.s;
  return bidi.getReorderedString(item.s, bidi.getEmbeddingLevels(item.s, 'rtl'));
}

interface IPlacedItem {
  s: string;
  rtl: boolean;
  x: number;
  w: number;
  size: number;
}

/** A visual-order line in reading order (§2.3). */
function reorderLine(line: readonly IPdfTextItem[], pageDirection: Direction): string {
  const glyphs: IPlacedItem[] = [];
  const marks: IPlacedItem[] = [];
  for (const item of line) {
    if (item.s === '') continue;
    const placed = { s: item.s, rtl: item.rtl, x: item.x, w: item.w, size: item.size };
    (MARKS_ONLY.test(item.s) ? marks : glyphs).push(placed);
  }
  const bases = glyphs.filter((g) => !SPACE_ONLY.test(g.s));
  // A mark drawn as its own item (Chrome's tanween) joins the glyph it sits over.
  for (const mark of marks) {
    const base =
      bases.find((b) => mark.x >= b.x - 0.5 && mark.x <= b.x + b.w + 0.5) ??
      bases.reduce<IPlacedItem | undefined>((best, b) => (!best || Math.abs(b.x - mark.x) < Math.abs(best.x - mark.x) ? b : best), undefined);
    if (base) base.s += mark.s.trim();
  }

  glyphs.sort((a, b) => a.x - b.x);
  let visual = '';
  let previous: IPlacedItem | undefined;
  for (const item of glyphs) {
    if (SPACE_ONLY.test(item.s)) {
      if (!visual.endsWith(' ')) visual += ' ';
      continue;
    }
    const gap = previous ? item.x - (previous.x + previous.w) : 0;
    if (previous && !visual.endsWith(' ') && gap > WORD_GAP_EM * Math.max(item.size, previous.size)) visual += ' ';
    visual += visualOf(item);
    previous = item;
  }

  const direction = majority(visual, pageDirection);
  const reading = bidi.getReorderedString(visual, bidi.getEmbeddingLevels(visual, direction));
  return (
    reading
      // The algorithm works on UTF-16 units: put back a surrogate pair it reversed.
      .replace(/([\uDC00-\uDFFF])([\uD800-\uDBFF])/g, '$2$1')
      .replace(PERSIAN_YEH, 'ي')
      .replace(PERSIAN_HEH, 'ه')
  );
}

function lineText(line: readonly IPdfTextItem[], pageDirection: Direction): string {
  if (line.length === 0) return '';
  if (!isVisualOrderLine(line)) return asStored(line);
  return reorderLine(line, pageDirection) + (line[line.length - 1]!.eol ? '\n' : ' ');
}

/**
 * The page's text. Lines end where pdfjs marks an end of line, or where the
 * baseline jumps by more than half the font size. Only a visual-order line is
 * rebuilt; every other line is exactly as stored.
 */
export function pageText(items: readonly IPdfTextItem[]): string {
  const pageDirection = majority(items.map((item) => item.s).join(''), 'rtl');
  let text = '';
  let line: IPdfTextItem[] = [];
  let lastPlaced: IPdfTextItem | undefined;
  for (const item of items) {
    if (item.s !== '' && lastPlaced && Math.abs(item.y - lastPlaced.y) > LINE_JUMP_EM * Math.max(item.size, lastPlaced.size, 1)) {
      text += lineText(line, pageDirection);
      line = [];
    }
    line.push(item);
    if (item.s !== '') lastPlaced = item;
    if (item.eol) {
      text += lineText(line, pageDirection);
      line = [];
      lastPlaced = undefined;
    }
  }
  return text + lineText(line, pageDirection);
}
