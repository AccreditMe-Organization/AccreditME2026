/**
 * ACC-271 — the page a record opens, by its type, or null for a type with no
 * page yet (a meeting, today): such a record is named without a link.
 *
 * Home's "Awaiting my action" is the first caller. The bell, the task page and
 * the briefing each still build ['/committees', id] themselves; they move here
 * when they are next touched, so a new record page is one line, here.
 */
export function recordPageLink(type: string, id: string): string[] | null {
  switch (type) {
    case 'COMMITTEE':
      return ['/committees', id];
    default:
      return null;
  }
}
