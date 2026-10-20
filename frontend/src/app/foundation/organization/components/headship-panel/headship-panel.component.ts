import { Component, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { IOrgUnitHeadHolder, IOrgUnitHeadStatus, OrgUnitHeadService } from '../../services/org-unit-head.service';
import { SetActingHeadDialogComponent } from '../set-acting-head-dialog/set-acting-head-dialog.component';
import { HeadshipActionsComponent } from '../headship-actions/headship-actions.component';
import { HeadshipAction, deriveHeadshipState } from './headship-state';

const DAY_MS = 24 * 60 * 60 * 1000;

interface PanelRow {
  key: 'head' | 'cover' | 'incoming';
  label: string;
  /** The person, or "Head assigned" / "Cover arranged" when names are withheld (D7). */
  value: string;
  /** A user record link, only for a viewer who may open it. */
  personId: string | null;
  /** "· Director", appended to the value. */
  position: string;
  meta: string;
  muted: boolean;
  /** The open-ended cover bar (ACC-133: words and shape, not only colour). */
  bar: { from: string; flag: string } | null;
}

/**
 * ACC-133 — the unit's Headship panel. Standalone, taking a unit id, so the
 * future unit record page embeds it as it is; for now it is the body of the
 * tree's "Manage head" dialog.
 *
 * It shows what the unit's headship IS (one of six states, `headship-state.ts`)
 * and offers only the actions that state allows, each named in the user's
 * words. The word "handover" appears nowhere: `POST /handover/complete` is
 * "Start new head today", `POST /handover/cancel` is "Withdraw appointment".
 *
 * Head access starts when a successor is SAVED, not on the effective date
 * (`declareHandover()` grants the position at once), and there is no maximum
 * window. So states 5 and 6 say "Two heads until …" and label the successor
 * "Also head · incoming". Do not soften this wording.
 *
 * A viewer without org:manage sees the panel and no actions.
 */
@Component({
  selector: 'am-headship-panel',
  standalone: true,
  imports: [TranslatePipe, RouterLink, ButtonModule, HeadshipActionsComponent],
  template: `
    <section class="am-hs" data-testid="headship-panel" [attr.data-state]="view()?.state">
      <header class="am-hs__bar">
        <span class="am-hs__title">{{ 'headship.title' | translate }}</span>
        @if (pill(); as p) {
          <span class="am-hs__pill" [class.am-hs__pill--info]="p.tone === 'info'" data-testid="headship-pill">
            {{ p.text }}
          </span>
        }
      </header>

      @if (loading() && !status()) {
        <p class="am-hs__note" role="status">{{ 'headship.loading' | translate }}</p>
      } @else if (loadError()) {
        <div class="am-hs__note am-hs__note--error" role="alert">
          <span>{{ loadError()! | translate }}</span>
          <p-button size="small" severity="secondary" [text]="true" [label]="'common.retry' | translate" (onClick)="load()" />
        </div>
      } @else if (view(); as v) {
        @for (row of rows(); track row.key) {
          <div class="am-hs__row" [attr.data-row]="row.key">
            <div class="am-hs__label">{{ row.label }}</div>
            <div class="am-hs__value" [class.am-hs__value--muted]="row.muted">
              @if (row.personId && canOpenPeople()) {
                <a class="am-hs__link" [routerLink]="['/users', row.personId]">{{ row.value }}</a>
              } @else {
                <span>{{ row.value }}</span>
              }
              @if (row.position) {
                <span class="am-hs__position"> · {{ row.position }}</span>
              }
            </div>
            <div class="am-hs__meta" data-testid="headship-meta">{{ row.meta }}</div>
            @if (row.bar; as bar) {
              <div class="am-hs__track" aria-hidden="true">
                <span class="am-hs__track-run"></span>
                <span class="am-hs__track-open"></span>
                <span class="am-hs__track-flag"></span>
                <span class="am-hs__track-after"></span>
              </div>
              <div class="am-hs__track-labels">
                <span dir="ltr">{{ bar.from }}</span>
                <span class="am-hs__track-flag-label">{{ bar.flag }}</span>
                <span>{{ 'headship.cover.noEndDate' | translate }}</span>
              </div>
            }
          </div>
        }

        @if (canManage() && v.actions.length) {
          <div class="am-hs__actions" data-testid="headship-actions">
            @for (action of v.actions; track action; let first = $first) {
              <span class="am-hs__action">
                <p-button
                  size="small"
                  [attr.data-action]="action"
                  [label]="actionLabel(action) | translate"
                  [severity]="actionSeverity(action, first && v.primary)"
                  [outlined]="actionStyle(action, first && v.primary) === 'secondary'"
                  [text]="actionStyle(action, first && v.primary) === 'danger'"
                  [disabled]="actions().busy() || !!actions().blockedReason(action)"
                  (onClick)="actions().run(action)"
                />
                @if (actions().blockedReason(action); as reason) {
                  <span class="am-hs__blocked" data-testid="headship-blocked">
                    {{ reason | translate }}
                    @if (canOpenPositions()) {
                      <a [routerLink]="['/org-positions']">{{ 'headship.appoint.flagOne' | translate }}</a>
                    }
                  </span>
                }
              </span>
            }
          </div>
        }

        @if (actions().actionError(); as error) {
          <p class="am-hs__note am-hs__note--error" role="alert">{{ error | translate }}</p>
        }
      }
    </section>

    <!-- The dialogs and confirms: one copy, shared with the org tree's row
         menu (ACC-120 slice 11). -->
    <am-headship-actions
      [orgUnitId]="orgUnitId()"
      [unitName]="unitName()"
      [status]="status()"
      (saved)="onSaved()"
    />
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .am-hs {
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
        overflow: hidden;
        background: var(--am-surface-raised);
      }
      .am-hs__bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-8);
        padding: var(--am-space-8) var(--am-space-12);
        background: var(--am-surface);
        border-block-end: 1px solid var(--am-border);
      }
      .am-hs__title,
      .am-hs__label {
        font-size: var(--am-type-micro-size);
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--am-ink-500);
      }
      .am-hs__pill {
        display: inline-flex;
        align-items: center;
        gap: var(--am-space-4);
        font-size: var(--am-type-micro-size);
        font-weight: 600;
        color: var(--am-warning-ink);
        background: var(--am-warning-bg);
        border: 1px solid var(--am-warning-border);
        border-radius: var(--am-radius-pill);
        padding: 0 var(--am-space-8);
      }
      .am-hs__pill--info {
        color: var(--am-info-ink);
        background: var(--am-info-bg);
        border-color: var(--am-info-border);
      }
      .am-hs__row {
        padding: var(--am-space-8) var(--am-space-12);
        border-block-end: 1px solid var(--am-border);
      }
      .am-hs__value {
        font-size: var(--am-type-value-size);
        font-weight: 500;
        color: var(--am-primary-700);
      }
      .am-hs__value--muted {
        color: var(--am-ink-500);
      }
      .am-hs__position {
        color: var(--am-ink-700);
      }
      .am-hs__link {
        color: inherit;
        text-decoration: none;
      }
      .am-hs__link:hover,
      .am-hs__link:focus-visible {
        text-decoration: underline;
      }
      .am-hs__meta {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
        text-wrap: pretty;
      }
      .am-hs__track {
        display: flex;
        align-items: center;
        margin-block-start: var(--am-space-8);
      }
      .am-hs__track-run {
        flex: 3 1 0;
        height: var(--am-space-6);
        background: var(--am-primary-600);
        border-start-start-radius: var(--am-radius-control);
        border-end-start-radius: var(--am-radius-control);
      }
      .am-hs__track-open {
        flex: 2 1 0;
        border-block-start: 2px dashed var(--am-border-strong);
      }
      .am-hs__track-flag {
        flex: none;
        width: var(--am-space-2);
        height: var(--am-space-16);
        background: var(--am-warning-ink);
      }
      .am-hs__track-after {
        flex: 1 1 0;
        border-block-start: 2px dashed var(--am-border);
      }
      .am-hs__track-labels {
        display: flex;
        justify-content: space-between;
        gap: var(--am-space-8);
        font-size: var(--am-type-micro-size);
        color: var(--am-ink-500);
        margin-block-start: var(--am-space-4);
      }
      .am-hs__track-flag-label {
        color: var(--am-warning-ink);
        font-weight: 600;
      }
      .am-hs__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-8);
        padding: var(--am-space-8) var(--am-space-12);
      }
      .am-hs__action {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--am-space-8);
      }
      .am-hs__blocked {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
      }
      .am-hs__note {
        margin: 0;
        padding: var(--am-space-8) var(--am-space-12);
        font-size: var(--am-type-body-size);
        color: var(--am-ink-500);
      }
      .am-hs__note--error {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        color: var(--am-danger-ink);
      }
    `,
  ],
})
export class HeadshipPanelComponent implements OnInit {
  private readonly headService = inject(OrgUnitHeadService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);
  private readonly access = inject(NavigationAccessService);

