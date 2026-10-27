import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { createRequestOutcome } from '../../../core/request-outcome/request-outcome';
import { FormatService } from '../../../core/formatting';
import { FilesService, IUploadLimitsDto } from '../../../shared/files/files.service';
import { IStorageSettings, StorageSettingsService } from './storage-settings.service';
import { StripView, UsageView, stripView, usageView } from './storage-view';
import { StorageLocationComponent } from './storage-location.component';
import { StorageRequestDialogComponent } from './storage-request-dialog.component';
import { AuthService } from '../../../core/services/auth.service';
import { RouterLink } from '@angular/router';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { RecycleBinService } from '../recycle-bin/recycle-bin.service';
import { totals } from '../recycle-bin/recycle-bin-view';

type LimitsState = { status: 'loading' } | { status: 'ready'; limits: IUploadLimitsDto } | { status: 'failed' };

/**
 * ACC-260, PR A — File storage, `/admin-settings/storage` (tenant:manage_config).
 * Design: AccreditMe Storage Settings.dc.html §1 (L41-196); plan:
 * backend/Plans/step-260-storage-settings.md §6, PR A.
 *
 * It shows where the organisation's files are kept and the state of that
 * location:
 * - the current-location strip, with "Request a change…" once confirmed
 *   (PR B) — or the pending request's line instead;
 * - the location list: first-time setup before confirming, and the current
 *   location's details after, with MinIO's keys replaceable (PR B);
 * - usage, and the upload rules.
 *
 * Every write answers with the settings, and the page reads GET again
 * afterwards. SharePoint's setup is PR C.
 *
 * One request, GET /tenant/storage, through the shared request outcome: a
 * skeleton at final heights (never a flash of "Not confirmed"), a sentence for
 * a 403, and an error with Retry. The allowed types come from
 * GET /files/upload-limits; if that fails, only its row says so, with its own
 * Retry.
 */
