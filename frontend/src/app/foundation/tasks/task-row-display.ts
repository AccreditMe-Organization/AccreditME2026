import { recordPageLink } from '../../shared/utils/record-link.util';
import { TaskRecordRefDto } from './services/task.service';

/**
 * ACC-120 slice 3 — HOW A TASK'S RECORD AND PRIORITY READ on My tasks: its
 * list, and its two sections above it. One file, so the sections and the list
 * cannot name a record or a priority two ways.
 */

/**
 * Where the record opens: a type with a page today (recordPageLink, the one
 * list of record pages), and only when the server named the record.
 *
 * The name IS the server's "may open": it names a record only for a viewer its
 * own read admits (task-record-names.ts on the backend: committees:view, or an
 * active member of that committee since ACC-281), and the route admits the
 * same people. So no permission is checked here: a frontend copy of the rule
 * is how a member saw their committee's name with no link.
 */
export function taskRecordHref(record: TaskRecordRefDto): string[] | null {
  const link = recordPageLink(record.type, record.id);
  return link && record.nameEn ? link : null;
}

/** The translation key of a record type's word ("Committee"); an unknown type reads "Record". */
export function taskRecordTypeKey(type: string): string {
  return type === 'COMMITTEE' || type === 'MEETING' ? `taskPage.recordType.${type}` : 'taskPage.recordType.OTHER';
}

/**
 * The Priority column (Task Screens: "▲ High", "!! Critical", the others
 * plain). The glyph is decoration beside the word, never the only carrier, and
 * never a colour.
 */
const PRIORITY_GLYPH: Readonly<Record<string, string>> = { HIGH: '▲', CRITICAL: '!!' };

export function taskPriorityGlyph(priority: string): string | null {
  return PRIORITY_GLYPH[priority] ?? null;
}

/** The translation key of a priority's word. */
export function taskPriorityKey(priority: string): string {
  return `task.priority.${priority.toLowerCase()}`;
}
