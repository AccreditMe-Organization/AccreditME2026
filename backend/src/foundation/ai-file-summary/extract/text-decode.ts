/**
 * ACC-193 — a COPY of the viewer's decoder,
 * frontend/src/app/shared/files/viewer/text-decode.ts (ACC-189), so a TXT file
 * is read for the summary exactly as the viewer shows it. The frontend file is
 * the original; text-decode.spec.ts runs the frontend's own cases against this
 * copy.
 */
export interface IDecodedText {
  text: string;
  /** True when the file was longer than what was decoded. */
  truncated: boolean;
}

/**
 * The first `maxBytes` of a file as UTF-8, with a leading byte-order mark
 * dropped (TextDecoder's default). Anything that is not valid UTF-8 becomes
 * U+FFFD rather than failing. A character cut in half by the limit is dropped,
 * not shown as U+FFFD.
 */
export function decodeText(bytes: Uint8Array, maxBytes: number): IDecodedText {
  const truncated = bytes.byteLength > maxBytes;
  const view = bytes.subarray(0, Math.min(bytes.byteLength, maxBytes));
  let text = new TextDecoder('utf-8').decode(view);
  if (truncated) text = text.replace(/�+$/, '');
  return { text, truncated };
}
