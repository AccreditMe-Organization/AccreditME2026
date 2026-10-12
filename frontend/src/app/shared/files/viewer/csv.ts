/**
 * ACC-189 — an RFC 4180 CSV reader for the viewer's table: quoted fields,
 * doubled quotes, commas and line breaks inside quotes, CRLF or LF, a leading
 * byte-order mark, and rows of different lengths kept as they are. In-house,
 * like ACC-177's content sniffer: one table does not justify a dependency.
 *
 * It KEEPS at most `maxRows` rows, so a 25 MB file never becomes millions of
 * strings, and COUNTS every record, so the viewer can say "500 of 2,140".
 * Cells are plain strings; the viewer binds them as text, never as HTML.
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
