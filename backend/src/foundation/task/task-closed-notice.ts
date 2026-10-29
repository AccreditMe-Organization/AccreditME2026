/**
 * ACC-271 PR 4 (plan §7) — what a person is told when their task closes because
 * of someone else's action. In-app only; both languages are stored, as the
 * other task notices are. Arabic is passive and gender-neutral (the table in
 * plan §7, and Ahmad's 4th wording of 29 Oct).
 *
 *   MOVED       a stage decision moved the record on (an ADVANCE: an Any one
 *               stage decided, or any forward move that closed optional work)
 *   SENT_BACK   a RETURN
 *   ENDED       an EXIT
 *   COMPLETED   another assignee completed the task; no stage moved
 *
 * The record is named only for someone who may open it (ACC-228's rule); for
 * anyone else it is the record type ("the committee"). The 4th wording drops
 * "on {record}" when there is not even a type to say.
 */

export type ClosedNoticeKind = 'MOVED' | 'SENT_BACK' | 'ENDED' | 'COMPLETED';

export interface Named {
  nameEn: string;
  nameAr: string | null;
}

export interface ClosedNoticeFacts {
  kind: ClosedNoticeKind;
  task: { title: string; titleAr: string | null };
  actorName: string;
  recordType: string;
  /** The record's name, or null when the reader may not open it (or it has none). */
  record: Named | null;
  /** MOVED and SENT_BACK: where the record went. */
  stage?: Named;
  /** ENDED: the move that ended it. */
  transition?: { labelEn: string; labelAr: string | null };
}

/**
 * The record type in words, for a reader who may not see its name. The Arabic
 * nouns agree with the table's feminine verbs for committees; a module whose
 * record is a masculine noun (meetings, documents) needs its own verb forms
 * when it first sends these notices.
 */
const RECORD_TYPE_WORDS: Readonly<Record<string, { en: string; ar: string }>> = {
  COMMITTEE: { en: 'the committee', ar: 'اللجنة' },
  // A change request is part of its committee's record (ACC-239).
  COMMITTEE_CHANGE_REQUEST: { en: 'the committee', ar: 'اللجنة' },
};

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const ar = (n: Named): string => n.nameAr ?? n.nameEn;

/** The sentence in both languages. */
export function closedNoticeText(f: ClosedNoticeFacts): { en: string; ar: string } {
  const taskEn = f.task.title;
  const taskAr = f.task.titleAr ?? f.task.title;
  const typeWords = RECORD_TYPE_WORDS[f.recordType];
  const recordEn = f.record ? f.record.nameEn : (typeWords?.en ?? 'the record');
  const recordAr = f.record ? `«${ar(f.record)}»` : (typeWords?.ar ?? 'السجل');
  const actor = f.actorName;

  switch (f.kind) {
    case 'MOVED': {
      const stage = f.stage!;
      return {
        en: `Your task "${taskEn}" is closed. ${actor} approved ${recordEn}, so it moved to ${stage.nameEn}.`,
        ar: `أُغلقت مهمتك «${taskAr}»: انتقلت ${recordAr} إلى «${ar(stage)}» باعتماد من ${actor}.`,
      };
    }
    case 'SENT_BACK': {
      const stage = f.stage!;
      return {
        en: `Your task "${taskEn}" is closed. ${capitalise(recordEn)} was sent back to ${stage.nameEn} by ${actor}.`,
        ar: `أُغلقت مهمتك «${taskAr}»: أُعيدت ${recordAr} إلى «${ar(stage)}» بقرار من ${actor}.`,
      };
    }
    case 'ENDED': {
      const t = f.transition!;
      return {
        en: `Your task "${taskEn}" is closed. ${capitalise(recordEn)} was ended (${t.labelEn}) by ${actor}.`,
        ar: `أُغلقت مهمتك «${taskAr}»: أُنهيت ${recordAr} («${t.labelAr ?? t.labelEn}») بقرار من ${actor}.`,
      };
    }
    case 'COMPLETED': {
      // No name and no type to say: the "on …" part is dropped.
      const onEn = f.record || typeWords ? ` on ${recordEn}` : '';
      const onAr = f.record || typeWords ? ` في ${recordAr}` : '';
      return {
        en: `Your task "${taskEn}"${onEn} is closed: ${actor} completed it.`,
        ar: `أُغلقت مهمتك «${taskAr}»${onAr}: أُنجزت من قِبل ${actor}.`,
      };
    }
  }
}

/** Where "Open record" goes: a committee page for a committee and its change requests; nothing else has a page yet. */
export function recordLinkTarget(recordType: string, recordId: string, committeeId: string | null): { objectType: string; objectId: string } | null {
  if (recordType === 'COMMITTEE') return { objectType: 'COMMITTEE', objectId: recordId };
  if (recordType === 'COMMITTEE_CHANGE_REQUEST' && committeeId) return { objectType: 'COMMITTEE', objectId: committeeId };
  return null;
}
