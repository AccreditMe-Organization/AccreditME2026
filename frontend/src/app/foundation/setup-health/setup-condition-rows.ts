import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FilesService } from '../../shared/files/files.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { LanguageService } from '../../core/services/language.service';
import { FormatService } from '../../core/formatting';
import { SetupConditionDto, SetupConditionFreshnessDto, SetupConditionSeverity } from './services/setup-health.service';

// ACC-279 — how ONE condition is worded, wherever it is shown: the Setup health
// page and Home's Needs fixing both build their rows here, so the two can never
// describe a condition, its age, or its Fix in different words. Moved unchanged
// from SetupHealthPageComponent (ACC-82 onward).

const DAY_MS = 24 * 60 * 60 * 1000;

// Where each Fix goes, and what the viewer must hold for the fix to work.
// BOTH permissions: the destination route's own, and the one its save needs —
// a Fix that opened a dialog whose save was then refused would be the
// disabled-without-a-reason trap in a different shape (§13.6).
export interface FixTarget {
  link: string[];
  queryParams: Record<string, string>;
  permissions: string[];
}

export function fixTargetFor(condition: SetupConditionDto): FixTarget | null {
  switch (condition.type) {
    case 'ORG_UNIT_WITHOUT_HEAD':
      return {
        link: ['/organization'],
        queryParams: { head: condition.objectId },
        permissions: ['org:view', 'org:manage'],
      };
    case 'ORG_UNIT_WITHOUT_TYPE':
      // ACC-137 — the same page, a different one-time parameter, because the
      // fix is editing the unit rather than appointing anyone.
      //
      // ACC-120 slice 11 (PR D) — the unit's own record, which opens its Edit
      // dialog for the one-time `edit` parameter.
      return {
        link: ['/organization/units', condition.objectId],
        queryParams: { edit: '1' },
        permissions: ['org:view', 'org:manage'],
      };
    case 'ACTING_HEAD_OPEN_ENDED':
      // The record, whose first panel is Headship: Set an end date is there.
      return {
        link: ['/organization/units', condition.objectId],
        queryParams: {},
        permissions: ['org:view', 'org:manage'],
      };
    case 'STAGE_WITHOUT_ASSIGNEE':
    // ACC-271 PR 5a — "Review stage": the same page, the stage open in its
    // editor panel, where who works it is set.
    case 'STAGE_ON_STARTING_ASSIGNMENT':
      // The template id is in the snapshot; without it there is no page to open.
      // ACC-255 PR 4a (Q-D): the stages page itself needs workflows:manage
      // (nav-items.ts), so a holder of workflows:view alone is never offered a
      // link the route would refuse. workflows:view stays for the page's reads.
      return condition.subject.templateId
        ? {
            link: ['/workflows', condition.subject.templateId, 'stages'],
            queryParams: { stage: condition.objectId },
            permissions: ['workflows:view', 'workflows:manage'],
          }
        : null;
    case 'TASK_WITHOUT_OWNER':
      return {
        // ACC-120 slice 3 — Unassigned is a saved view of /tasks; its row opens
        // Reassign for the task named here, when the server offers it.
        link: ['/tasks'],
        queryParams: { view: 'unassigned', reassign: condition.objectId },
        // ACC-244 — Manage tasks opens Unassigned AND reassigns from it.
        permissions: ['committees:manage_tasks'],
      };
    case 'STORAGE_ALMOST_FULL':
      // ACC-260 PR D — the recycle bin, where deleted files that still count
      // against the limit are purged. Its route and API need tenant:manage_config.
      return {
        link: ['/admin-settings/recycle-bin'],
        queryParams: {},
        permissions: ['tenant:manage_config'],
      };
    case 'STORAGE_ACCESS_WITHDRAWN':
    case 'STORAGE_SECRET_EXPIRING':
      // ACC-260 — File storage, which shows the withdrawn access or the
      // expiring secret with what to fix in Microsoft. Replace secret itself
      // arrives with the SharePoint PR (PR C).
      return {
        link: ['/admin-settings/storage'],
        queryParams: {},
        permissions: ['tenant:manage_config'],
      };
  }
}

