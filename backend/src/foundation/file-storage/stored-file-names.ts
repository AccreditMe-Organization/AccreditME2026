import { randomBytes } from 'crypto';

// ACC-177 — file names and object keys. KEYS ARE BUILT BY THE SERVER ONLY;
// nothing a client sends becomes a path.
//
//   key  = {organizationId}/{module}/{recordId}/{randomId}-{safeName}
//
// The display name keeps whatever the person called the file — Arabic
// included — and only reaches the download header (RFC 5987, see
// content-disposition.ts). The key name is ASCII, short, and safe in any
// store; it exists so a key is recognisable to an operator, nothing more.

const MAX_DISPLAY_NAME = 255;
const MAX_KEY_NAME = 80;

/** The name shown and offered on download: NFC, no controls or separators, ≤255. */
export function displayFileName(original: string): string {
  const cleaned = original
    .normalize('NFC')
    // Control characters, including the bidi overrides that make
    // "invoice‮fdp.exe" read as a PDF.
    .replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[\\/]/g, '_')
    .trim();
  const name = cleaned || 'file';
  if (name.length <= MAX_DISPLAY_NAME) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
  return name.slice(0, MAX_DISPLAY_NAME - ext.length) + ext;
}

/** The ASCII tail of a key: [A-Za-z0-9._-], ≤80, extension kept, never empty. */
export function keySafeName(displayName: string, extension: string): string {
  const dot = displayName.lastIndexOf('.');
  const base = (dot > 0 ? displayName.slice(0, dot) : displayName)
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '');
  const ext = extension.replace(/[^a-z0-9]/g, '');
  const room = MAX_KEY_NAME - (ext ? ext.length + 1 : 0);
  return `${(base || 'file').slice(0, room)}${ext ? `.${ext}` : ''}`;
}

const ID_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** {organizationId}/{module}/{recordId}/{randomId}-{safeName} */
export function buildStorageKey(parts: {
  organizationId: string;
  module: string;
  recordId: string;
  safeName: string;
}): string {
  for (const segment of [parts.organizationId, parts.module, parts.recordId]) {
    // Ids are cuids and the module a constant; anything else is a bug, and
    // refusing here keeps a key from ever spanning a folder it should not.
    if (!ID_SEGMENT.test(segment)) throw new Error(`Unsafe storage key segment: ${segment}`);
  }
  return `${parts.organizationId}/${parts.module}/${parts.recordId}/${randomBytes(10).toString('hex')}-${parts.safeName}`;
}
