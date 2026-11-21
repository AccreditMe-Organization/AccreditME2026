import type { TranslateService } from '@ngx-translate/core';
import type { LanguageService } from '../../core/services/language.service';
import type { MeetingAttendanceRowDto } from './services/meeting.service';

export interface MeetingOwnerOption {
  value: string;
  label: string;
}

/**
 * ACC-316 PR 7b, shared by ACC-322 — who may own an action item, as Raise
 * action item and an AI action suggestion's inline Edit both offer it: the
 * meeting's invitees who are people of the organisation ("Name · seat", or
 * "Name · Guest"). An outside guest has no user and never owns one. Read the
 * language inside a computed() that calls this, so the seat follows a switch.
 */
export function actionOwnerOptions(attendance: readonly MeetingAttendanceRowDto[], language: LanguageService, translate: TranslateService): MeetingOwnerOption[] {
  return attendance
    .filter((r) => !!r.userId)
    .map((r) => ({
      value: r.userId!,
      label: `${r.name} · ${r.kind === 'MEMBER' && r.seat ? language.bilingual(r.seat.labelEn, r.seat.labelAr) : (translate.instant(r.kind === 'MEMBER' ? 'meeting.agendaItem.member' : 'meeting.invitees.guest') as string)}`,
    }));
}
