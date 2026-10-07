import { ALLOWED_EXTENSIONS, judgeFileContent } from './file-content';

// ACC-177 — the extension must be on the list AND the content must be that
// kind of file. Each fixture is the real signature of its type.

// A minimal ZIP holding the given entry names (stored, empty bodies): enough
// for the central directory the OOXML check reads.
function zip(names: string[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const heic = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`), Buffer.alloc(8)]);

describe('judgeFileContent (ACC-177)', () => {
  it.each([
    ['report.pdf', Buffer.from('%PDF-1.7\n...'), 'application/pdf'],
    ['minutes.docx', zip(['[Content_Types].xml', 'word/document.xml']), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['kpis.xlsx', zip(['[Content_Types].xml', 'xl/workbook.xml']), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['deck.pptx', zip(['[Content_Types].xml', 'ppt/presentation.xml']), 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['legacy.doc', CFB, 'application/msword'],
    ['legacy.xls', CFB, 'application/vnd.ms-excel'],
    ['legacy.ppt', CFB, 'application/vnd.ms-powerpoint'],
    ['sample.csv', Buffer.from('ward,count\n3,12\n'), 'text/csv'],
    ['notes.txt', Buffer.from('ملاحظات الزيارة'), 'text/plain'],
    ['export.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a,b\n', 'utf16le')]), 'text/csv'],
    ['photo.png', PNG, 'image/png'],
    ['photo.JPG', JPEG, 'image/jpeg'],
    ['photo.jpeg', JPEG, 'image/jpeg'],
    ['anim.gif', Buffer.from('GIF89a....'), 'image/gif'],
    ['photo.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]), 'image/webp'],
    ['iphone.heic', heic('heic'), 'image/heic'],
  ])('accepts %s as %s content', (name, content, mimeType) => {
    expect(judgeFileContent(name, content)).toEqual({ ok: true, mimeType, extension: expect.any(String) });
  });

  it('decides the MIME type itself — the extension picks it, the content must agree', () => {
    const verdict = judgeFileContent('report.PDF', Buffer.from('%PDF-1.4'));
    expect(verdict).toEqual({ ok: true, mimeType: 'application/pdf', extension: 'pdf' });
  });

  it.each([
    ['an executable renamed .pdf', 'invoice.pdf', Buffer.from('MZ\x90\x00')],
    ['a ZIP renamed .docx', 'notes.docx', zip(['readme.txt'])],
    ['a spreadsheet package renamed .docx', 'notes.docx', zip(['[Content_Types].xml', 'xl/workbook.xml'])],
    ['a macro-enabled document renamed .docx', 'notes.docx', zip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin'])],
    ['a binary renamed .txt', 'notes.txt', Buffer.from([0x41, 0x00, 0x42])],
    ['invalid UTF-8 as .csv', 'data.csv', Buffer.from([0xc3, 0x28])],
    ['a PNG named .jpg', 'photo.jpg', PNG],
  ])('refuses %s', (_label, name, content) => {
    expect(judgeFileContent(name, content)).toEqual({ ok: false, reason: 'type' });
  });

  it.each(['drawing.svg', 'page.html', 'page.htm', 'letter.rtf', 'bundle.zip', 'tool.exe', 'macro.docm', 'macro.xlsm', 'macro.pptm', 'noextension'])(
    'refuses %s by name, whatever it contains',
    (name) => {
      expect(judgeFileContent(name, Buffer.from('%PDF-1.7'))).toEqual({ ok: false, reason: 'type' });
    },
  );

  it('an empty file is "empty", not a type refusal', () => {
    expect(judgeFileContent('report.pdf', Buffer.alloc(0))).toEqual({ ok: false, reason: 'empty' });
  });

  it('the list shown to people holds exactly the types accepted, and no script or archive', () => {
    expect([...ALLOWED_EXTENSIONS].sort()).toEqual(
      ['csv', 'doc', 'docx', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'pdf', 'png', 'ppt', 'pptx', 'txt', 'webp', 'xls', 'xlsx'].sort(),
    );
  });
});
