import type { LanguageService } from '../../core/services/language.service';
import { MEETING_STAGE_FLAG, type MeetingOwnerDto, type MeetingStageDto } from './services/meeting.service';

/**
 * ACC-316 PR 6 — how a meeting's owner and stage read on every meeting screen,
 * in ONE place. Names are tenant data, chosen by language (ACC-160); what a
 * stage means is its flags (never its name or key, ACC-255).
 */

/** ◇ a committee, ▣ a unit (the design's glyphs, decorative). */
export function ownerGlyph(owner: Pick<MeetingOwnerDto, 'kind'>): string {
  return owner.kind === 'COMMITTEE' ? '◇' : '▣';
}

export function ownerName(owner: Pick<MeetingOwnerDto, 'nameEn' | 'nameAr'>, language: Pick<LanguageService, 'bilingual'>): string {
  return language.bilingual(owner.nameEn, owner.nameAr);
}

/** The owner's own page: a committee's record, or a unit's. */
export function ownerLink(owner: Pick<MeetingOwnerDto, 'kind' | 'id'>): string[] {
  return owner.kind === 'COMMITTEE' ? ['/committees', owner.id] : ['/organization/units', owner.id];
}

export function stageName(stage: Pick<MeetingStageDto, 'nameEn' | 'nameAr'>, language: Pick<LanguageService, 'bilingual'>): string {
  return stage.nameEn || stage.nameAr ? language.bilingual(stage.nameEn ?? stage.nameAr ?? '', stage.nameAr) : '—';
}

export function isCancelled(stage: Pick<MeetingStageDto, 'flags'>): boolean {
  return stage.flags.includes(MEETING_STAGE_FLAG.MEETING_CANCELLED);
}

/** Muted in lists: the meeting is over (cancelled or its minutes approved). */
export function isClosed(stage: Pick<MeetingStageDto, 'flags'>): boolean {
  return isCancelled(stage) || stage.flags.includes(MEETING_STAGE_FLAG.MINUTES_FINAL);
}
