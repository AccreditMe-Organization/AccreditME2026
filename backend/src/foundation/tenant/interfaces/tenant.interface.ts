import { IAiBalance, IAiFeatureOpen, IAiFeatureUsage } from '../../ai/ai-balance';
import type { IMaskedEmailConfig } from '../email-config';
export interface ITenant {
  id: string;
  name: string;
  // ACC-120 — nullable, and every reader has to cope with that: a tenant that
  // has never opened Organization Profile has no Arabic name, and there is
  // nothing to derive one from. NOT on ITenantEntitlements, deliberately —
  // that is the ungated payload every signed-in user receives, and putting a
  // name there is its own decision in its own ticket.
  nameAr: string | null;
  slug: string;
  country: string;
  // No timezone (ACC-97): the organisation's time zone is the working
  // calendar's, read through WorkingCalendarService.getEffectiveTimeZone().
  language: string;
  authProvider: 'LOCAL' | 'AZURE_AD' | 'GOOGLE';
  storageProvider: 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM' | 'SHAREPOINT';
  aiProvider: 'ANTHROPIC' | 'AZURE_OPENAI' | 'OPENAI' | 'OLLAMA';
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'OFFBOARDING';
  trialEndsAt: Date | null;
  maxUsers: number;
  maxStorageGb: number;
  isBootstrapped: boolean;
  bootstrappedAt: Date | null;
  logo: string | null;
  // Mirrors PlatformGuard's own check — the frontend uses this (never a
  // permission string alone) to decide whether to show the Super Admin nav
  // section, same two-part requirement as the backend guard.
  isPlatformOrg: boolean;
  // Derived from Organization.settings — the frontend navigation's one-stop
  // source for "what am I licensed to see" (ACC-13). No dedicated endpoint.
  modules: Record<string, boolean>;
  // ACC-194 — from the AI columns, not settings.ai. `usage`: what this period's
  // credits went on, per feature, from the AI log (ACC-120 slice 8).
  ai: IAiBalance & { features: IAiFeatureOpen[]; usage: IAiFeatureUsage[] };
  createdAt: Date;
  updatedAt: Date;
}

// ACC-79 — the navigation-safe slice of a tenant, readable by every signed-in
// user of it. Deliberately NOT a subset projection of ITenant with fields left
// undefined: a separate type means a field cannot leak onto this endpoint by
// someone adding it to ITenant. Provider configuration, plan limits, trial
// dates and AI credit balances stay on GET /tenant behind tenant:view.
export interface ITenantEntitlements {
  name: string;
  // ACC-161 — the organisation's Arabic name, so the shell can name the tenant
  // in an Arabic session. NULL when the tenant has not set one; choosing which
  // name to SHOW is the frontend's job (LanguageService.bilingual), so it is
  // passed through as stored, never substituted with the English name here.
  //
  // Adding it here was a decision, not a convenience: this type exists so that
  // nothing leaks onto the ungated payload by accident. An organisation's name
  // is not sensitive (Ahmad, ACC-161) — every signed-in user already sees the
  // English one in the breadcrumb. SYSTEM-REFERENCE §1.8.
  nameAr: string | null;
  slug: string;
  // Mirrors PlatformGuard's organization half. The frontend still requires
  // platform:admin as well before treating anyone as a platform admin.
  isPlatformOrg: boolean;
  // Absent key = the module is not usable by this tenant, for any reason.
  modules: Record<string, 'FULL' | 'READ_ONLY'>;
}

export interface ITenantConfig {
  authProvider: 'LOCAL' | 'AZURE_AD' | 'GOOGLE';
  storageProvider: 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM' | 'SHAREPOINT';
  aiProvider: 'ANTHROPIC' | 'AZURE_OPENAI' | 'OPENAI' | 'OLLAMA';
  // ACC-177 — masked: 'set' when a config is stored, never its contents.
  authConfig: 'set' | null;
  storageConfig: 'set' | null;
  aiConfig: 'set' | null;
}

// ACC-181 — the MASKED email settings: each secret reads 'set' or null, never
// its value. The shape and the masking live in ../email-config.ts.
export type IEmailConfig = IMaskedEmailConfig;

// ACC-46 Section 2.7.c — stored at Organization.settings.taskSla. Two
// tenant-configurable grace periods per priority, both allowed to be 0
// (immediate): managerEscalationAfterHours counts from Task.dueAt,
// headEscalationAfterHours is an ADDITIONAL grace period counted from when
// the Manager tier fires, not from dueAt again. ACC-313 (Q1): both are
// WORKING hours, on the organisation's calendar, like dueAfterHours.
export interface ITaskSlaTier {
  dueAfterHours: number;
  managerEscalationAfterHours: number;
  headEscalationAfterHours: number;
}

export interface ITaskSlaSettings {
  LOW: ITaskSlaTier;
  MEDIUM: ITaskSlaTier;
  HIGH: ITaskSlaTier;
  CRITICAL: ITaskSlaTier;
}

/**
 * ACC-313 — stored at Organization.settings.taskSlaNotices, a sibling of
 * taskSla so the six readers of the SLA numbers never learn about notices.
 * `warnBeforeDue` is how long before the due time a reminder goes, per
 * priority (nothing reads it yet); `notifyOnDueChange` says whether an edit
 * that moves a due date tells the assignees.
 */
export type TaskSlaWarnBeforeDue = 'OFF' | 'H1' | 'H2' | 'H4' | 'H8' | 'WORKING_DAY';

export interface ITaskSlaNotices {
  warnBeforeDue: Record<keyof ITaskSlaSettings, TaskSlaWarnBeforeDue>;
  notifyOnDueChange: boolean;
}

/** GET /tenant/task-sla/policy, and what Reset answers. */
export interface ITaskSlaPolicy {
  tiers: ITaskSlaSettings;
  notices: ITaskSlaNotices;
  /** ACC-313 PR 4 — the calendar's working day in hours: what "1 working day" means. */
  workingHoursPerDay: number;
}

/**
 * ACC-313 — one saved change to the task SLA policy, from the audit trail.
 * `kind` names what was saved: a section, the notices switch, or a reset to
 * the defaults; `legacy` is a save made before ACC-313, whose audit row
 * recorded no values, so `before` and `after` are null.
 */
export type TaskSlaChangeKind = 'limits' | 'escalation' | 'all' | 'notices' | 'reset' | 'legacy';

export interface ITaskSlaChange {
  id: string;
  changedAt: Date;
  actorName: string | null;
  kind: TaskSlaChangeKind;
  before: unknown;
  after: unknown;
}

export interface ITaskSlaHistoryPage {
  rows: ITaskSlaChange[];
  total: number;
}
