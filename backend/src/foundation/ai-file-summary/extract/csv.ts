/**
 * ACC-193 — a COPY of the viewer's RFC 4180 reader,
 * frontend/src/app/shared/files/viewer/csv.ts (ACC-189), so the summary reads
 * a CSV exactly as the reader sees it. The frontend file is the original; a
 * change there is copied here, and csv.spec.ts runs the frontend's own cases
 * against this copy so the two cannot drift silently. No shared package exists
 * between the two apps, and 88 lines do not justify one.
 *
 * It KEEPS at most `maxRows` rows and COUNTS every record ("500 of 2,140").
 */
export interface IParsedCsv {
  rows: string[][];
  /** Every record in the file, kept or not. */
  totalRows: number;
  /** True when records were left out after `maxRows`. */
  truncated: boolean;
}

export function parseCsv(text: string, maxRows: number): IParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;
  let rowHasContent = false;
  let total = 0;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const keeping = (): boolean => rows.length < maxRows;
  const endField = (): void => {
    if (keeping()) row.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRow = (): void => {
    endField();
    total++;
    if (keeping()) rows.push(row);
    row = [];
    rowHasContent = false;
  };
  const append = (c: string): void => {
    if (keeping()) field += c;
    rowHasContent = true;
  };

  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          append('"');
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      append(c);
      i++;
      continue;
    }
    if (c === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      rowHasContent = true;
      i++;
      continue;
    }
    if (c === ',') {
      endField();
      rowHasContent = true;
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      endRow();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    append(c);
    fieldStarted = true;
    i++;
  }
  if (rowHasContent || fieldStarted) endRow();
  return { rows, totalRows: total, truncated: total > rows.length };
}
