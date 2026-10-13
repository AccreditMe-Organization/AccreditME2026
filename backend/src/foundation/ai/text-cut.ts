/**
 * ACC-197 — one copy of the cut every AI answer is trimmed with: the document
 * summary's overview and key points (ACC-224), and a task draft's parts.
 */

/**
 * At most `cap` characters, never cut inside a word (ACC-224): at the last
 * sentence end past half the cap; else at the last word boundary past half the
 * cap, with "…"; only one unbroken run longer than half the cap is cut hard.
 */
export function cutAtBoundary(text: string, cap: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= cap) return clean;
  const cut = clean.slice(0, cap);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('؟ '), cut.lastIndexOf('! '), cut.lastIndexOf('。'));
  if (sentence > cap / 2) return cut.slice(0, sentence + 1);
  // The character just past the cap being a space makes the cap itself a boundary.
  const space = clean[cap] === ' ' ? cap : cut.lastIndexOf(' ');
  if (space > cap / 2) return `${clean.slice(0, space).replace(/[\s,،;؛:]+$/u, '')}…`;
  return `${cut.trimEnd()}…`;
}
