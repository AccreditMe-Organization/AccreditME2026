import { decodeText, textLines } from './text-decode';

const utf8 = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('decodeText (ACC-189)', () => {
  it('decodes UTF-8 Arabic and drops a byte-order mark', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('سياسة مكافحة العدوى')]);
    expect(decodeText(bom.buffer as ArrayBuffer)).toEqual({ text: 'سياسة مكافحة العدوى', truncated: false });
  });

  it('decodes only up to the limit and says so', () => {
    expect(decodeText(utf8('abcdef'), 4)).toEqual({ text: 'abcd', truncated: true });
  });

  it('a character cut in half by the limit is dropped, not shown as a replacement mark', () => {
    // "ع" is two bytes in UTF-8; the limit falls between them.
    expect(decodeText(utf8('aع'), 2)).toEqual({ text: 'a', truncated: true });
  });

  it('markup is just characters: <script> and <img onerror> come back as text', () => {
    const text = '<script>alert(1)</script>\n<img src=x onerror=alert(2)>';
    expect(decodeText(utf8(text)).text).toBe(text);
  });
});

describe('textLines (ACC-189)', () => {
  it('splits on CRLF, CR and LF, without an empty last line', () => {
    expect(textLines('one\r\ntwo\rthree\nfour\n')).toEqual(['one', 'two', 'three', 'four']);
  });

  it('keeps blank lines inside the text', () => {
    expect(textLines('a\n\nb')).toEqual(['a', '', 'b']);
  });
});
