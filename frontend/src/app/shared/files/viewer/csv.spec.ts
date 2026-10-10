import { parseCsv } from './csv';

describe('parseCsv (ACC-189)', () => {
  it('reads plain rows, CRLF or LF', () => {
    expect(parseCsv('a,b\r\nc,d\ne,f', 10)).toEqual({ rows: [['a', 'b'], ['c', 'd'], ['e', 'f']], totalRows: 3, truncated: false });
  });

  it('reads quoted fields with commas, doubled quotes and line breaks inside', () => {
    const text = '"name","note"\r\n"Al-Dosari, Hessa","said ""yes""\nthen left"\r\n';
    expect(parseCsv(text, 10).rows).toEqual([
      ['name', 'note'],
      ['Al-Dosari, Hessa', 'said "yes"\nthen left'],
    ]);
  });

  it('drops a leading byte-order mark and keeps Arabic', () => {
    expect(parseCsv('﻿الاسم,الوحدة\nهيا,الاعتماد', 10).rows).toEqual([
      ['الاسم', 'الوحدة'],
      ['هيا', 'الاعتماد'],
    ]);
  });

  it('keeps ragged rows and empty fields as they are', () => {
    expect(parseCsv('a,b,c\nd\n,,\n', 10).rows).toEqual([['a', 'b', 'c'], ['d'], ['', '', '']]);
  });

  it('a quote inside an unquoted field is a literal character', () => {
    expect(parseCsv('5" pipe,x', 10).rows).toEqual([['5" pipe', 'x']]);
  });

  it('keeps only the cap, counts every record, and says rows were left', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `row${i},"quoted\n${i}"`).join('\r\n');
    const parsed = parseCsv(text, 500);
    expect(parsed.rows.length).toBe(500);
    expect(parsed.rows[499]).toEqual(['row499', 'quoted\n499']);
    // A line break inside quotes is not a record boundary, past the cap too.
    expect(parsed.totalRows).toBe(2000);
    expect(parsed.truncated).toBeTrue();
  });

  it('exactly the cap, with only a trailing newline after it, is not truncated', () => {
    const text = Array.from({ length: 3 }, (_, i) => `r${i}`).join('\n') + '\n';
    expect(parseCsv(text, 3)).toEqual({ rows: [['r0'], ['r1'], ['r2']], totalRows: 3, truncated: false });
  });

  it('cells are text: markup stays literal', () => {
    expect(parseCsv('<img src=x onerror=alert(1)>,<script>x</script>', 5).rows[0]).toEqual([
      '<img src=x onerror=alert(1)>',
      '<script>x</script>',
    ]);
  });
});