export interface ConditionRow {
  id: string;
  severity: SetupConditionSeverity;
  objectName: string;
  context: string | null;
  consequence: string;
  // What to check, where the condition cannot say which cause applies.
  hint: string | null;
  age: string;
  openedAt: string;
  fix: { label: string; link: string[]; queryParams: Record<string, string> } | null;
  // Shown instead of a Fix the viewer could not use. Never a disabled button.
  fixNeeds: string | null;
  // ACC-271 PR 5a — "Keep this assignment", beside Review stage, for a stage on
  // its starting assignment; only where the Fix is offered (workflows:manage).
  keep: { stageId: string; stageName: string; adminName: string } | null;
}

// Whole class strings, never assembled from a tone name: Tailwind only
// generates classes it can find written out in the source.
export function severityChipClass(severity: SetupConditionSeverity): string {
  const base = 'flex-none text-[11px] font-semibold rounded px-[7px] py-px whitespace-nowrap border ';
  return severity === 'BLOCKS_WORK'
    ? base +
        'text-[var(--am-condition-blocks-ink)] bg-[var(--am-condition-blocks-bg)] border-[var(--am-condition-blocks-border)]'
    : base + 'text-[var(--am-condition-risk-ink)] bg-[var(--am-condition-risk-bg)] border-[var(--am-condition-risk-border)]';
}

