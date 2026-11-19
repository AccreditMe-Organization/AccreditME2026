import type { Named, TransferNoticeText } from '../transfer-notice/committee-transfer-notice';

/**
 * ACC-306 — what a committee's officers are told when a member's account is
 * deactivated and their seats end. In-app only; both languages are stored, and
 * each reader sees their own.
 *
 * Arabic is gender-neutral: no verb has the person as its subject («أُلغي تفعيل
 * حساب» is passive, about the account) and every line's verb is about the
 * membership (العضوية). A committee is named only for a reader who may open it;
 * anyone else reads "a committee" (ACC-297's rule).
 */

export interface DepartureNoticeLine {
  /** null for a reader who may not open the committee. */
  committee: Named | null;
  seat: Named | null;
}

const ar = (n: Named): string => n.nameAr ?? n.nameEn;

/** The permission as the Roles screen names it (permissions.sentence['committees:add_member']). */
const ADD_PERMISSION = { en: 'Add members to a committee', ar: 'إضافة أعضاء إلى اللجنة' };

/**
 * The notice in both languages; call only with at least one line. The title is
 * the whole text, as ACC-297's notice stores it: the bell shows only the title.
 */
export function departureNoticeText(f: { personName: string; lines: readonly DepartureNoticeLine[] }): TransferNoticeText {
  const en = [
    `${f.personName}'s account was deactivated, so their committee seats ended.`,
    ...f.lines.map((l) => `${l.committee ? l.committee.nameEn : 'A committee'}: ${l.seat ? `the ${l.seat.nameEn} seat` : 'a seat'} ended.`),
    `Anyone with "${ADD_PERMISSION.en}" can fill a seat.`,
  ].join(' ');
  const arText = [
    `أُلغي تفعيل حساب «${f.personName}»، فانتهت العضوية في اللجان.`,
    ...f.lines.map((l) => `${l.committee ? `«${ar(l.committee)}»` : 'لجنة'}: انتهت العضوية بصفة ${l.seat ? `«${ar(l.seat)}»` : 'مقعد'}.`),
    `تتيح صلاحية «${ADD_PERMISSION.ar}» شغل المقعد.`,
  ].join(' ');
  return { titleEn: en, titleAr: arText, bodyEn: en, bodyAr: arText };
}

/**
 * The admins' departure notice gains this clause (user.service.ts), counted in
 * each language's plural forms, and left out at zero.
 */
export const DEPARTURE_SUMMARY_COMMITTEE_SEATS = {
  en: { one: '{count} committee seat ended.', other: '{count} committee seats ended.' },
  ar: {
    zero: 'لم تنتهِ أي عضوية في لجنة.',
    one: 'انتهت عضوية واحدة في لجنة.',
    two: 'انتهت عضويتان في اللجان.',
    few: 'انتهت {count} عضويات في اللجان.',
    many: 'انتهت {count} عضوية في اللجان.',
    other: 'انتهت {count} عضوية في اللجان.',
  },
} as const;