  readonly orgUnitId = input.required<string>();
  readonly unitName = input.required<string>();
  /** After any change, so a host can refresh what it shows. */
  readonly saved = output<void>();

  readonly status = signal<IOrgUnitHeadStatus | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  /** The dialogs, confirms and what they need (`am-headship-actions`). */
  readonly actions = viewChild.required(HeadshipActionsComponent);

  readonly canManage = computed(() => this.access.hasPermission('org:manage'));
  readonly canOpenPeople = computed(() => this.access.hasPermission('users:view'));
  readonly canOpenPositions = computed(() => this.access.hasPermission('positions:view'));

  readonly view = computed(() => {
    const s = this.status();
    return s ? deriveHeadshipState(s) : null;
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.headService.getHeadStatus(this.orgUnitId()).subscribe({
      next: (status) => {
        this.status.set(status);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loadError.set(extractErrorMessage(err, 'headship.loadFailed'));
        this.loading.set(false);
      },
    });
  }

  // ── Display ──────────────────────────────────────────────────────────────

  private personName(name: string | null, fallbackKey: string): string {
    return name ?? this.translate.instant(fallbackKey);
  }

  private positionOf(holder: IOrgUnitHeadHolder): string {
    return holder.positionNameEn ? this.language.bilingual(holder.positionNameEn, holder.positionNameAr) : '';
  }

  /** The day before a date: the last day the outgoing head has access. */
  private dayBefore(iso: string): Date {
    return new Date(new Date(iso).getTime() - DAY_MS);
  }

  readonly pill = computed((): { text: string; tone: 'info' | 'warn' } | null => {
    const v = this.view();
    const s = this.status();
    if (!v || !s) return null;
    if ((v.state === 5 || v.state === 6) && s.headHandoverEffectiveDate) {
      return {
        text: this.translate.instant('headship.pill.twoHeads', { date: this.format.date(s.headHandoverEffectiveDate) }),
        tone: 'info',
      };
    }
    // An open-ended cover for an ABSENT head is what Setup health flags as at
    // risk; for a vacancy an open end is normal, so no pill.
    const cover = v.cover;
    if (cover && cover.validTo === null && v.coverReason === 'ABSENCE') {
      return {
        text: this.translate.instant('headship.pill.atRisk', { date: this.format.date(this.flagDate(cover.validFrom)) }),
        tone: 'warn',
      };
    }
    return null;
  });

  private flagDate(validFrom: string): Date {
    return new Date(new Date(validFrom).getTime() + SetActingHeadDialogComponent.OPEN_ENDED_ACTING_DAYS * DAY_MS);
  }

  readonly rows = computed((): PanelRow[] => {
    const v = this.view();
    const s = this.status();
    if (!v || !s) return [];
    const rows: PanelRow[] = [];
    const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params);
    const date = (iso: string | Date | null) => (iso ? this.format.date(iso) : '');

    // The head row.
    if (v.head) {
      const head = v.head;
      let meta: string;
      if (v.state === 5) {
        meta = s.headHandoverEffectiveDate
          ? t('headship.head.accessUntil', { date: date(this.dayBefore(s.headHandoverEffectiveDate)) })
          : '';
      } else if (v.state === 6) {
        meta = s.headHandoverEffectiveDate
          ? t('headship.head.awayLeaves', { date: date(this.dayBefore(s.headHandoverEffectiveDate)) })
          : t('headship.head.awayCovered');
      } else if (v.state === 4 && v.cover?.reason === 'ABSENCE') {
        meta = t('headship.head.awayCovered');
      } else {
        meta = head.headSince ? t('headship.head.since', { date: date(head.headSince) }) : t('headship.head.sinceUnknown');
      }
      rows.push({
        key: 'head',
        label: t('headship.head.label'),
        value: this.personName(head.name, 'headship.head.assigned'),
        personId: head.name ? head.id : null,
        position: this.positionOf(head),
        meta,
        muted: false,
        bar: null,
      });
    } else {
      // Vacant. "No head recorded" is true in every case the ledger is empty;
      // "never had a head" would be false for a unit vacated before it began.
      const vacancy = s.lastVacancy;
      let meta = t('headship.head.noneRecorded');
      if (vacancy) {
        meta = vacancy.by?.name
          ? t('headship.head.vacatedBy', { date: date(vacancy.at), name: vacancy.by.name })
          : t('headship.head.vacated', { date: date(vacancy.at) });
      }
      rows.push({
        key: 'head',
        label: t('headship.head.label'),
        value: t('headship.head.none'),
        personId: null,
        position: '',
        meta,
        muted: true,
        bar: null,
      });
    }

    // The cover row.
    if (v.cover) {
      const c = v.cover;
      const who =
        c.reason === 'ABSENCE'
          ? t('headship.cover.coveringFor', { name: this.personName(v.head?.name ?? null, 'headship.cover.theHead') })
          : t('headship.cover.coveringVacancy');
      let when: string;
      if (v.coverIsScheduled) {
        when = c.validTo
          ? t('headship.cover.startsRange', { from: date(c.validFrom), to: date(c.validTo) })
          : t('headship.cover.startsOpen', { from: date(c.validFrom) });
      } else {
        when = c.validTo
          ? t('headship.cover.range', { from: date(c.validFrom), to: date(c.validTo) })
          : t('headship.cover.sinceOpen', { from: date(c.validFrom) });
      }
      rows.push({
        key: 'cover',
        label: t('headship.cover.label'),
        value: this.personName(c.name, 'headship.cover.arranged'),
        personId: c.name ? c.userId : null,
        position: '',
        meta: `${who} · ${when}`,
        muted: false,
        bar:
          !v.coverIsScheduled && c.validTo === null
            ? {
                from: t('headship.cover.barFrom', { date: date(c.validFrom) }),
                flag: t('headship.cover.barFlag', { date: date(this.flagDate(c.validFrom)) }),
              }
            : null,
      });
    }

    // The incoming row: they ALREADY have head access.
    if (v.incoming) {
      const i = v.incoming;
      const parts: string[] = [];
      parts.push(
        s.pendingHeadAccessSince
          ? t('headship.incoming.accessSince', { date: date(s.pendingHeadAccessSince) })
          : t('headship.incoming.accessSinceUnknown'),
      );
      if (s.headHandoverEffectiveDate) parts.push(t('headship.incoming.soleFrom', { date: date(s.headHandoverEffectiveDate) }));
      rows.push({
        key: 'incoming',
        label: t('headship.incoming.label'),
        value: this.personName(i.name, 'headship.head.assigned'),
        personId: i.name ? i.id : null,
        position: this.positionOf(i),
        meta: parts.join(' · '),
        muted: false,
        bar: null,
      });
    }
    return rows;
  });

  // ── Actions ──────────────────────────────────────────────────────────────

  actionLabel(action: HeadshipAction): string {
    return `headship.action.${action}`;
  }

  actionStyle(action: HeadshipAction, isPrimary: boolean): 'primary' | 'secondary' | 'danger' {
    if (isPrimary) return 'primary';
    return action === 'vacate' || action === 'withdrawAppointment' || action === 'endCover' ? 'danger' : 'secondary';
  }

  actionSeverity(action: HeadshipAction, isPrimary: boolean): 'primary' | 'secondary' | 'danger' {
    const style = this.actionStyle(action, isPrimary);
    return style === 'danger' ? 'danger' : style === 'secondary' ? 'secondary' : 'primary';
  }

  /** After a dialog or confirm saved: read the unit again, and tell the host. */
  onSaved(): void {
    this.load();
    this.saved.emit();
  }
}