@Component({
  selector: 'app-storage-settings',
  standalone: true,
  imports: [PageHeaderComponent, TranslatePipe, RouterLink, ButtonModule, MessageModule, StorageLocationComponent, StorageRequestDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex max-w-6xl flex-col gap-3">
      <app-page-header [title]="'storage.title' | translate" [purpose]="'storage.purpose' | translate" />

      @switch (outcome().status) {
        @case ('loading') {
          <div class="flex flex-col gap-3" aria-busy="true" data-testid="storage-skeleton">
            <section class="am-ss__card am-ss__pad flex flex-col gap-2">
              <span class="am-skeleton-bar w-1/5"></span>
              <span class="am-skeleton-bar w-1/3"></span>
              <span class="am-skeleton-bar w-1/2"></span>
            </section>
            <section class="am-ss__card am-ss__pad flex flex-col gap-4">
              @for (row of [1, 2, 3, 4]; track row) {
                <span class="am-skeleton-bar w-2/5"></span>
              }
            </section>
            <div class="am-ss__pair">
              <section class="am-ss__card am-ss__pad flex flex-col gap-2"><span class="am-skeleton-bar w-1/3"></span><span class="am-skeleton-bar w-full"></span></section>
              <section class="am-ss__card am-ss__pad flex flex-col gap-2"><span class="am-skeleton-bar w-1/3"></span><span class="am-skeleton-bar w-2/3"></span></section>
            </div>
          </div>
        }
        @case ('denied') {
          <section class="am-ss__card am-ss__pad" role="status" data-testid="storage-denied">
            <p class="m-0 text-value text-ink-700">{{ 'storage.denied' | translate }}</p>
          </section>
        }
        @case ('error') {
          <section class="am-ss__card am-ss__pad flex flex-col items-start gap-2" role="alert" data-testid="storage-error">
            <p-message severity="error" [text]="'storage.errorLoad' | translate" />
            <p-button size="small" [outlined]="true" [label]="'common.retry' | translate" (onClick)="handle.retry()" data-testid="storage-retry" />
          </section>
        }
        @case ('rows') {
          @if (settings(); as s) {
            @if (strip(); as st) {
              <section class="am-ss__card am-ss__pad" [class.am-ss__card--danger]="st.tone === 'danger'" data-testid="storage-strip" [attr.data-kind]="st.kind ?? 'none'">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span class="min-w-0 flex-[1_1_320px]">
                    <span class="am-label block">{{ 'storage.current.label' | translate }}</span>
                    <span class="block text-heading" data-testid="strip-name">{{ (st.kind ? 'storage.kind.' + st.kind + '.name' : 'storage.current.noneName') | translate }}</span>
                    <span class="block text-meta text-ink-700 [unicode-bidi:plaintext]" data-testid="strip-detail">{{ detailOf(st) }}</span>
                  </span>
                  <span class="flex flex-wrap items-center gap-2">
                    <span class="am-ss__chip" [class.am-ss__chip--danger]="st.tone === 'danger'" data-testid="strip-chip">{{ st.chipKey | translate }}</span>
                    <!-- One open request at a time (design L1028): while one is pending, its line takes the button's place. -->
                    @if (st.kind && !st.request) {
                      <p-button
                        type="button"
                        size="small"
                        [outlined]="true"
                        severity="secondary"
                        [label]="'storage.request.open' | translate"
                        (onClick)="requestOpen.set(true)"
                        data-testid="request-open"
                      />
                    }
                  </span>
                </div>
                @if (st.request; as r) {
                  <div class="am-ss__request" role="status" data-testid="strip-request">{{ requestLine(r) }}</div>
                }
              </section>
            }

            <am-storage-location [settings]="s" [today]="today()" (saved)="reload()" />
            @if (confirmedKind(); as kind) {
              <am-storage-request-dialog
                [visible]="requestOpen()"
                (visibleChange)="requestOpen.set($event)"
                [current]="'storage.kind.' + kind + '.name' | translate"
                [by]="userName()"
                [byEmail]="userEmail()"
                (sent)="reload()"
              />
            }

            <div class="am-ss__pair">
              @if (usage(); as u) {
                <section class="am-ss__card" data-testid="storage-usage" [attr.data-tone]="u.tone">
                  <header class="am-ss__head">
                    <h2 class="m-0 text-heading">{{ 'storage.usage.title' | translate }}</h2>
                    <span class="text-meta text-ink-500">{{ 'storage.usage.sub' | translate }}</span>
                  </header>
                  <div class="am-ss__pad">
                    @if (u.tone === 'own') {
                      <p class="m-0 text-value font-medium" data-testid="usage-own">{{ 'storage.usage.own' | translate }}</p>
                      @if (u.usedBytes > 0) {
                        <p class="m-0 mt-1.5 text-meta text-ink-700" data-testid="usage-leftover">{{ 'storage.usage.ownLeftover' | translate: sizes(u) }}</p>
                      }
                    } @else {
                      <div class="flex flex-wrap items-baseline justify-between gap-2">
                        <span class="text-title am-num [unicode-bidi:isolate]" data-testid="usage-big">{{ 'storage.usage.of' | translate: sizes(u) }}</span>
                        <span class="text-value am-num" [class.font-semibold]="u.tone !== 'normal'" [class.text-warning]="u.tone === 'near'" [class.text-danger]="u.tone === 'full'" data-testid="usage-pct">{{ pctText(u) }}</span>
                      </div>
                      <div
                        role="meter"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        [attr.aria-valuenow]="u.percent"
                        [attr.aria-valuetext]="'storage.usage.meterLabel' | translate: sizes(u)"
                        [attr.aria-label]="'storage.usage.title' | translate"
                        class="am-ss__track"
                        data-testid="usage-meter"
                      >
                        <span class="am-ss__fill" [class.am-ss__fill--near]="u.tone === 'near'" [class.am-ss__fill--full]="u.tone === 'full'" [style.inline-size.%]="u.percent"></span>
                      </div>
                      <p class="m-0 text-meta text-ink-700" data-testid="usage-line">{{ ('storage.usage.' + u.tone + 'Line') | translate: sizes(u) }}</p>
                      <!-- PR D — the bin's share of the usage (plan G6: summed from the bin list). -->
                      @if (binBytes(); as bytes) {
                        <p class="m-0 mt-1.5 text-meta text-ink-700" data-testid="usage-bin">
                          {{ 'storage.usage.inBin' | translate: { size: files.size(bytes) } }} ·
                          <a routerLink="/admin-settings/recycle-bin" data-testid="usage-open-bin">{{ 'storage.usage.openBin' | translate }}</a>
                        </p>
                      }
                      @if (u.tone !== 'normal') {
                        <p class="m-0 mt-1.5 text-meta text-ink-700" data-testid="usage-contact">{{ 'storage.usage.contact' | translate }}</p>
                      }
                    }
                  </div>
                </section>
              }

              <section class="am-ss__card" data-testid="storage-rules">
                <header class="am-ss__head">
                  <h2 class="m-0 text-heading">{{ 'storage.rules.title' | translate }}</h2>
                  <span class="text-meta text-ink-500">{{ 'storage.rules.sub' | translate }}</span>
                </header>
                <dl class="m-0 am-ss__pad">
                  <div class="am-ss__rule">
                    <dt class="text-meta font-medium text-ink-500">{{ 'storage.rules.maxSize' | translate }}</dt>
                    <dd class="m-0 text-value" data-testid="rule-max-size">{{ 'storage.rules.maxSizeValue' | translate: { size: files.size(s.maxUploadBytes) } }}</dd>
                  </div>
                  <div class="am-ss__rule">
                    <dt class="text-meta font-medium text-ink-500">{{ 'storage.rules.types' | translate }}</dt>
                    <dd class="m-0 text-value" data-testid="rule-types">
                      @switch (limits().status) {
                        @case ('ready') {
                          <span dir="ltr" class="[unicode-bidi:isolate]">{{ typesText() }}</span>
                        }
                        @case ('failed') {
                          <span class="text-ink-700">{{ 'storage.rules.typesFailed' | translate }}</span>
                          <p-button size="small" [text]="true" [label]="'common.retry' | translate" (onClick)="loadLimits()" data-testid="rule-types-retry" />
                        }
                        @default {
                          <span class="am-skeleton-bar w-2/3 inline-block"></span>
                        }
                      }
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .am-ss__card{border:1px solid var(--am-border);border-radius:var(--am-radius-card);background:var(--am-surface-raised);overflow:hidden}
      .am-ss__card--danger{border-color:var(--am-danger-border)}
      .am-ss__pad{padding:var(--am-space-12) var(--am-space-16)}
      .am-ss__head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--am-space-6) var(--am-space-12);padding:var(--am-space-8) var(--am-space-16);border-block-end:1px solid var(--am-border)}
      .am-ss__pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:var(--am-space-12)}
      .am-ss__chip{flex:none;font-size:var(--am-type-meta-size);font-weight:600;white-space:nowrap;border-radius:var(--am-radius-pill);padding:var(--am-space-2) var(--am-space-8);color:var(--am-ink-900);background:var(--am-surface-raised);border:1px solid var(--am-control-border)}
      .am-ss__chip--danger{color:var(--am-danger-ink);background:var(--am-danger-bg);border-color:var(--am-danger-border)}
      .am-ss__request{margin-block-start:var(--am-space-8);padding:var(--am-space-6) var(--am-space-8);border-radius:var(--am-radius-card);background:var(--am-info-bg);border:1px solid var(--am-info-border);color:var(--am-info-ink);font-size:var(--am-type-meta-size);font-weight:500}
      .am-ss__track{display:block;block-size:var(--am-space-8);margin-block:var(--am-space-8);border:1px solid var(--am-control-border);border-radius:var(--am-radius-control);overflow:hidden;background:var(--am-surface-raised)}
      .am-ss__fill{display:block;block-size:100%;background:var(--am-primary-600)}
      .am-ss__fill--near{background:repeating-linear-gradient(135deg,var(--am-warning-ink) 0 4px,var(--am-warning-border) 4px 8px)}
      .am-ss__fill--full{background:var(--am-danger-ink)}
      .am-ss__rule{display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr);gap:var(--am-space-12);padding-block:var(--am-space-6);border-block-end:1px solid var(--am-row-rule)}
      .am-ss__rule:last-child{border-block-end:0}
    `,
  ],
})
export class StorageSettingsComponent {
  private readonly storage = inject(StorageSettingsService);
  protected readonly files = inject(FilesService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);
  private readonly recycleBin = inject(RecycleBinService);
  private readonly access = inject(NavigationAccessService);

  /**
   * PR D — the recycle bin's total, for "Includes 212 MB in the recycle bin".
   * Read only by someone who may open the bin, and absent while it is empty or
   * could not be read: the line is extra, never a reason the card fails.
   */
  readonly binBytes = signal<number | null>(null);

  readonly requestOpen = signal(false);
  readonly userName = computed(() => this.auth.currentUser()?.name ?? '');
  readonly userEmail = computed(() => this.auth.currentUser()?.email ?? '');
  /** The confirmed location, for Request a change's "Current: …". */
  readonly confirmedKind = computed(() => this.strip()?.kind ?? null);

  /** After a write: GET again. The answer on screen stays while it reloads (never a skeleton flash). */
  reload(): void {
    this.handle.retry();
  }

  /** Today, YYYY-MM-DD (UTC): the secret's expiry warning counts days from it. */
  readonly today = signal(new Date().toISOString().slice(0, 10));

  readonly handle = createRequestOutcome<IStorageSettings>(() => this.storage.get().pipe(map((s) => [s])), {
    // GET /tenant/storage always answers with the organisation's settings:
    // there is always a location, confirmed or not (design L1037).
    describeEmpty: () => ({ reason: 'storage.errorLoad', filtered: false }),
  });
  readonly outcome = this.handle.outcome;

  readonly settings = computed<IStorageSettings | null>(() => {
    const o = this.outcome();
    return o.status === 'rows' ? (o.data[0] ?? null) : null;
  });
  readonly strip = computed<StripView | null>(() => {
    const s = this.settings();
    return s ? stripView(s, this.today()) : null;
  });
  readonly usage = computed<UsageView | null>(() => {
    const s = this.settings();
    return s ? usageView(s) : null;
  });

  readonly limits = signal<LimitsState>({ status: 'loading' });
  readonly typesText = computed(() => {
    const l = this.limits();
    return l.status === 'ready' ? l.limits.allowedExtensions.map((e) => e.toUpperCase()).join(', ') : '';
  });

  constructor() {
    this.loadLimits();
    if (this.access.hasPermission('tenant:manage_config')) {
      this.recycleBin.list().subscribe({
        next: (items) => this.binBytes.set(items.length > 0 ? totals(items).bytes : null),
        error: () => this.binBytes.set(null),
      });
    }
  }

  loadLimits(): void {
    this.limits.set({ status: 'loading' });
    this.files.uploadLimits().subscribe({
      next: (limits) => this.limits.set({ status: 'ready', limits }),
      error: () => this.limits.set({ status: 'failed' }),
    });
  }

  /** "Managed by AccreditMe · Confirmed 3 Oct 2026 by Hessa", "host · bucket · Confirmed …", or the not-confirmed sentence. */
  detailOf(st: StripView): string {
    const t = (key: string, params?: Record<string, unknown>) => this.translate.instant(key, params);
    if (!st.kind) return t('storage.current.noneDetail');
    const parts: string[] = [];
    if (st.managed) parts.push(t('storage.current.managed'));
    // SharePoint's "site › library" is isolated left to right (U+2066 … U+2069),
    // so an Arabic site name cannot reorder it inside an Arabic line (PR C).
    if (st.location) parts.push(st.kind === 'SHAREPOINT' ? `⁦${st.location}⁩` : st.location);
    if (st.refused) parts.push(t('storage.current.refused'));
    else if (st.confirmed) {
      const date = this.format.date(st.confirmed.at);
      parts.push(st.confirmed.by ? t('storage.current.confirmedOnBy', { date, name: st.confirmed.by }) : t('storage.current.confirmedOn', { date }));
    }
    return parts.join(' · ');
  }

  requestLine(r: { at: string; by: string | null }): string {
    const date = this.format.date(r.at);
    return r.by
      ? this.translate.instant('storage.current.requestedOnBy', { date, name: r.by })
      : this.translate.instant('storage.current.requestedOn', { date });
  }

  sizes(u: UsageView): Record<string, string> {
    return { used: this.sizeOf(u.usedBytes), limit: this.sizeOf(u.limitBytes), left: this.sizeOf(u.leftBytes) };
  }

  /** FilesService.size, except that nothing stored reads "0 KB", not its 1 KB floor for a file. */
  private sizeOf(bytes: number): string {
    return bytes > 0 ? this.files.size(bytes) : this.translate.instant('files.sizeKb', { size: this.format.number(0) });
  }

  pctText(u: UsageView): string {
    if (u.tone === 'full') return this.translate.instant('storage.usage.full');
    const pct = this.format.number(u.percent);
    return u.tone === 'near' ? this.translate.instant('storage.usage.almostFull', { pct }) : this.translate.instant('storage.usage.pct', { pct });
  }
}
