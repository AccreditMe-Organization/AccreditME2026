import type { StageAssigneeKind, StageWhoMode, WorkflowObjectType } from '../../../generated/prisma/client';
import { WorkflowRefusalException } from './workflow-refusal';

/**
 * ACC-271 PR 3 — "who works this stage" as the stage save and the template read
 * see it (plan §10, Section 8). Pure: no database. The service does the tenant
 * checks and the write; this file decides what a `who` may say and how it reads.
 */

export const STAGE_ASSIGNEE_KINDS_ALL = ['SPECIFIC_USER', 'POSITION_IN_UNIT', 'ORG_UNIT_HEAD', 'CREATOR', 'COMMITTEE'] as const;
export const STAGE_WHO_MODES = ['ANY_ONE', 'ALL', 'COMMITTEE_VOTE'] as const;

/**
 * The kinds a stage of each record type may be worked by: ONE server list, served
 * on the template read as `assigneeKinds` (no frontend copy). Exhaustive over the
 * record types, so a new type is a compile error until it says. Every kind is
 * offered everywhere today: a named unit, position, committee or person makes
 * sense for any record. "The record's unit" and "the record's committee" (a null
 * unit or committee) are further limited by RECORD_ROUTES (fail closed).
 */
export const STAGE_ASSIGNEE_KINDS: Readonly<Record<WorkflowObjectType, readonly StageAssigneeKind[]>> = {
  DOCUMENT_REQUEST: STAGE_ASSIGNEE_KINDS_ALL,
  DOCUMENT: STAGE_ASSIGNEE_KINDS_ALL,
  CHANGE_REQUEST: STAGE_ASSIGNEE_KINDS_ALL,
  INCIDENT: STAGE_ASSIGNEE_KINDS_ALL,
  AUDIT: STAGE_ASSIGNEE_KINDS_ALL,
  CORRECTIVE_ACTION: STAGE_ASSIGNEE_KINDS_ALL,
  MEETING: STAGE_ASSIGNEE_KINDS_ALL,
  COMMITTEE: STAGE_ASSIGNEE_KINDS_ALL,
  COMMITTEE_CHANGE_REQUEST: STAGE_ASSIGNEE_KINDS_ALL,
};

export function assigneeKindsFor(objectType: WorkflowObjectType): StageAssigneeKind[] {
  return [...(STAGE_ASSIGNEE_KINDS[objectType] ?? [])];
}

/** One entry as a save sends it, or as it is stored. */
export interface WhoEntryInput {
  kind: StageAssigneeKind;
  userId?: string | null;
  positionId?: string | null;
  orgUnitId?: string | null;
  committeeId?: string | null;
  committeeRoleValueId?: string | null;
}

export type WhoEntryField = 'userId' | 'positionId' | 'orgUnitId' | 'committeeId' | 'committeeRoleValueId';
const ENTRY_FIELDS: readonly WhoEntryField[] = ['userId', 'positionId', 'orgUnitId', 'committeeId', 'committeeRoleValueId'];

/** What each kind uses, and which of those it must have. */
export const KIND_FIELDS: Readonly<Record<StageAssigneeKind, { uses: readonly WhoEntryField[]; requires: readonly WhoEntryField[] }>> = {
  SPECIFIC_USER: { uses: ['userId'], requires: ['userId'] },
  POSITION_IN_UNIT: { uses: ['positionId', 'orgUnitId'], requires: ['positionId', 'orgUnitId'] },
  // No unit = the record's unit (Q3).
  ORG_UNIT_HEAD: { uses: ['orgUnitId'], requires: [] },
  CREATOR: { uses: [], requires: [] },
  // No committee = the record's committee (Q3); the role narrows its members.
  COMMITTEE: { uses: ['committeeId', 'committeeRoleValueId'], requires: [] },
};

/**
 * ACC-271 PR 5-be — a mode that only one shape of list may use: Committee vote
 * needs exactly one entry, and it must be a Committee. assertWhoShape() refuses
 * by this map, and whoRulesFor() serves it, so the two cannot disagree.
 */
