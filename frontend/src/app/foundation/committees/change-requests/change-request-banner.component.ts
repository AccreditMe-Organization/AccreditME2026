import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../core/formatting';
import { ChangeRequestText, changedFields } from './change-request-text';
import { ChangeRequestDto } from './change-request.service';
import { injectIsPhone } from './phone';

export type ChangeRequestBannerState = 'loading' | 'error' | 'ready';

/**
 * ACC-240 — the committee page's open-request banner, between the header card
 * and the Lifecycle row (drawing L355). The page owns the open read, because
 * the same answer decides the header's "Request a change" (`canRaise`).
 *
 *   loading           nothing (the page does not move for most visits)
 *   error             "Couldn't check for an open change request." · Retry
 *   ready, no request nothing
 *   ready, a request  its stage's title, who and when, and View request
 *   a request naming no field this screen knows: "A change request is open." ·
 *   View request (Partial)
 *
 * Every word follows the request's stage KEY, never a name.
 */
@Component({
  selector: 'am-change-request-banner',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    @if (state() === 'error') {
      <div class="am-crb am-crb--error" role="status" data-testid="cr-banner-error">
        <span>{{ 'committee.changeRequest.banner.error' | translate }}</span>
        <button type="button" class="am-crb__retry" (click)="retry.emit()">{{ 'common.retry' | translate }}</button>
      </div>
    } @else if (state() === 'ready' && request(); as r) {
      <div class="am-crb" role="status" [attr.data-testid]="partial() ? 'cr-banner-partial' : 'cr-banner'">
        <div class="am-crb__row">
          <span class="am-crb__title">{{ partial() ? ('committee.changeRequest.banner.partial' | translate) : title() }}</span>
          <a class="am-crb__link" [routerLink]="['/committees', r.committeeId, 'change-requests', r.id]" data-testid="cr-banner-view">{{
            'committee.changeRequest.banner.view' | translate
          }}</a>
        </div>
        @if (!partial() && body(); as b) {
          <span class="am-crb__body">{{ b }}</span>
        }
      </div>
    }
  `,
  styles: [
    `
      :host{display:block}
      .am-crb{display:flex;flex-direction:column;gap:var(--am-space-4);padding:10px 14px;border-radius:var(--am-radius-card);background:var(--am-info-bg);border:1px solid var(--am-info-border)}
      .am-crb--error{flex-direction:row;align-items:center;gap:var(--am-space-8);background:var(--am-surface-raised);border-color:var(--am-border);color:var(--am-danger-ink)}
      .am-crb__row{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--am-space-4) var(--am-space-16)}
      .am-crb__title{font-weight:600;color:var(--am-ink-900);min-inline-size:0;overflow-wrap:anywhere}
      .am-crb__body{color:var(--am-ink-700);font-size:12.5px;overflow-wrap:anywhere}
      .am-crb__link,.am-crb__retry{flex:none;font:inherit;font-weight:600;color:var(--am-primary-700);background:none;border:0;padding:0;cursor:pointer;text-decoration:none}
      .am-crb__link:hover{text-decoration:underline}
      .am-crb__link:focus-visible,.am-crb__retry:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
    `,
  ],
})
export class ChangeRequestBannerComponent {
  private readonly text = inject(ChangeRequestText);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly phone = injectIsPhone();

  readonly state = input.required<ChangeRequestBannerState>();
  readonly request = input<ChangeRequestDto | null>(null);
  readonly retry = output<void>();

  private readonly fields = computed(() => changedFields(this.request()?.changes));

  /** A request this screen cannot name the fields of. */
  readonly partial = computed(() => this.fields().length === 0);

  readonly title = computed(() => {
    this.translate.currentLang();
    const r = this.request();
    if (!r) return '';
    const key = r.status === 'under_review' || r.status === 'draft' || r.status === 'returned' ? r.status : 'unknown';
    return this.translate.instant(`committee.changeRequest.banner.${key}`, { n: this.format.number(r.number), fields: this.text.fieldList(this.fields()) });
  });

  readonly body = computed(() => {
    this.translate.currentLang();
    const r = this.request();
    if (!r) return '';
    const name = r.requestedBy.name;
    if (r.status === 'returned') {
      const date = this.format.date(r.decidedAt);
      return this.phone()
        ? this.translate.instant('committee.changeRequest.banner.bodyPhone', { name, date })
        : this.translate.instant('committee.changeRequest.banner.bodyReturned', { name, date });
    }
    if (r.status === 'draft' || !r.submittedAt) {
      const date = this.format.date(r.createdAt);
      return this.phone()
        ? this.translate.instant('committee.changeRequest.banner.bodyPhone', { name, date })
        : this.translate.instant('committee.changeRequest.banner.bodyDraft', { name, date });
    }
    const date = this.format.date(r.submittedAt);
    return this.phone()
      ? this.translate.instant('committee.changeRequest.banner.bodyPhone', { name, date })
      : this.translate.instant('committee.changeRequest.banner.bodyUnderReview', { name, date });
  });
}
