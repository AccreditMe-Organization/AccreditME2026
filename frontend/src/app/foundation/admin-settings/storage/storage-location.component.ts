import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../core/formatting';
import { IStorageSettings } from './storage-settings.service';
import { FieldView, SharePointHealth, ValuePart, currentFields, currentKind, optionsView, sharePointHealth } from './storage-view';

/**
 * ACC-260, PR A — the "Where files are kept" card (design L70-140): the four
 * options, and the current location open with its details, read-only.
 *
 * - Before confirming, the options are listed with what each is; choosing one
 *   arrives with first-time setup (PR B).
 * - After confirming, every other option is greyed and the current one carries
 *   "Current" (L720-725). Where files are is locked (🔒); credentials show only
 *   "Set" (rule 2). AccreditMe cloud shows that AccreditMe manages it, and
 *   nothing else (rule 1).
 *
 * No control here writes anything.
 */
@Component({
  selector: 'am-storage-location',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="am-sl rounded-card border border-rule bg-surface-raised" data-testid="storage-location">
      <header class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-2.5 border-b border-rule">
        <h2 class="m-0 text-heading">{{ (confirmed() ? 'storage.location.fixedTitle' : 'storage.location.chooseTitle') | translate }}</h2>
        <span class="text-meta text-ink-500">{{ (confirmed() ? 'storage.location.fixedSub' : 'storage.location.chooseSub') | translate }}</span>
      </header>
      <ul class="m-0 p-0 list-none" [attr.aria-label]="(confirmed() ? 'storage.location.fixedTitle' : 'storage.location.chooseTitle') | translate">
        @for (o of options(); track o.kind) {
          <li class="am-sl__opt" [class.am-sl__opt--current]="o.current" [attr.data-option]="o.kind" [attr.aria-current]="o.current ? 'true' : null">
            <div class="flex gap-2.5 items-start">
              <span class="am-sl__dot" [class.am-sl__dot--current]="o.current" [class.am-sl__dot--off]="o.disabled" aria-hidden="true">{{ o.current ? '●' : '' }}</span>
              <span class="min-w-0 flex-auto">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="text-body" [class.font-semibold]="o.current" [class.text-ink-500]="o.disabled" data-testid="option-title">{{ 'storage.kind.' + o.kind + '.name' | translate }}</span>
                  @if (o.current) {
                    <span class="text-micro font-semibold text-ink-700 bg-surface border border-rule rounded-control px-1.5" data-testid="option-current">{{ 'storage.location.current' | translate }}</span>
                  }
                </span>
                <span class="block text-meta text-ink-500">{{ descKey(o.kind, o.offered) | translate }}</span>
              </span>
            </div>

            @if (o.current) {
              <div class="am-sl__body" data-testid="current-body">
                @if (o.kind === 'S3') {
                  <div class="am-sl__banner" data-testid="cloud-managed">
                    <div class="font-semibold text-body">{{ 'storage.cloud.managedTitle' | translate }}</div>
                    <div class="text-value">{{ 'storage.cloud.managedBody' | translate }}</div>
                  </div>
                }
                @if (health(); as h) {
                  @if (h.state === 'withdrawn') {
                    <div class="am-sl__banner am-sl__banner--danger" role="alert" data-testid="sp-withdrawn">
                      <div class="font-semibold text-body text-danger">{{ 'storage.sp.withdrawnTitle' | translate }}</div>
                      <div class="text-value">{{ withdrawnBody(h) }}</div>
                      <div class="text-value">{{ 'storage.sp.withdrawnSince' | translate: { date: format.date(h.since) } }}</div>
                    </div>
                  } @else if (h.state === 'expiring' || h.state === 'expired') {
                    <div class="am-sl__banner am-sl__banner--warn" role="status" data-testid="sp-expiring">
                      <div class="text-value">{{ (h.state === 'expiring' ? 'storage.sp.expiring' : 'storage.sp.expired') | translate: { date: format.date(h.on) } }}</div>
                    </div>
                  }
                }
                @if (fields().length) {
                  <div class="am-sl__grid" data-testid="current-fields">
                    @for (f of fields(); track f.id) {
                      <div class="min-w-0" [attr.data-field]="f.id">
                        <div class="text-meta font-medium text-ink-700 mb-1">{{ f.labelKey | translate }}</div>
                        <div class="am-sl__box" [class.am-sl__box--locked]="f.locked">
                          <span class="am-sl__value" [attr.dir]="f.ltr ? 'ltr' : null" data-testid="field-value">{{ valueOf(f) }}</span>
                          @if (f.locked) {
                            <span class="flex-none text-ink-500" aria-hidden="true">🔒</span>
                          }
                        </div>
                        @if (f.helpKey) {
                          <div class="text-meta text-ink-500 mt-1" data-testid="field-help">{{ f.helpKey | translate }}</div>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </li>
        }
      </ul>
    </section>
  `,
  styles: [
    `
      .am-sl__opt{padding:var(--am-space-12) var(--am-space-16);border-block-end:1px solid var(--am-border)}
      .am-sl__opt:last-child{border-block-end:0}
      .am-sl__opt--current{background:var(--am-surface)}
      .am-sl__dot{flex:none;inline-size:var(--am-space-16);block-size:var(--am-space-16);margin-block-start:var(--am-space-2);box-sizing:border-box;border-radius:var(--am-radius-pill);border:1px solid var(--am-control-border);background:var(--am-surface-raised);font-size:var(--am-type-micro-size);line-height:calc(var(--am-space-16) - 2px);text-align:center;color:var(--am-ink-700)}
      .am-sl__dot--off{background:var(--am-surface);border-color:var(--am-border)}
      .am-sl__dot--current{background:var(--am-surface);border-color:var(--am-ink-500)}
      .am-sl__body{display:flex;flex-direction:column;gap:var(--am-space-12);margin-block-start:var(--am-space-12);margin-inline-start:var(--am-space-24);max-inline-size:720px}
      .am-sl__banner{border-radius:var(--am-radius-card);padding:var(--am-space-8) var(--am-space-12);background:var(--am-surface);border:1px solid var(--am-border);color:var(--am-ink-900)}
      .am-sl__banner--danger{background:var(--am-danger-bg);border-color:var(--am-danger-border)}
      .am-sl__banner--warn{background:var(--am-warning-bg);border-color:var(--am-warning-border)}
      .am-sl__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:var(--am-space-12)}
      .am-sl__box{display:flex;align-items:center;gap:var(--am-space-8);min-block-size:var(--am-form-control-height);box-sizing:border-box;padding:0 var(--am-space-8);border-radius:var(--am-radius-control);border:1px solid var(--am-border);background:var(--am-surface)}
      .am-sl__value{flex:1 1 auto;min-inline-size:0;font-size:var(--am-type-value-size);font-weight:500;color:var(--am-ink-900);overflow-wrap:anywhere;unicode-bidi:isolate}
    `,
  ],
})
export class StorageLocationComponent {
  protected readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);

  readonly settings = input.required<IStorageSettings>();
  /** Today, YYYY-MM-DD: the expiry warning counts days from it. */
  readonly today = input.required<string>();

  readonly confirmed = computed(() => currentKind(this.settings()) !== null);
  readonly options = computed(() => optionsView(this.settings()));
  readonly fields = computed(() => currentFields(this.settings()));
  readonly health = computed<SharePointHealth | null>(() => sharePointHealth(this.settings(), this.today()));

  descKey(kind: string, offered: boolean): string {
    return kind === 'LOCAL_FILESYSTEM' && !offered ? 'storage.kind.LOCAL_FILESYSTEM.descNotOffered' : `storage.kind.${kind}.desc`;
  }

  /** "Set", "None · On", a date, or the tenant's own text, joined by " · ". */
  valueOf(f: FieldView): string {
    return f.value.map((p: ValuePart) => ('text' in p ? p.text : 'date' in p ? this.format.date(p.date) : this.translate.instant(p.key))).join(' · ');
  }

  withdrawnBody(h: Extract<SharePointHealth, { state: 'withdrawn' }>): string {
    return this.translate.instant(`storage.sp.withdrawn.${h.reason ?? 'UNKNOWN'}`, { library: this.settings().sharepoint.libraryName ?? '' });
  }
}