export const MODE_ONLY_WITH_SINGLE: Readonly<Partial<Record<StageWhoMode, StageAssigneeKind>>> = { COMMITTEE_VOTE: 'COMMITTEE' };

/** The mode a save sends when the screen shows no choice (one entry that isn't a committee). */
export const DEFAULT_WHO_MODE: StageWhoMode = 'ANY_ONE';

/**
 * When the screen shows "When there are several people" (drawing section 8):
 * two or more entries, or a single entry of this kind. One entry of any other
 * kind is simply "any one", so there is nothing to choose.
 */
export const MODE_CHOICE_SHOWN_WHEN = { minEntries: 2, orSingleKind: 'COMMITTEE' } as const satisfies {
  minEntries: number;
  orSingleKind: StageAssigneeKind;
};

/** The rules the stage screens read (served on the template read), so no screen keeps a copy. */
export interface WhoRules {
  kinds: Partial<Record<StageAssigneeKind, { uses: WhoEntryField[]; requires: WhoEntryField[] }>>;
  modes: { key: StageWhoMode; onlyWithSingle?: StageAssigneeKind }[];
  modeChoiceShownWhen: { minEntries: number; orSingleKind: StageAssigneeKind };
  defaultMode: StageWhoMode;
}

/** The rules for a record type's stages, built from the constants assertWhoShape() checks against. */
export function whoRulesFor(objectType: WorkflowObjectType): WhoRules {
  const kinds: WhoRules['kinds'] = {};
  for (const kind of STAGE_ASSIGNEE_KINDS[objectType] ?? []) {
    kinds[kind] = { uses: [...KIND_FIELDS[kind].uses], requires: [...KIND_FIELDS[kind].requires] };
  }
  return {
    kinds,
    modes: STAGE_WHO_MODES.map((key) => {
      const only = MODE_ONLY_WITH_SINGLE[key];
      return only ? { key, onlyWithSingle: only } : { key };
    }),
    modeChoiceShownWhen: { ...MODE_CHOICE_SHOWN_WHEN },
    defaultMode: DEFAULT_WHO_MODE,
  };
}

/** An empty id ('' or blank) and null mean the same thing: not set. */
function idOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The entry with only the fields its kind uses, each set or null. */
export function normalizeEntry(entry: WhoEntryInput): Required<WhoEntryInput> {
  const uses = KIND_FIELDS[entry.kind]?.uses ?? [];
  const out = { kind: entry.kind, userId: null, positionId: null, orgUnitId: null, committeeId: null, committeeRoleValueId: null } as Required<WhoEntryInput>;
  for (const field of uses) out[field] = idOrNull(entry[field]);
  return out;
}

/** Two entries are the same entry when this matches: kind and every field it uses. */
export function entryKey(entry: WhoEntryInput): string {
  const n = normalizeEntry(entry);
  return [n.kind, ...ENTRY_FIELDS.map((f) => n[f] ?? '')].join('|');
}

/**
 * The rules a `who` must meet before anything is read: at least one entry, no
 * two the same, each kind offered for the record type and given exactly the
 * fields it uses, "the record's" forms only where the record type has the route,
 * and a Committee vote only for a single Committee entry. Throws the first
 * refusal; returns the entries normalised.
 */
