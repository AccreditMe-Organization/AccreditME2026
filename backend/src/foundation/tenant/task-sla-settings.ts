import { ITaskSlaNotices, ITaskSlaSettings, TaskSlaWarnBeforeDue } from './interfaces/tenant.interface';

// The priority SLA a tenant gets until it saves its own (ACC-46 Section
// 2.7.c). bootstrap() also writes it at tenant creation, so the settings page
// always shows a genuine saved row.
export const DEFAULT_TASK_SLA_SETTINGS: ITaskSlaSettings = {
  CRITICAL: { dueAfterHours: 4, managerEscalationAfterHours: 2, headEscalationAfterHours: 4 },
  HIGH: { dueAfterHours: 16, managerEscalationAfterHours: 8, headEscalationAfterHours: 16 },
  MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
  LOW: { dueAfterHours: 80, managerEscalationAfterHours: 48, headEscalationAfterHours: 96 },
};

/**
 * A tenant's task SLA, read from Organization.settings — the ONE reading of it.
 * TenantService.getTaskSla() and the task SLA limit (ACC-174) both come
 * through here, and so does the ACC-174 backfill, which runs outside the app
 * and must not grow a second copy of the default.
 */
export function taskSlaFromSettings(settings: unknown): ITaskSlaSettings {
  const taskSla = (settings as { taskSla?: ITaskSlaSettings } | null)?.taskSla;
  return taskSla ?? DEFAULT_TASK_SLA_SETTINGS;
}

/**
 * ACC-313 — how long before a task's due time its assignees are reminded, per
 * priority. Stored now, all Off; nothing reads it until the reminder sweep.
 */
export const WARN_BEFORE_DUE_VALUES: readonly TaskSlaWarnBeforeDue[] = ['OFF', 'H1', 'H2', 'H4', 'H8', 'WORKING_DAY'];

const NOTICE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/**
 * The notices a tenant gets until it saves its own: every reminder Off, and a
 * moved due date announced to the assignees. A missing key means these, so no
 * existing organisation needs a backfill.
 */
export const DEFAULT_TASK_SLA_NOTICES: ITaskSlaNotices = {
  warnBeforeDue: { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'OFF', CRITICAL: 'OFF' },
  notifyOnDueChange: true,
};

/**
 * A tenant's task SLA notices, read from Organization.settings.taskSlaNotices —
 * the ONE reading of them, beside taskSlaFromSettings(). Each value is checked
 * on its own and falls back to its default, so a partly written or unexpected
 * value can never switch a notice off by accident.
 */
export function taskSlaNoticesFromSettings(settings: unknown): ITaskSlaNotices {
  const stored = (settings as { taskSlaNotices?: unknown } | null)?.taskSlaNotices as
    | { warnBeforeDue?: Record<string, unknown>; notifyOnDueChange?: unknown }
    | null
    | undefined;
  const warn = {} as ITaskSlaNotices['warnBeforeDue'];
  for (const p of NOTICE_PRIORITIES) {
    const value = stored?.warnBeforeDue?.[p];
    warn[p] = (WARN_BEFORE_DUE_VALUES as readonly unknown[]).includes(value)
      ? (value as TaskSlaWarnBeforeDue)
      : DEFAULT_TASK_SLA_NOTICES.warnBeforeDue[p];
  }
  return {
    warnBeforeDue: warn,
    notifyOnDueChange:
      typeof stored?.notifyOnDueChange === 'boolean'
        ? stored.notifyOnDueChange
        : DEFAULT_TASK_SLA_NOTICES.notifyOnDueChange,
  };
}

/**
 * ACC-313 — a warning option as working hours: 0 for Off, the hours of an hour
 * option, and the organisation's working day for WORKING_DAY.
 */
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

/**
 * The rule (Q2): a warning that is not Off must be shorter than its priority's
 * limit. False for one at or past it, which cannot be saved and which the
 * sweep treats as Off (a calendar change can make WORKING_DAY one).
 */
export function warningFitsLimit(option: TaskSlaWarnBeforeDue, limitHours: number, hoursPerDay: number): boolean {
  return option === 'OFF' || warnHours(option, hoursPerDay) < limitHours;
}
