import { ROUTE_PERMISSIONS } from '../../core/navigation/nav-items';
import { TaskRecordRefDto } from './services/task.service';

/**
 * ACC-120 slice 3 — HOW A TASK'S RECORD AND PRIORITY READ on My tasks: its
 * list, and its two sections above it. One file, so the sections and the list
 * cannot name a record or a priority two ways.
 */

/** A record type with a page of its own today, and the route that opens it. */
const RECORD_PAGES: Readonly<Record<string, string>> = { COMMITTEE: 'committees' };

/**
 * Where the record opens: only a type with a page today, only with a name (a
 * nameless record is one the viewer may not open), and only for a viewer the
 * page's route admits — hidden, never a link the guard then refuses.
 */
export function taskRecordHref(record: TaskRecordRefDto, hasPermission: (key: string) => boolean): string[] | null {
  const route = RECORD_PAGES[record.type];
  if (!route || !record.nameEn) return null;
  const needs = ROUTE_PERMISSIONS.get(route) ?? [];
  return needs.every((p) => hasPermission(p)) ? ['/', route, record.id] : null;
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
