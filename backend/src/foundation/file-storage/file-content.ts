// ACC-177 — what may be uploaded, judged from the file's CONTENT as well as
// its name. The extension must be on the list AND the bytes must be that kind
// of file; the MIME type stored is the one decided here, never the client's.
//
// A small in-house sniffer rather than `file-type`: that package is ESM-only
// (the same Jest trouble as better-auth/api), and the list is short enough
// that each check can be read and tested on its own.
//
// Refused by construction (not on the list): SVG and HTML (script), RTF,
// archives, executables, and macro-enabled Office — by extension (.docm,
// .xlsm, .pptm) and by content (an OOXML package carrying vbaProject.bin,
// whatever its name says). Legacy DOC/XLS/PPT are allowed (Ahmad, 7 Oct) and
// CAN carry macros, which is why virus scanning is a High follow-up.

export type FileFamily = 'pdf' | 'ooxml' | 'cfb' | 'text' | 'png' | 'jpeg' | 'gif' | 'webp' | 'heic';

interface IAllowedType {
  mimeType: string;
  family: FileFamily;
  /** OOXML only: the folder that names the application inside the package. */
  ooxmlPart?: 'word/' | 'xl/' | 'ppt/';
}

export const ALLOWED_TYPES: Readonly<Record<string, IAllowedType>> = {
  pdf: { mimeType: 'application/pdf', family: 'pdf' },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', family: 'ooxml', ooxmlPart: 'word/' },
  xlsx: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', family: 'ooxml', ooxmlPart: 'xl/' },
  pptx: { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', family: 'ooxml', ooxmlPart: 'ppt/' },
  doc: { mimeType: 'application/msword', family: 'cfb' },
  xls: { mimeType: 'application/vnd.ms-excel', family: 'cfb' },
  ppt: { mimeType: 'application/vnd.ms-powerpoint', family: 'cfb' },
  csv: { mimeType: 'text/csv', family: 'text' },
  txt: { mimeType: 'text/plain', family: 'text' },
  png: { mimeType: 'image/png', family: 'png' },
  jpg: { mimeType: 'image/jpeg', family: 'jpeg' },
  jpeg: { mimeType: 'image/jpeg', family: 'jpeg' },
  gif: { mimeType: 'image/gif', family: 'gif' },
  webp: { mimeType: 'image/webp', family: 'webp' },
  heic: { mimeType: 'image/heic', family: 'heic' },
  heif: { mimeType: 'image/heif', family: 'heic' },
};

/** The extensions, for the "allowed types" line the upload screen shows. */
export const ALLOWED_EXTENSIONS: readonly string[] = Object.keys(ALLOWED_TYPES);

export type FileContentVerdict =
  | { ok: true; mimeType: string; extension: string }
  | { ok: false; reason: 'empty' | 'type' };

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

export function judgeFileContent(fileName: string, content: Buffer): FileContentVerdict {
  if (content.length === 0) return { ok: false, reason: 'empty' };
  const extension = extensionOf(fileName);
  const allowed = ALLOWED_TYPES[extension];
  if (!allowed) return { ok: false, reason: 'type' };
  if (!matchesFamily(allowed, content)) return { ok: false, reason: 'type' };
  return { ok: true, mimeType: allowed.mimeType, extension };
}

function startsWith(content: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (content.length < offset + bytes.length) return false;
  return bytes.every((b, i) => content[offset + i] === b);
}

function ascii(content: Buffer, start: number, length: number): string {
  return content.subarray(start, start + length).toString('latin1');
}

function matchesFamily(type: IAllowedType, content: Buffer): boolean {
  switch (type.family) {
    case 'pdf':
      // The spec allows bytes before the header, within the first 1024.
      return content.subarray(0, 1024).includes('%PDF-');
    case 'png':
      return startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return startsWith(content, [0xff, 0xd8, 0xff]);
    case 'gif':
      return ['GIF87a', 'GIF89a'].includes(ascii(content, 0, 6));
    case 'webp':
      return ascii(content, 0, 4) === 'RIFF' && ascii(content, 8, 4) === 'WEBP';
    case 'heic':
      return ascii(content, 4, 4) === 'ftyp' && HEIF_BRANDS.has(ascii(content, 8, 4));
    case 'cfb':
      // The Compound File Binary signature shared by DOC, XLS and PPT. It
      // cannot tell them apart; the extension does that.
      return startsWith(content, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'ooxml':
      return isOoxmlPackage(content, type.ooxmlPart!);
    case 'text':
      return isText(content);
  }
}

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

// An Office Open XML file is a ZIP holding [Content_Types].xml and the
// application's own folder. A package with a VBA project is macro-enabled,
// whatever its extension claims, and is refused.
function isOoxmlPackage(content: Buffer, part: string): boolean {
  if (!startsWith(content, [0x50, 0x4b, 0x03, 0x04])) return false;
  const names = zipEntryNames(content);
  if (!names) return false;
  if (!names.includes('[Content_Types].xml')) return false;
  if (!names.some((n) => n.startsWith(part))) return false;
  if (names.some((n) => n.toLowerCase().endsWith('vbaproject.bin'))) return false;
  return true;
}

// The file names in a ZIP's central directory, or null if there is none.
function zipEntryNames(content: Buffer): string[] | null {
  const EOCD = 0x06054b50;
  const CEN = 0x02014b50;
  const searchFrom = Math.max(0, content.length - 65_557);
  let eocd = -1;
  for (let i = content.length - 22; i >= searchFrom; i--) {
    if (content.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = content.readUInt16LE(eocd + 10);
  let offset = content.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > content.length || content.readUInt32LE(offset) !== CEN) return null;
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    names.push(content.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

// CSV and TXT have no signature: they must decode as UTF-8 (or UTF-16 with a
// byte-order mark, which is how Excel saves "Unicode text"), and a UTF-8 file
// may not contain NUL bytes — a binary renamed .txt fails here.
function isText(content: Buffer): boolean {
  try {
    if (startsWith(content, [0xff, 0xfe])) {
      new TextDecoder('utf-16le', { fatal: true }).decode(content.subarray(2));
      return true;
    }
    if (startsWith(content, [0xfe, 0xff])) {
      new TextDecoder('utf-16be', { fatal: true }).decode(content.subarray(2));
      return true;
    }
    if (content.includes(0)) return false;
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}
