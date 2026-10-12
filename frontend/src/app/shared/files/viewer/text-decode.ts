/** ACC-189 — how much of a text file the viewer decodes and shows. */
export const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

export interface IDecodedText {
  text: string;
  /** True when the file was longer than what was decoded. */
  truncated: boolean;
}

/**
 * The first `maxBytes` of a file as UTF-8, with a leading byte-order mark
 * dropped (TextDecoder's default). The upload sniffer accepted the file as
 * text; anything that is not valid UTF-8 shows as U+FFFD rather than failing.
 * A character cut in half by the limit is dropped, not shown as U+FFFD.
 */
export function decodeText(bytes: ArrayBuffer, maxBytes: number = TEXT_PREVIEW_MAX_BYTES): IDecodedText {
  const truncated = bytes.byteLength > maxBytes;
  const view = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, maxBytes));
  let text = new TextDecoder('utf-8').decode(view);
  if (truncated) text = text.replace(/�+$/, '');
  return { text, truncated };
}

/**
 * Lines, so each can take its own direction (`dir="auto"`): an Arabic line in
 * an English file reads right to left, and the other way round.
 */
export function textLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
