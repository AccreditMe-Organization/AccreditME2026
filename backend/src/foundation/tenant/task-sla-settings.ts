import { ITaskSlaSettings } from './interfaces/tenant.interface';

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
