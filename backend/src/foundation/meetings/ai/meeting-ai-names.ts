/**
 * ACC-322 — NAMES NEVER REACH THE MODEL AS WRITTEN (plan step-322 §1.0).
 *
 * Every customer text sent in a Meetings AI call goes through ONE NameTable
 * first: the rough notes, agenda titles and descriptions, existing action
 * titles. What it replaces:
 *   - every invitee's full name (members, organisation guests, outside guests)
 *     becomes a label, `[P1]`, `[P2]`, …;
 *   - each of an invitee's name words of three or more letters becomes the
 *     same label when it belongs to exactly one invitee;
 *   - an OUTSIDE guest's name words of three or more letters ALWAYS become the
 *     guest's label, even when someone else shares the word: over-replacing is
 *     the safe direction;
 *   - the full name of every ACTIVE person in the organisation who is not an
 *     invitee becomes a label;
 *   - every email address becomes `[email]`.
 *
 * Matching is by whole words, ignoring case, with Arabic normalised (alef
 * forms, alef maqsura and ya, ta marbuta and ha, tatweel, diacritics). An
 * honorific (Dr., Eng., د., م.) stays outside the label: it is a separate word,
 * and never part of a stored name's words.
 *
 * The model answers with labels, and writeBack() puts the names back; an owner
 * is resolved from its label exactly (owner()), never by guessing at a name.
 * A label is handed out the first time its person appears, so the labels sent
 * are only the people the text names.
 *
 * What it cannot catch: a misspelt name, or someone who is neither an invitee
 * nor a user. The notes line says the notes go to the AI provider (§6 answer 5).
 */

export type NamedKind = 'MEMBER' | 'ORG_GUEST' | 'OUTSIDE_GUEST' | 'PERSON';

export interface NameSource {
  kind: NamedKind;
  /** The user, for anyone but an outside guest. */
  userId: string | null;
  /** The name as recorded (a user's name, or the outside guest's name on the meeting). */
  name: string;
  /** Whether the user is ACTIVE (an outside guest is never a user). */
  active: boolean;
}

export interface NamedPerson extends NameSource {
  label: string;
}

/** Honorifics kept outside a label, and never counted as a name word. */
const HONORIFICS = new Set(['dr', 'eng', 'mr', 'mrs', 'ms', 'prof', 'د', 'م', 'أ', 'ا']);

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
export const EMAIL_LABEL = '[email]';
const LABEL = /\[P(\d+)\]/g;

/** One word as it is compared: lower case, Arabic forms folded, no diacritics or tatweel. */
export function normaliseWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

const letters = (word: string): number => (word.match(/\p{L}/gu) ?? []).length;

/** A stored name's words, normalised, without honorifics. */
function nameWords(name: string): string[] {
  return (name.match(WORD) ?? []).map(normaliseWord).filter((w) => !HONORIFICS.has(w));
}

interface Entry {
  source: NameSource;
  words: string[];
  label: string | null;
}

export class NameTable {
  private readonly entries: Entry[];
  /** A single word → the entry it always means (an outside guest's, or an invitee's own word). */
  private readonly singleWords = new Map<string, Entry>();
  /** Full names, longest first, so "Lina Mansour Al-Harbi" wins over "Lina Mansour". */
  private readonly fullNames: Entry[];
  private next = 1;

  /**
   * @param invitees the meeting's members, organisation guests and outside guests.
   * @param people every ACTIVE person in the organisation (an invitee among them is matched as the invitee).
   */
  constructor(invitees: readonly NameSource[], people: readonly { userId: string; name: string }[]) {
    const inviteeEntries: Entry[] = invitees.map((source) => ({ source, words: nameWords(source.name), label: null }));
    const inviteeUsers = new Set(invitees.map((i) => i.userId).filter((id): id is string => id !== null));
    const others: Entry[] = people
      .filter((p) => !inviteeUsers.has(p.userId))
      .map((p) => ({ source: { kind: 'PERSON', userId: p.userId, name: p.name, active: true }, words: nameWords(p.name), label: null }));
    this.entries = [...inviteeEntries, ...others];
    this.fullNames = this.entries.filter((e) => e.words.length > 0).sort((a, b) => b.words.length - a.words.length);

    // An invitee's word of 3+ letters is theirs when no other invitee has it.
    const owners = new Map<string, Set<Entry>>();
    for (const e of inviteeEntries) {
      for (const w of new Set(e.words)) {
        if (letters(w) < 3) continue;
        if (!owners.has(w)) owners.set(w, new Set());
        owners.get(w)!.add(e);
      }
    }
    for (const [w, set] of owners) {
      if (set.size === 1) this.singleWords.set(w, [...set][0]!);
    }
    // An outside guest's words ALWAYS mean the guest, shared or not.
    for (const e of inviteeEntries) {
      if (e.source.kind !== 'OUTSIDE_GUEST') continue;
      for (const w of e.words) {
        if (letters(w) >= 3) this.singleWords.set(w, e);
      }
    }
  }

  private labelOf(entry: Entry): string {
    if (!entry.label) entry.label = `[P${this.next++}]`;
    return entry.label;
  }

  /** The text with every email and every name this table knows replaced. */
  replace(text: string): string {
    const noEmails = text.replace(EMAIL, EMAIL_LABEL);
    const tokens: { start: number; end: number; norm: string }[] = [];
    for (const m of noEmails.matchAll(WORD)) tokens.push({ start: m.index!, end: m.index! + m[0].length, norm: normaliseWord(m[0]) });
    let out = '';
    let at = 0;
    for (let i = 0; i < tokens.length; ) {
      const full = this.fullNames.find((e) => e.words.every((w, k) => tokens[i + k]?.norm === w));
      const single = full ? null : this.singleWords.get(tokens[i]!.norm);
      const entry = full ?? single;
      if (!entry) {
        i++;
        continue;
      }
      const span = full ? full.words.length : 1;
      out += noEmails.slice(at, tokens[i]!.start) + this.labelOf(entry);
      at = tokens[i + span - 1]!.end;
      i += span;
    }
    return out + noEmails.slice(at);
  }

  /** The person behind a label (`P3` or `[P3]`), if the table handed it out. */
  person(label: string | null | undefined): NamedPerson | null {
    if (!label) return null;
    const m = /^\[?P(\d+)\]?$/.exec(label.trim());
    if (!m) return null;
    const wanted = `[P${m[1]}]`;
    const entry = this.entries.find((e) => e.label === wanted);
    return entry ? { ...entry.source, label: wanted } : null;
  }

  /** The model's text with each label it was given replaced by the person's name, as recorded. */
  writeBack(text: string): string {
    return text.replace(LABEL, (whole, n: string) => {
      const entry = this.entries.find((e) => e.label === `[P${n}]`);
      return entry ? entry.source.name : whole;
    });
  }

  /** The labels handed out so far: what the model may answer with. */
  labelsGiven(): string[] {
    return this.entries.filter((e) => e.label !== null).map((e) => e.label!);
  }
}
