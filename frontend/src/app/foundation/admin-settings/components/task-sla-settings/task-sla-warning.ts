import { TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import { TaskSlaWarnBeforeDue } from '../../../tenant/services/tenant.service';

/**
 * ACC-313 PR 4 — the "warn before due" options, and the rule that a warning
 * is shorter than its priority's limit (Q2). The server holds the same rule
 * (`warningFitsLimit`, task-sla-settings.ts) and refuses a save that breaks
 * it; this copy only greys out the options it would refuse, so the select
 * never offers a choice the Save would turn down.
 */
export const WARN_BEFORE_DUE_OPTIONS: readonly TaskSlaWarnBeforeDue[] = ['OFF', 'H1', 'H2', 'H4', 'H8', 'WORKING_DAY'];

/** A warning as working hours: 0 for Off, the hour options, the calendar's day for WORKING_DAY. */
export function warnHours(option: TaskSlaWarnBeforeDue, hoursPerDay: number): number {
  switch (option) {
    case 'OFF':
      return 0;
    case 'H1':
      return 1;
    case 'H2':
      return 2;
    case 'H4':
      return 4;
    case 'H8':
      return 8;
    case 'WORKING_DAY':
      return hoursPerDay;
  }
}

/** Off always fits; any other warning must be strictly shorter than the limit. */
export function warningFitsLimit(option: TaskSlaWarnBeforeDue, limitHours: number, hoursPerDay: number): boolean {
  return option === 'OFF' || warnHours(option, hoursPerDay) < limitHours;
}

export function isWarnBeforeDue(value: unknown): value is TaskSlaWarnBeforeDue {
  return typeof value === 'string' && (WARN_BEFORE_DUE_OPTIONS as readonly string[]).includes(value);
}

/**
 * An option as a person reads it: "Off", "1 working day", or its hours through
 * the formatting layer ("2 working hours" / «ساعتا عمل») — never a unit
 * written onto a number by hand.
 */
export function warnOptionLabel(value: TaskSlaWarnBeforeDue, translate: TranslateService, format: FormatService): string {
  if (value === 'OFF') return translate.instant('adminSettings.taskSlaPage.warn.off');
  if (value === 'WORKING_DAY') return translate.instant('adminSettings.taskSlaPage.warn.workingDay');
  return format.count('workflow.workingHours', warnHours(value, 0));
}
