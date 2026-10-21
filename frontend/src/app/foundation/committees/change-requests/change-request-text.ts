import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../core/formatting';
import { LanguageService } from '../../../core/services/language.service';
import { refusalBody, refusalCode } from '../../../core/http/refusal';
import { committeeRefusal } from '../committee-references';
import { CHANGE_FIELDS, ChangeField, ChangeImpactDto, ChangeRequestLabelsDto, ChangeValue, ChangeValues } from './change-request.service';

/**
 * ACC-240 — every word the change request screens say about a request, in one
 * place: field names, values, statuses, impact lines and refusals. It decides
 * nothing about who may act — that is the server's `actions` and `canRaise`.
 *
 * Values that are ids (type, owning unit, parent, reports to) are named from
 * the response's own `labels` (PR 3a), so a closed request still names a value
 * deactivated since. An id the labels do not name shows "—".
 */

/** The fields whose value is an id, named from `labels`. */
const LABELLED: ReadonlySet<ChangeField> = new Set<ChangeField>(['typeValueId', 'orgUnitId', 'parentCommitteeId', 'reportingToCommitteeId']);
/** Where an empty value means "none", not "not given". */
const NONE_WHEN_EMPTY: ReadonlySet<ChangeField> = new Set<ChangeField>(['parentCommitteeId', 'reportingToCommitteeId']);
/** Long text: listed in words as "changed", not quoted in full (the Approve dialog). */
const LONG_TEXT: ReadonlySet<ChangeField> = new Set<ChangeField>(['purpose']);

/** Server could not be reached, or timed out: the one case that offers Retry (rule 5.5). */
const UNREACHABLE = new Set([0, 408, 502, 503, 504]);

/** The Approve dialog lists this many changes before "… and N more" (step 238, Q14). */
export const APPROVE_LIST_MAX = 6;

/** The refusal codes said in words; anything else is the generic failure. */
const REFUSAL_CODES = new Set([
  'CHANGE_REQUEST_STAGE_NOT_ALLOWED',
  'CHANGE_REQUEST_ALREADY_OPEN',
  'CHANGE_REQUEST_NO_CHANGES',
  'CHANGE_REQUEST_QUORUM_MIN',
  'CHANGE_REQUEST_NOT_REQUESTER',
  'CHANGE_REQUEST_NOT_ALLOWED',
  'CHANGE_REQUEST_OWN_DECISION',
  'CHANGE_REQUEST_NOT_EDITABLE',
  'CHANGE_REQUEST_NOT_UNDER_REVIEW',
  'CHANGE_REQUEST_NOT_OPEN',
  'CHANGE_REQUEST_COMMITTEE_DISSOLVING',
  'CHANGE_REQUEST_COMMITTEE_CHANGED',
  'CHANGE_REQUEST_CHANGED',
]);

/** A refusal said in words, and what it offers. */
export interface ChangeRequestRefusalText {
  code: string | null;
  text: string;
  /** Only when the server could not be reached (rule 5.5). */
  retry: boolean;
  /** CHANGE_REQUEST_CHANGED: the record moved under the person (Reload, never Retry). */
  reload: boolean;
  /** CHANGE_REQUEST_ALREADY_OPEN: the open request to go to. */
  openRequestId: string | null;
  /** An ACC-233 reference refusal belongs under this field. */
  field: ChangeField | null;
}

export interface ImpactLineText {
  key: string;
  value: string;
}

export function isUnreachable(err: unknown): boolean {
  return err instanceof HttpErrorResponse && UNREACHABLE.has(err.status);
}

/** The fields a set of values changes, in the screens' order. */
export function changedFields(changes: ChangeValues | null | undefined): ChangeField[] {
  if (!changes) return [];
  return CHANGE_FIELDS.filter((f) => f in changes);
}

@Injectable({ providedIn: 'root' })
export class ChangeRequestText {
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  fieldLabel(field: ChangeField): string {
    return this.translate.instant(`committee.changeRequest.field.${field}`);
  }

  /** "Quorum, Reports to and Owning unit" — in the language's own list words. */
  fieldList(fields: readonly ChangeField[]): string {
    return this.joinList(fields.map((f) => this.fieldLabel(f)));
  }

  /** As fieldList, collapsed to "Quorum, Reports to and 5 more" past `max`. */
  fieldListCapped(fields: readonly ChangeField[], max: number): string {
    if (fields.length <= max) return this.fieldList(fields);
    const shown = fields.slice(0, 2).map((f) => this.fieldLabel(f)).join(this.translate.instant('committee.changeRequest.list.separator') + ' ');
    return this.format.count('committee.changeRequestAndMore', fields.length - 2, { fields: shown });
  }

  private joinList(items: string[]): string {
    if (items.length <= 1) return items[0] ?? '';
    const sep = this.translate.instant('committee.changeRequest.list.separator') + ' ';
    const head = items.slice(0, -1).join(sep);
    return this.translate.instant('committee.changeRequest.list.and', { a: head, b: items[items.length - 1] });
  }

