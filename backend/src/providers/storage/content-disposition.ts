// ACC-177 — the download header that keeps an Arabic file name intact.
//
// RFC 6266 with RFC 5987 encoding: `filename*` carries the real name as
// percent-encoded UTF-8, and `filename` is an ASCII fallback for the rare
// client that ignores `filename*`. Both are always sent.

export function contentDisposition(fileName: string): string {
  const fallback = asciiFallback(fileName);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}

function encodeRfc5987(value: string): string {
  // encodeURIComponent leaves ' ( ) * ! unescaped; RFC 5987's attr-char does
  // not allow them.
  return encodeURIComponent(value).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function asciiFallback(value: string): string {
  const dot = value.lastIndexOf('.');
  const ext = dot > 0 ? value.slice(dot).replace(/[^A-Za-z0-9.]/g, '') : '';
  const base = (dot > 0 ? value.slice(0, dot) : value)
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '')
    .trim();
  return `${base || 'file'}${ext}`;
}