export function assertWhoShape(
  objectType: WorkflowObjectType,
  who: { mode: StageWhoMode; entries: WhoEntryInput[] },
  recordRoutes: { unit: boolean; committee: boolean },
): Required<WhoEntryInput>[] {
  if (!STAGE_WHO_MODES.includes(who.mode)) throw new WorkflowRefusalException('WHO_MODE_UNKNOWN', { mode: who.mode });
  if (who.entries.length === 0) throw new WorkflowRefusalException('WHO_ENTRIES_REQUIRED');
  const allowed = STAGE_ASSIGNEE_KINDS[objectType] ?? [];
  const seen = new Set<string>();
  const entries = who.entries.map((entry, index) => {
    if (!allowed.includes(entry.kind)) throw new WorkflowRefusalException('WHO_KIND_NOT_ALLOWED', { index, kind: entry.kind });
    const rule = KIND_FIELDS[entry.kind];
    for (const field of ENTRY_FIELDS) {
      if (!rule.uses.includes(field) && idOrNull(entry[field]) !== null) {
        throw new WorkflowRefusalException('WHO_ENTRY_FIELD_NOT_USED', { index, kind: entry.kind, field });
      }
    }
    for (const field of rule.requires) {
      if (idOrNull(entry[field]) === null) throw new WorkflowRefusalException('WHO_ENTRY_INCOMPLETE', { index, kind: entry.kind, field });
    }
    const n = normalizeEntry(entry);
    if (n.kind === 'ORG_UNIT_HEAD' && n.orgUnitId === null && !recordRoutes.unit) {
      throw new WorkflowRefusalException('WHO_RECORD_ROUTE_NOT_AVAILABLE', { index, kind: n.kind, objectType });
    }
    if (n.kind === 'COMMITTEE' && n.committeeId === null && !recordRoutes.committee) {
      throw new WorkflowRefusalException('WHO_RECORD_ROUTE_NOT_AVAILABLE', { index, kind: n.kind, objectType });
    }
    const key = entryKey(n);
    if (seen.has(key)) throw new WorkflowRefusalException('WHO_ENTRY_DUPLICATE', { index });
    seen.add(key);
    return n;
  });
  // A vote is a committee's: exactly one entry, and it is a Committee
  // (MODE_ONLY_WITH_SINGLE, the map the screens are served).
  const onlyWith = MODE_ONLY_WITH_SINGLE[who.mode];
  if (onlyWith !== undefined && !(entries.length === 1 && entries[0]!.kind === onlyWith)) {
    throw new WorkflowRefusalException('COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE');
  }
  return entries;
}

// ── How a `who` reads ───────────────────────────────────────────────────────

/** The names an entry is read with; any may be missing (removed since). */
export interface WhoEntryNames {
  userName?: string | null;
  positionNameEn?: string | null;
  positionNameAr?: string | null;
  orgUnitNameEn?: string | null;
  orgUnitNameAr?: string | null;
  committeeNameEn?: string | null;
  committeeNameAr?: string | null;
  roleLabelEn?: string | null;
  roleLabelAr?: string | null;
}

export type WhoEntryForSentence = Required<WhoEntryInput> & WhoEntryNames;

/** Arabic falls back to English (ACC-160): a missing Arabic name never reads blank. */
const ar = (arabic: string | null | undefined, english: string | null | undefined): string | null => arabic || english || null;

/**
 * One entry as a phrase, in both languages. Arabic is gender-neutral: "من يشغل"
 * ("whoever holds"), "من يرأس" ("whoever heads"), never a masculine title.
 */
