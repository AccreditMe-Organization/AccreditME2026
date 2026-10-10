/**
 * ACC-189 — an RFC 4180 CSV reader for the viewer's table: quoted fields,
 * doubled quotes, commas and line breaks inside quotes, CRLF or LF, a leading
 * byte-order mark, and rows of different lengths kept as they are. In-house,
 * like ACC-177's content sniffer: one table does not justify a dependency.
 *
 * It stops after `maxRows` rows, so a 25 MB file is never parsed whole, and
 * says whether anything was left. Cells are plain strings; the viewer binds
 * them as text, never as HTML.
 */
export interface IParsedCsv {
  rows: string[][];
  /** True when rows were left unread after `maxRows`. */
  truncated: boolean;
}

export function parseCsv(text: string, maxRows: number): IParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRow = (): void => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
    fieldStarted = false;
  };

  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      fieldStarted = false;
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      endRow();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      if (rows.length >= maxRows) return { rows, truncated: /\S/.test(text.slice(i)) };
      continue;
    }
    field += c;
    fieldStarted = true;
    i++;
  }
  if (fieldStarted || field !== '' || row.length > 0) endRow();
  return { rows, truncated: false };
}
