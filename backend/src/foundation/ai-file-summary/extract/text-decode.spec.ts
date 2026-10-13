import { decodeText } from './text-decode';

// ACC-193 — the frontend's own cases (frontend/src/app/shared/files/viewer/text-decode.spec.ts),
// run against this copy.
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('decodeText — the backend copy (ACC-193)', () => {
  it('decodes UTF-8 Arabic and drops a byte-order mark', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('سياسة مكافحة العدوى')]);
    expect(decodeText(bom, 1024 * 1024)).toEqual({ text: 'سياسة مكافحة العدوى', truncated: false });
  });

  it('decodes only up to the limit and says so', () => {
    expect(decodeText(utf8('abcdef'), 4)).toEqual({ text: 'abcd', truncated: true });
  });

  it('a character cut in half by the limit is dropped, not shown as a replacement mark', () => {
    expect(decodeText(utf8('aع'), 2)).toEqual({ text: 'a', truncated: true });
  });

  it('markup is just characters', () => {
    const text = '<script>alert(1)</script>\n<img src=x onerror=alert(2)>';
    expect(decodeText(utf8(text), 1024 * 1024).text).toBe(text);
  });

  it('bytes that are not UTF-8 become U+FFFD rather than failing', () => {
    expect(decodeText(new Uint8Array([0x61, 0xff, 0x62]), 10).text).toBe('a�b');
  });
});