export function entryPhrase(e: WhoEntryForSentence): { en: string; ar: string } {
  switch (e.kind) {
    case 'SPECIFIC_USER': {
      const name = e.userName ?? null;
      return { en: name ?? 'a person who was removed', ar: name ?? 'شخص أُزيل' };
    }
    case 'POSITION_IN_UNIT': {
      const posEn = e.positionNameEn ?? 'a removed position';
      const unitEn = e.orgUnitNameEn ?? 'a removed unit';
      const posAr = ar(e.positionNameAr, e.positionNameEn) ?? 'وظيفة أُزيلت';
      const unitAr = ar(e.orgUnitNameAr, e.orgUnitNameEn) ?? 'وحدة أُزيلت';
      return { en: `whoever holds ${posEn} in ${unitEn}`, ar: `من يشغل وظيفة ${posAr} في ${unitAr}` };
    }
    case 'ORG_UNIT_HEAD':
      if (e.orgUnitId === null) return { en: "the head of the record's unit", ar: 'من يرأس وحدة السجل' };
      return {
        en: `the head of ${e.orgUnitNameEn ?? 'a removed unit'}`,
        ar: `من يرأس ${ar(e.orgUnitNameAr, e.orgUnitNameEn) ?? 'وحدة أُزيلت'}`,
      };
    case 'CREATOR':
      return { en: 'whoever created the record', ar: 'من أنشأ السجل' };
    case 'COMMITTEE': {
      const committeeEn = e.committeeId === null ? "the record's committee" : (e.committeeNameEn ?? 'a removed committee');
      const committeeAr = e.committeeId === null ? 'لجنة السجل' : (ar(e.committeeNameAr, e.committeeNameEn) ?? 'لجنة أُزيلت');
      if (e.committeeRoleValueId === null) return { en: `the members of ${committeeEn}`, ar: `أعضاء ${committeeAr}` };
      const roleEn = e.roleLabelEn ?? 'a removed role';
      const roleAr = ar(e.roleLabelAr, e.roleLabelEn) ?? 'دور أُزيل';
      return { en: `the members of ${committeeEn} in the role ${roleEn}`, ar: `أعضاء ${committeeAr} بدور ${roleAr}` };
    }
  }
}

function joinEn(parts: string[], last: 'or' | 'and'): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')}, ${last} ${parts[parts.length - 1]}`;
}

function joinAr(parts: string[], last: 'أو' | 'و'): string {
  if (parts.length <= 1) return parts.join('');
  return parts.map((p, i) => (i === 0 ? p : `${last === 'أو' ? 'أو ' : 'و'}${p}`)).join('، ');
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The read-back sentence under "Who works this stage" (plan §10, Section 8),
 * built here so the words and the engine cannot disagree:
 * - Any one of them: one entry reads as itself; several as "Any one of: a, b, or c".
 * - All of them: "All of: a, b, and c".
 * - Committee vote: "The <committee> decides by vote." / «تقرر <committee> بالتصويت.»
 *   (the drawn wording, PR 5-be). A committee's Arabic name already begins with
 *   «لجنة», so the verb is followed by the whole name, as the drawing writes it.
 */
export function whoSentence(mode: StageWhoMode, entries: WhoEntryForSentence[]): { en: string; ar: string } {
  const phrases = entries.map(entryPhrase);
  const en = phrases.map((p) => p.en);
  const arParts = phrases.map((p) => p.ar);
  if (entries.length === 0) return { en: 'Nobody works this stage yet.', ar: 'لا أحد يعمل على هذه المرحلة بعد.' };
  switch (mode) {
    case 'COMMITTEE_VOTE': {
      const c = entries[0]!;
      if (c.committeeId === null) return { en: "The record's committee decides by vote.", ar: 'تقرر لجنة السجل بالتصويت.' };
      if (!c.committeeNameEn) return { en: 'A removed committee decides by vote.', ar: 'تقرر لجنة أُزيلت بالتصويت.' };
      return { en: `The ${c.committeeNameEn} decides by vote.`, ar: `تقرر ${ar(c.committeeNameAr, c.committeeNameEn)} بالتصويت.` };
    }
    case 'ALL':
      return { en: `All of: ${joinEn(en, 'and')}.`, ar: `كلٌّ من: ${joinAr(arParts, 'و')}.` };
    case 'ANY_ONE':
    default:
      if (entries.length === 1) return { en: `${capitalise(en[0]!)}.`, ar: `${arParts[0]}.` };
      return { en: `Any one of: ${joinEn(en, 'or')}.`, ar: `أيٌّ من: ${joinAr(arParts, 'أو')}.` };
  }
}

/** ACC-255's audit shape for who: each entry as a numbered English phrase, starting ones marked. */
export function whoAuditEntries(entries: (WhoEntryForSentence & { isStartingAssignment?: boolean })[]): string[] {
  return entries.map((e, i) => `${i + 1}. ${entryPhrase(e).en}${e.isStartingAssignment ? ' (starting assignment)' : ''}`);
}
