/**
 * ACC-297 (Ahmad, 11 Nov) — what a committee's officers are told after one of its
 * members is transferred to another unit. In-app only; both languages are
 * stored, as every in-app notice is, and each reader sees their own.
 *
 * Arabic is gender-neutral: no verb has a person as its subject. «تم نقل» is a
 * verbal noun, and every line's verb is about the membership (العضوية), never
 * the person. The organisation is not named.
 *
 * A committee is named only for a reader who may open it; anyone else reads
 * "a committee" (the closed-task notices' rule, ACC-271 PR 4).
 */

export interface Named {
  nameEn: string;
  nameAr: string | null;
}

/** One committee's line, as one reader sees it. `committee` is null for a reader who may not open it. */
export type TransferNoticeLine =
  | { kind: 'HOLDS'; committee: Named | null; seat: Named | null }
  | { kind: 'REMOVED_IN_TRANSFER'; committee: Named | null; seat: Named | null }
  | { kind: 'REMOVED_WITH_REASON'; committee: Named | null; seat: Named | null; reason: string }
  | { kind: 'REMOVED_NO_REASON'; committee: Named | null; seat: Named | null };

export interface TransferNoticeFacts {
  personName: string;
  /** The person's unit now; null if they have none. */
  newUnit: Named | null;
  lines: TransferNoticeLine[];
}

export interface TransferNoticeText {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

const ar = (n: Named): string => n.nameAr ?? n.nameEn;

/** The permission as the Roles screen names it (permissions.sentence['committees:remove_member']). */
const REMOVE_PERMISSION = { en: 'Remove members from a committee', ar: 'إزالة أعضاء من اللجنة' };

function lineEn(line: TransferNoticeLine, unitEn: string): string {
  const committee = line.committee ? line.committee.nameEn : 'A committee';
  const seat = line.seat ? line.seat.nameEn : 'a seat';
  switch (line.kind) {
    case 'HOLDS':
      return `${committee}: still holds ${seat}.`;
    case 'REMOVED_IN_TRANSFER':
      return `${committee}: was removed from ${seat} as part of the transfer to ${unitEn}.`;
    case 'REMOVED_WITH_REASON':
      return `${committee}: was removed from ${seat}. Reason given: "${line.reason}".`;
    case 'REMOVED_NO_REASON':
      return `${committee}: was removed from ${seat}; no reason was given.`;
  }
}

function lineAr(line: TransferNoticeLine, unitAr: string): string {
  const committee = line.committee ? `«${ar(line.committee)}»` : 'لجنة';
  const seat = line.seat ? `«${ar(line.seat)}»` : 'مقعد';
  switch (line.kind) {
    case 'HOLDS':
      return `${committee}: ما زالت العضوية بصفة ${seat} قائمة.`;
    case 'REMOVED_IN_TRANSFER':
      return `${committee}: أُنهيت العضوية بصفة ${seat} ضمن النقل إلى ${unitAr}.`;
    case 'REMOVED_WITH_REASON':
      return `${committee}: أُنهيت العضوية بصفة ${seat}. السبب المذكور: «${line.reason}».`;
    case 'REMOVED_NO_REASON':
      return `${committee}: أُنهيت العضوية بصفة ${seat} دون ذكر سبب.`;
  }
}

/** The notice in both languages. Call only with at least one line: no lines, no notice. */
export function transferNoticeText(f: TransferNoticeFacts): TransferNoticeText {
  const unitEn = f.newUnit ? f.newUnit.nameEn : 'another unit';
  const unitAr = f.newUnit ? `«${ar(f.newUnit)}»` : 'وحدة أخرى';
  const titleEn = `${f.personName} was transferred to ${unitEn}`;
  const titleAr = `تم نقل ${f.personName} إلى ${unitAr}`;
  return {
    titleEn,
    titleAr,
    bodyEn: [
      `${titleEn}.`,
      ...f.lines.map((l) => lineEn(l, unitEn)),
      `Anyone with "${REMOVE_PERMISSION.en}" can remove a seat.`,
    ].join(' '),
    bodyAr: [
      `${titleAr}.`,
      ...f.lines.map((l) => lineAr(l, unitAr)),
      `تتيح صلاحية «${REMOVE_PERMISSION.ar}» إزالة المقعد.`,
    ].join(' '),
  };
}

/** What a committee contributes: who is told about it, before anyone is left out. */
export interface CommitteeAudience {
  committeeId: string;
  /** Active holders of the `chairman` and `secretary` seats. */
  officerIds: string[];
  /** The owning unit's head holders (two during a handover). */
  headIds: string[];
  /** The acting cover in force on the owning unit, if any: told INSTEAD of the head. */
  coverId: string | null;
}

/**
 * Who is told about which committees: per committee its officers, and its owning
 * unit's cover in force or else its head; then deduplicated, so each person gets
 * one notice. The transferred person and the actor are never told. Whether each
 * recipient is ACTIVE is decided afterwards, from one read.
 *
 * The committee order is kept: a reader's lines follow `audiences`' order.
 */
export function recipientsByCommittee(
  audiences: readonly CommitteeAudience[],
  exclude: { personId: string; actorId: string },
): Map<string, string[]> {
  const byRecipient = new Map<string, string[]>();
  for (const a of audiences) {
    const told = new Set([...a.officerIds, ...(a.coverId ? [a.coverId] : a.headIds)]);
    told.delete(exclude.personId);
    told.delete(exclude.actorId);
    for (const userId of told) {
      const list = byRecipient.get(userId) ?? [];
      if (!list.includes(a.committeeId)) list.push(a.committeeId);
      byRecipient.set(userId, list);
    }
  }
  return byRecipient;
}