  /** A value as a person reads it. */
  value(field: ChangeField, value: ChangeValue | undefined, labels: ChangeRequestLabelsDto): string {
    if (value === null || value === undefined || value === '') {
      return NONE_WHEN_EMPTY.has(field) ? this.translate.instant('committee.changeRequest.page.none') : '—';
    }
    if (LABELLED.has(field)) {
      const label = labels[String(value)];
      return label ? this.language.bilingual(label.en, label.ar) : '—';
    }
    if (field === 'meetingFrequency') return this.translate.instant(`committee.frequency.${String(value).toLowerCase()}`);
    if (field === 'quorumCount') return this.format.number(Number(value));
    return String(value);
  }

  /** "Quorum: 5 → 6" (the arrow mirrors in Arabic, so the old value reads first). Long text says "changed". */
  span(field: ChangeField, from: ChangeValue | undefined, to: ChangeValue | undefined, labels: ChangeRequestLabelsDto): string {
    const label = this.fieldLabel(field);
    if (LONG_TEXT.has(field)) return this.translate.instant('committee.changeRequest.approve.changedText', { field: label });
    return this.translate.instant('committee.changeRequest.impact.span', {
      field: label,
      from: this.value(field, from, labels),
      to: this.value(field, to, labels),
    });
  }

  status(key: string | null): string {
    const known = ['draft', 'under_review', 'returned', 'approved', 'rejected', 'withdrawn'];
    return this.translate.instant(`committee.changeRequest.status.${key && known.includes(key) ? key : 'unknown'}`);
  }

  /** One impact line, in words, from the server's code and numbers. */
  impact(impact: ChangeImpactDto, labels: ChangeRequestLabelsDto, requesterName: string): ImpactLineText {
    const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(`committee.changeRequest.impact.${key}`, params);
    switch (impact.code) {
      case 'QUORUM':
        return {
          key: this.span('quorumCount', impact.from, impact.to, labels),
          value: impact.inProgress > 0
            ? t('QUORUM', { from: this.format.number(Number(impact.from)), to: this.format.number(Number(impact.to)) })
            : t('QUORUM_NONE', { to: this.format.number(Number(impact.to)) }),
        };
      case 'NAME':
        return { key: this.translate.instant('committee.changeRequest.impact.nameKey'), value: t('NAME') };
      case 'TYPE':
        return { key: this.fieldLabel('typeValueId'), value: t('TYPE') };
      case 'PURPOSE':
        return { key: this.fieldLabel('purpose'), value: t('PURPOSE') };
      case 'MEETING_FREQUENCY':
        return { key: this.span('meetingFrequency', impact.from, impact.to, labels), value: t('MEETING_FREQUENCY') };
      case 'OWNING_UNIT':
        return { key: this.span('orgUnitId', impact.from, impact.to, labels), value: t('OWNING_UNIT') };
      case 'PARENT':
        return { key: this.span('parentCommitteeId', impact.from, impact.to, labels), value: t(impact.to ? 'PARENT' : 'PARENT_NONE') };
      case 'REPORTS_TO':
        return { key: this.span('reportingToCommitteeId', impact.from, impact.to, labels), value: t(impact.to ? 'REPORTS_TO' : 'REPORTS_TO_NONE') };
      case 'TERMS_TASK':
        return { key: t('TERMS_TASK_KEY'), value: t('TERMS_TASK', { name: requesterName }) };
    }
  }

  /** A refused or failed call, said from its code — never the server's English message. */
  refusal(err: unknown, requestNumber: number | null = null): ChangeRequestRefusalText {
    const base: ChangeRequestRefusalText = { code: null, text: '', retry: false, reload: false, openRequestId: null, field: null };
    if (isUnreachable(err)) {
      return { ...base, text: this.translate.instant('committee.changeRequest.refusal.unreachable'), retry: true };
    }
    const code = refusalCode(err);
    if (code && REFUSAL_CODES.has(code)) {
      const body = refusalBody(err) ?? {};
      const n = typeof body['number'] === 'number' ? body['number'] : requestNumber;
      return {
        ...base,
        code,
        text: this.translate.instant(`committee.changeRequest.refusal.${code}`, { n: n ?? '' }),
        reload: code === 'CHANGE_REQUEST_CHANGED',
        openRequestId: code === 'CHANGE_REQUEST_ALREADY_OPEN' && typeof body['id'] === 'string' ? body['id'] : null,
      };
    }
    if (code && code.startsWith('COMMITTEE_')) {
      const r = committeeRefusal(err);
      return { ...base, code, text: this.translate.instant(r.key), field: r.field };
    }
    return { ...base, code, text: this.translate.instant('committee.changeRequest.refusal.failed') };
  }
}
