import { buildStorageKey, displayFileName, keySafeName } from './stored-file-names';
import { contentDisposition } from '../../providers/storage/content-disposition';

describe('stored file names and keys (ACC-177)', () => {
  describe('displayFileName', () => {
    it('keeps an Arabic name exactly, normalised to NFC', () => {
      expect(displayFileName('محضر اجتماع لجنة الجودة.pdf')).toBe('محضر اجتماع لجنة الجودة.pdf');
      // "é" as e + combining accent becomes the single code point.
      expect(displayFileName('re\u0301sume\u0301.pdf')).toBe('r\u00e9sum\u00e9.pdf');
    });

    it('strips control characters and the bidi overrides that disguise an extension', () => {
      expect(displayFileName('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
      expect(displayFileName('a\u0000b\u0007.txt')).toBe('ab.txt');
    });

    it('turns path separators into underscores, so a name is never a path', () => {
      expect(displayFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
      expect(displayFileName('C:\\temp\\x.pdf')).toBe('C:_temp_x.pdf');
    });

    it('caps the name at 255 characters and keeps the extension', () => {
      const name = displayFileName(`${'ا'.repeat(300)}.pdf`);
      expect(name).toHaveLength(255);
      expect(name.endsWith('.pdf')).toBe(true);
    });

    it('never answers an empty name', () => {
      expect(displayFileName('   ')).toBe('file');
    });
  });

  describe('keySafeName', () => {
    it('is ASCII, keeps the extension, and falls back to "file" for an all-Arabic name', () => {
      expect(keySafeName('محضر الاجتماع.pdf', 'pdf')).toBe('file.pdf');
      expect(keySafeName('Audit sample (ward 3).xlsx', 'xlsx')).toBe('Audit_sample_ward_3.xlsx');
    });

    it('is at most 80 characters', () => {
      expect(keySafeName(`${'a'.repeat(200)}.docx`, 'docx').length).toBeLessThanOrEqual(80);
    });
  });

  describe('buildStorageKey', () => {
    it('is organisation / module / record / random-name', () => {
      const key = buildStorageKey({ organizationId: 'org1', module: 'tasks', recordId: 'task1', safeName: 'a.pdf' });
      expect(key).toMatch(/^org1\/tasks\/task1\/[0-9a-f]{20}-a\.pdf$/);
    });

    it('two uploads of the same file get different keys', () => {
      const parts = { organizationId: 'org1', module: 'tasks', recordId: 'task1', safeName: 'a.pdf' };
      expect(buildStorageKey(parts)).not.toBe(buildStorageKey(parts));
    });

    it.each(['../org2', 'org1/x', '', 'a b'])('refuses an unsafe segment %p', (segment) => {
      expect(() => buildStorageKey({ organizationId: segment, module: 'tasks', recordId: 't', safeName: 'a.pdf' })).toThrow();
    });
  });

  describe('contentDisposition (RFC 5987)', () => {
    it('carries the Arabic name as UTF-8 and an ASCII fallback', () => {
      const header = contentDisposition('محضر.pdf');
      expect(header).toBe(`attachment; filename="file.pdf"; filename*=UTF-8''${encodeURIComponent('محضر')}.pdf`);
      expect(decodeURIComponent(header.split("UTF-8''")[1]!)).toBe('محضر.pdf');
    });

    it('cannot be broken out of by a quote or a backslash', () => {
      const header = contentDisposition('a"b\\c.pdf');
      expect(header.startsWith('attachment; filename="abc.pdf";')).toBe(true);
      expect(header).toContain("filename*=UTF-8''a%22b%5Cc.pdf");
    });
  });
});
