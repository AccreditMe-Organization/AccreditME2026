import type { PeopleDate } from '../task/task-sla.service';
import type { OutsideEmailText } from '../notification/outside-email';
import type { OrganisationNames } from './meeting-send';

/**
 * ACC-316 — every meeting notice's words, in English and Arabic, in ONE place:
 * the effects (meeting-effects.ts), the invitee sync, the people and agenda
 * writes all build their text here (plan step-316 §3.9). A notice that names a
 * time is given it already worded (peopleDateIn(), the organisation's zone,
 * Latin digits). No count is stored in a notice. The Arabic addresses no one by a
 * gendered verb: a person is named in a noun phrase (Ahmad, 6 Nov).
 *
 * An outside guest's email is the product's plain subject plus one paragraph
 * (R4-3): no link into AccreditMe, no papers, no minutes. The meeting's own
 * place and online link are given (the link is not ours).
 */

export interface NoticeText {
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

export interface MeetingPlace {
  location: string | null;
  meetingUrl: string | null;
}

export function invitationNotice(title: string, when: PeopleDate | null): NoticeText {
  return {
    titleEn: 'Meeting invitation',
    titleAr: 'دعوة إلى اجتماع',
    bodyEn: `You're invited to ${title}${when ? ` on ${when.en}` : ''}. The agenda is issued.`,
    bodyAr: `دعوة إلى ${title}${when ? ` في ${when.ar}` : ''}. صدرت الأجندة.`,
  };
}

export function rescheduledNotice(title: string, when: PeopleDate, reason: string): NoticeText {
  return {
    titleEn: 'Meeting rescheduled',
    titleAr: 'إعادة جدولة اجتماع',
    bodyEn: `${title} moves to ${when.en}. Reason: ${reason}`,
    bodyAr: `تغيّر موعد ${title} إلى ${when.ar}. السبب: ${reason}`,
  };
}

export function cancelledNotice(title: string, reason: string): NoticeText {
  return {
    titleEn: 'Meeting cancelled',
    titleAr: 'إلغاء اجتماع',
    bodyEn: `${title} is cancelled. Reason: ${reason}`,
    bodyAr: `أُلغي ${title}. السبب: ${reason}`,
  };
}

/** The agenda changed after it was issued: the invited are told again, with what changed. */
export function agendaChangedNotice(title: string, change: { en: string; ar: string }): NoticeText {
  return {
    titleEn: 'Agenda changed',
    titleAr: 'تغيّرت الأجندة',
    bodyEn: `The agenda for ${title} changed: ${change.en}`,
    bodyAr: `تغيّرت أجندة ${title}: ${change.ar}`,
  };
}

/** Why a "Can't attend" is flagged to the scheduler (plan §3.4). */
export interface CantAttendFlags {
  belowQuorum: boolean;
  officer: boolean;
  presenter: boolean;
}

export function cantAttendNotice(person: string, title: string, note: string | null, flags: CantAttendFlags): NoticeText {
  const flaggedEn = [
    flags.belowQuorum ? 'Attending is now below the quorum.' : null,
    flags.officer ? 'They hold the Chair or Secretary seat.' : null,
    flags.presenter ? 'They present an agenda item.' : null,
  ].filter(Boolean);
  const flaggedAr = [
    flags.belowQuorum ? 'أصبح عدد الحاضرين أقل من النصاب.' : null,
    flags.officer ? 'الاعتذار من مقعد الرئيس أو أمين السر.' : null,
    flags.presenter ? 'الاعتذار يخص تقديم بند في الأجندة.' : null,
  ].filter(Boolean);
  const flagged = flaggedEn.length > 0;
  return {
    titleEn: flagged ? `Can't attend — needs your attention` : `Can't attend`,
    titleAr: flagged ? 'اعتذار عن الحضور — يستدعي انتباهك' : 'اعتذار عن الحضور',
    bodyEn: [`${person} can't attend ${title}.`, note ? `Note: ${note}` : null, ...flaggedEn].filter(Boolean).join(' '),
    bodyAr: [`اعتذار ${person} عن حضور ${title}.`, note ? `ملاحظة: ${note}` : null, ...flaggedAr].filter(Boolean).join(' '),
  };
}

function placeLine(place: MeetingPlace): { en: string; ar: string } {
  const en = [place.location ? `Location: ${place.location}.` : null, place.meetingUrl ? `Online: ${place.meetingUrl}` : null];
  const ar = [place.location ? `المكان: ${place.location}.` : null, place.meetingUrl ? `عبر الإنترنت: ${place.meetingUrl}` : null];
  return { en: en.filter(Boolean).join(' '), ar: ar.filter(Boolean).join(' ') };
}

/** The outside guest's invitation email: subject plus one paragraph, no link into AccreditMe. */
export function outsideInvitationEmail(title: string, organisation: OrganisationNames, when: PeopleDate, place: MeetingPlace): OutsideEmailText {
  const p = placeLine(place);
  return {
    subjectEn: `Invitation: ${title}`,
    subjectAr: `دعوة: ${title}`,
    bodyEn: `${organisation.en} invites you to ${title} on ${when.en}. ${p.en}`.trim(),
    bodyAr: `يدعوك ${organisation.ar} إلى ${title} في ${when.ar}. ${p.ar}`.trim(),
  };
}

export function outsideRescheduledEmail(title: string, organisation: OrganisationNames, when: PeopleDate, reason: string): OutsideEmailText {
  return {
    subjectEn: `Rescheduled: ${title}`,
    subjectAr: `تغيّر الموعد: ${title}`,
    bodyEn: `${organisation.en} has moved ${title} to ${when.en}. Reason: ${reason}`,
    bodyAr: `غيّر ${organisation.ar} موعد ${title} إلى ${when.ar}. السبب: ${reason}`,
  };
}

export function outsideCancelledEmail(title: string, organisation: OrganisationNames, reason: string): OutsideEmailText {
  return {
    subjectEn: `Cancelled: ${title}`,
    subjectAr: `أُلغي: ${title}`,
    bodyEn: `${organisation.en} has cancelled ${title}. Reason: ${reason}`,
    bodyAr: `ألغى ${organisation.ar} ${title}. السبب: ${reason}`,
  };
}

/** A member who presents an item has left the committee or unit: they stay invited as a guest (lane B's review, fix 1). */
export function presenterLeftNotice(person: string, items: readonly string[], title: string): NoticeText {
  const en = items.map((i) => `"${i}"`).join(', ');
  const ar = items.map((i) => `«${i}»`).join('، ');
  return {
    titleEn: 'A presenter left the committee or unit',
    titleAr: 'بند يقدَّم الآن من ضيف',
    bodyEn: `${person} presents ${en} at ${title} and has left the committee or unit. They stay invited as a guest.`,
    bodyAr: `${person}: انتهاء العضوية في اللجنة أو الوحدة، مع تقديم ${ar} في ${title}. الدعوة باقية بصفة ضيف.`,
  };
}
