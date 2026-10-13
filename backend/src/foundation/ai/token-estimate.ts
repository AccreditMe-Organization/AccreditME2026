/**
 * A deliberately HIGH estimate of tokens, with no call to anyone: UTF-8 bytes
 * ÷ 3. Latin runs about 4 characters a token, so this over-counts; Arabic is
 * 2 bytes a character, so it assumes 1.5 characters a token. The gateway logs
 * the provider's REAL input count, which shows the margin (§14.2).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
}
