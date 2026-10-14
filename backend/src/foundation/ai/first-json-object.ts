/**
 * The first JSON object in a model's answer — from the first `{` to the last
 * `}` — or undefined when there is none or it does not parse. Tolerates a code
 * fence or a sentence around the object.
 *
 * ONE COPY (ACC-199): the briefing (ACC-198), the file summary (ACC-193) and
 * task drafting (ACC-197) each carried this function word for word; the
 * workload hint would have been the fourth.
 */
export function firstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}