@Injectable({ providedIn: 'root' })
export class SetupConditionRows {
  private readonly access = inject(NavigationAccessService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly files = inject(FilesService);

  severityLabel(severity: SetupConditionSeverity): string {
    return this.translate.instant(`setupHealth.severity.${severity}`);
  }

  /**
   * "Checked N ago": the OLDEST confirmation across types, so it never claims
   * more freshness than the stalest group has. Null when nothing has run.
   */
  lastChecked(freshness: SetupConditionFreshnessDto[], loadedAt: Date): string | null {
    const times = freshness
      .map((f) => f.computedAt)
      .filter((t): t is string => t !== null)
      .map((t) => new Date(t).getTime());
    if (times.length === 0) return null;
    return this.translate.instant('setupHealth.checked', {
      when: this.format.relative(new Date(Math.min(...times)), loadedAt),
    });
  }

  /** One condition as Setup health and Home both show it. */
  toRow(condition: SetupConditionDto, loadedAt: Date): ConditionRow {
    const target = fixTargetFor(condition);
    const permitted = !!target && target.permissions.every((p) => this.access.hasPermission(p));
    return {
      id: condition.id,
      severity: condition.severity,
      // ACC-271 PR 5a — drawn (section 11): the row's title is the condition
      // itself, and its sub-line names the workflow, the stage and whose the work is.
      objectName:
        condition.type === 'STAGE_ON_STARTING_ASSIGNMENT'
          ? this.translate.instant(`setupHealth.types.${condition.type}`)
          : this.objectName(condition),
      context: this.context(condition),
      consequence: this.consequence(condition),
      // A stage is unreachable because of its assignee OR a transition's
      // trigger, and the condition does not record which (§13.2) — so the row
      // says to check both rather than implying one.
      hint:
        condition.type === 'STAGE_WITHOUT_ASSIGNEE' ||
        condition.type === 'STORAGE_ALMOST_FULL' ||
        condition.type === 'STORAGE_ACCESS_WITHDRAWN' ||
        condition.type === 'STORAGE_SECRET_EXPIRING'
          ? this.translate.instant(`setupHealth.hint.${condition.type}`)
          : null,
      age: this.age(condition, loadedAt),
      openedAt: condition.openedAt,
      fix:
        target && permitted
          ? {
              label: this.translate.instant(`setupHealth.fix.${condition.type}`),
              link: target.link,
              queryParams: target.queryParams,
            }
          : null,
      fixNeeds: target && !permitted ? this.translate.instant(`setupHealth.fixNeeds.${condition.type}`) : null,
      keep:
        condition.type === 'STAGE_ON_STARTING_ASSIGNMENT' && target && permitted
          ? { stageId: condition.objectId, stageName: this.objectName(condition), adminName: this.adminName(condition) }
          : null,
    };
  }

  /** Whose the work is: a person's name, the same in both languages. */
  private adminName(condition: SetupConditionDto): string {
    return condition.subject.adminName || this.translate.instant('setupHealth.keep.someone');
  }

  // Tenant data: chosen by language, never translated (SYSTEM-REFERENCE §9.3).
  objectName(condition: SetupConditionDto): string {
    const s = condition.subject;
    if (condition.type === 'TASK_WITHOUT_OWNER') return s.title ?? '—';
    if (condition.type === 'STORAGE_ALMOST_FULL') return this.translate.instant('setupHealth.storageObject');
    if (condition.type === 'STORAGE_ACCESS_WITHDRAWN' || condition.type === 'STORAGE_SECRET_EXPIRING') {
      return this.translate.instant('setupHealth.sharePointObject');
    }
    if (condition.type === 'ACTING_HEAD_OPEN_ENDED') {
      return (this.language.isArabic() && s.orgUnitNameAr) || s.orgUnitNameEn || '—';
    }
    return (this.language.isArabic() && s.nameAr) || s.nameEn || '—';
  }

  private context(condition: SetupConditionDto): string | null {
    if (condition.type !== 'STAGE_WITHOUT_ASSIGNEE') return null;
    const s = condition.subject;
    const template = (this.language.isArabic() && s.templateNameAr) || s.templateNameEn;
    return template ? this.translate.instant('setupHealth.context.template', { name: template }) : null;
  }

  private consequence(condition: SetupConditionDto): string {
    const s = condition.subject;
    const t = (key: string, params?: Record<string, unknown>) =>
      this.translate.instant(`setupHealth.consequence.${key}`, params);
    switch (condition.type) {
      case 'ORG_UNIT_WITHOUT_HEAD':
        return t(s.escalationResolves === false ? 'unitUncovered' : 'unitCovered');
      case 'ORG_UNIT_WITHOUT_TYPE':
        return t('unitUntyped');
      case 'STAGE_WITHOUT_ASSIGNEE':
        return this.format.count('setupHealth.stageItemsBlocked', s.affectedInstances ?? 0);
      case 'TASK_WITHOUT_OWNER':
        return t('task');
      case 'STORAGE_ALMOST_FULL':
        return t('storage', {
          percent: this.format.number(s.percent ?? 0),
          limit: this.files.size(s.limitBytes ?? 0),
        });
      case 'STORAGE_ACCESS_WITHDRAWN':
        return t(`sharePointWithdrawn.${s.reason ?? 'UNKNOWN'}`);
      case 'STORAGE_SECRET_EXPIRING':
        return t('sharePointSecretExpiring', { date: this.format.date(s.expiresOn ?? null) });
      case 'ACTING_HEAD_OPEN_ENDED':
        return t('actingOpenEnded', { date: this.format.date(s.validFrom ?? null) });
      case 'STAGE_ON_STARTING_ASSIGNMENT':
        return t('startingAssignment', {
          workflow: (this.language.isArabic() && s.templateNameAr) || s.templateNameEn || '—',
          stage: this.objectName(condition),
          admin: this.adminName(condition),
        });
    }
  }

  // ACC-94 — under a day keeps ACC-82's sentence ("in the last 24 hours");
  // beyond it the age comes from the formatting layer, which pluralises
  // correctly in both languages. Both forms are passed: English reads "Open 7
  // days" (duration), Arabic "فُتحت قبل 7 أيام" (relative), because after a
  // preposition the Arabic dual and plural take the genitive, which only the
  // relative format gives ("قبل يومين", not "يومان").
  private age(condition: SetupConditionDto, loadedAt: Date): string {
    const elapsed = loadedAt.getTime() - new Date(condition.openedAt).getTime();
    const basis = condition.ageBasis === 'FIRST_DETECTED' ? 'detected' : 'open';
    if (elapsed < DAY_MS) return this.translate.instant(`setupHealth.age.${basis}Today`);
    return this.translate.instant(`setupHealth.age.${basis}`, {
      duration: this.format.duration(elapsed),
      relative: this.format.relative(condition.openedAt, loadedAt),
    });
  }

  freshnessNotice(f: SetupConditionFreshnessDto): string {
    const type = this.translate.instant(`setupHealth.types.${f.type}`);
    // Absolute: a stale check is something a person acts on, and "not checked
    // since 3 hours ago" reads badly in both languages.
    const when = f.computedAt ? this.format.dateTime(f.computedAt) : null;
    const key =
      f.status === 'FAILED'
        ? when
          ? 'failed'
          : 'failedNever'
        : f.status === 'OVERDUE'
          ? 'overdue'
          : 'neverRun';
    return this.translate.instant(`setupHealth.freshness.${key}`, { type, when });
  }

}
