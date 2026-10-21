import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin, of, catchError } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../core/formatting';
import { BreadcrumbParentService } from '../../../core/navigation/breadcrumb-parent.service';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { WorkflowStageIndicatorComponent } from '../../workflow/components/workflow-stage-indicator/workflow-stage-indicator.component';
import { WorkflowInstanceDto, WorkflowService } from '../../workflow/services/workflow.service';
import { CommitteeDetailDto, CommitteeService } from '../services/committee.service';
import { ChangeRequestDecision, ChangeRequestDecisionDialogComponent } from './change-request-decision-dialog.component';
import { ChangeRequestChangesComponent, ChangeRow } from './change-request-changes.component';
import { APPROVE_LIST_MAX, ChangeRequestText, ImpactLineText, changedFields } from './change-request-text';
import { ChangeField, ChangeRequestDto, ChangeRequestLabelsDto, ChangeRequestPreviewDto, ChangeRequestService, ChangeValue } from './change-request.service';
import { injectIsPhone } from './phone';

type Phase = 'loading' | 'error' | 'notFound' | 'ready';
type PreviewState = 'none' | 'loading' | 'failed' | 'ready';

/** The request's closed stages, by key; any other stage (one with no key too) is open. A display choice: who may act is `actions`. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['approved', 'rejected', 'withdrawn']);


function same(a: ChangeValue | undefined, b: ChangeValue | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * ACC-240 — one committee change request (`/committees/:id/change-requests/:requestId`),
 * plan §3.3.
 *
 * Every button is a flag of the server's `actions`; the page decides nothing
 * about who may act. What it does decide is display: the Current column shows
 * the live value while the request is open (marked when it has moved since
 * Submit), the stored value struck through once applied, and for a request
 * that closed without applying, the stored value if it was ever submitted.
 * Banners follow the stage KEY. Below the shared phone width the actions sit
 * in a sticky bar, a region named for the request.
 */
@Component({
  selector: 'am-committee-change-request-page',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ButtonModule, PageHeaderComponent, WorkflowStageIndicatorComponent, ChangeRequestDecisionDialogComponent, ChangeRequestChangesComponent],
  template: `
    @switch (phase()) {
      @case ('loading') {
        <div class="am-crp" aria-busy="true" data-testid="crp-loading">
          <span class="sr-only" role="status">{{ 'committee.changeRequest.page.loading' | translate }}</span>
          <div class="am-crp__skel" style="block-size:64px"></div>
          <div class="am-crp__skel" style="block-size:200px"></div>
          <div class="am-crp__skel" style="block-size:140px"></div>
        </div>
      }
      @case ('error') {
        <div class="am-crp__state" role="alert" data-testid="crp-error">
          <span>{{ 'committee.changeRequest.page.error' | translate }}</span>
          <button type="button" class="am-crp__link" (click)="load()">{{ 'common.retry' | translate }}</button>
        </div>
      }
      @case ('notFound') {
        <div class="am-crp__state am-crp__state--block" data-testid="crp-not-found">
          <app-page-header [title]="'committee.changeRequest.page.notFound' | translate" [purpose]="'committee.changeRequest.page.notFoundBody' | translate" />
          <a class="am-crp__link" [routerLink]="['/committees', committeeId]">{{ 'committee.changeRequest.page.backToCommittee' | translate }}</a>
        </div>
      }
      @case ('ready') {
        @if (request(); as r) {
          <div class="am-crp" [class.am-crp--phone]="phone()">
            <app-page-header [eyebrow]="eyebrow()" [title]="title()">
              <span pageMeta class="am-crp__chips">
                <span class="am-crp__chip" [attr.data-status]="r.status" data-testid="crp-status">{{ text.status(r.status) }}</span>
                @if (whoChip(); as who) {
                  <span class="am-crp__chip am-crp__chip--plain" data-testid="crp-who">{{ who }}</span>
                }
              </span>
              @if (!phone()) {
                <span pageActions class="am-crp__actions" data-testid="crp-actions">
                  <ng-container [ngTemplateOutlet]="actionsTpl" />
                </span>
              }
            </app-page-header>

            @if (actionError(); as e) {
              <p class="am-crp__banner am-crp__banner--danger" role="alert" data-testid="crp-action-error">
                {{ e.text }}
                @if (e.retry) {
                  <button type="button" class="am-crp__link" (click)="e.again()">{{ 'common.retry' | translate }}</button>
                }
              </p>
            }

            <!-- Banners, by stage key and viewer. -->
            @if (r.status === 'returned') {
              <div class="am-crp__banner am-crp__banner--warning" data-testid="crp-banner-returned">
                <strong>{{ 'committee.changeRequest.page.returnedTitle' | translate }}</strong>
                <span>{{ 'committee.changeRequest.page.returnedBody' | translate: { note: r.returnNote ?? '', name: r.decidedBy?.name ?? '', date: format.date(r.decidedAt) } }}</span>
              </div>
            }
            @if (r.status === 'approved') {
              <div class="am-crp__banner am-crp__banner--success" data-testid="crp-banner-applied">
                <strong>{{ 'committee.changeRequest.page.appliedTitle' | translate: { date: format.date(r.appliedAt ?? r.decidedAt) } }}</strong>
                <span>
                  {{ 'committee.changeRequest.page.appliedBody' | translate: { name: r.requestedBy.name } }}
                  @if (taskLink(); as link) {
                    <a class="am-crp__link" [routerLink]="link" data-testid="crp-open-task">{{ 'committee.changeRequest.page.openTask' | translate }}</a>
                  }
                </span>
              </div>
            }
            @if (r.status === 'rejected') {
              <div class="am-crp__banner am-crp__banner--danger" data-testid="crp-banner-rejected">
                <strong>{{ 'committee.changeRequest.page.rejectedTitle' | translate: { name: r.decidedBy?.name ?? '', date: format.date(r.decidedAt) } }}</strong>
                <span>{{ 'committee.changeRequest.page.rejectedBody' | translate: { reason: r.rejectionReason ?? '' } }}</span>
              </div>
            }
            @if (r.status === 'withdrawn') {
              <div class="am-crp__banner" data-testid="crp-banner-withdrawn">
                <strong>{{ 'committee.changeRequest.page.withdrawnTitle' | translate: { name: r.withdrawnBy?.name ?? '', date: format.date(r.withdrawnAt) } }}</strong>
                <span>{{ 'committee.changeRequest.page.nothingChanged' | translate }}</span>
              </div>
            }
            @if (isOpen() && committee()?.isDissolving) {
              <div class="am-crp__banner am-crp__banner--warning" data-testid="crp-banner-dissolving">
                <strong>{{ 'committee.changeRequest.page.dissolvingTitle' | translate }}</strong>
                <span>{{ 'committee.changeRequest.page.dissolvingBody' | translate }}</span>
              </div>
            }
            @if (hasDrift()) {
              <div class="am-crp__banner am-crp__banner--warning" data-testid="crp-banner-drift">
                <strong>{{ 'committee.changeRequest.page.driftTitle' | translate }}</strong>
                <span>{{ 'committee.changeRequest.page.driftBody' | translate }}</span>
              </div>
            }
            @if (r.status === 'under_review' && isRequester()) {
              <p class="am-crp__banner am-crp__banner--info" data-testid="crp-banner-waiting">
                {{ 'committee.changeRequest.page.waiting' | translate: { date: format.date(r.submittedAt) } }}
              </p>
            }

            @if (instance(); as instance) {
              <section class="am-crp__card" data-testid="crp-stepper">
                <app-workflow-stage-indicator [instance]="instance" show="sequence" />
              </section>
            }

            <section class="am-crp__card" aria-labelledby="crp-h-changes" data-testid="crp-changes">
              <div class="am-crp__card-head">
                <h2 class="am-crp__h" id="crp-h-changes">
                  {{ (isClosedUnapplied() ? 'committee.changeRequest.page.whatItAsked' : 'committee.changeRequest.page.whatChanges') | translate }}
                </h2>
                <span class="am-crp__muted">{{ 'committee.changeRequest.page.changedOnly' | translate }}</span>
              </div>
              <am-change-request-changes [rows]="rows()" [phone]="phone()" />
            </section>

            <section class="am-crp__card" aria-labelledby="crp-h-reason">
              <h2 class="am-crp__h" id="crp-h-reason">{{ 'committee.changeRequest.page.reason' | translate }}</h2>
              <p class="am-crp__reason" data-testid="crp-reason">{{ r.reason }}</p>
            </section>

            @if (isOpen()) {
              <section class="am-crp__card" aria-labelledby="crp-h-impact" data-testid="crp-impact">
                <h2 class="am-crp__h" id="crp-h-impact">{{ 'committee.changeRequest.impact.title' | translate }}</h2>
                @switch (previewState()) {
                  @case ('loading') {
                    <p class="am-crp__muted" role="status">{{ 'committee.changeRequest.impact.loading' | translate }}</p>
                  }
                  @case ('failed') {
                    <p class="am-crp__muted" data-testid="crp-impact-failed">
                      {{ 'committee.changeRequest.impact.failed' | translate }}
                      <button type="button" class="am-crp__link" (click)="loadPreview()">{{ 'common.retry' | translate }}</button>
                    </p>
                  }
                  @case ('ready') {
                    <dl class="am-crp__lines">
                      @for (line of impactLines(); track $index) {
                        <div class="am-crp__line" data-testid="crp-impact-line">
                          <dt>{{ line.key }}</dt>
                          <dd>{{ line.value }}</dd>
                        </div>
                      }
                    </dl>
                  }
                  @default {
                    <p class="am-crp__muted">{{ 'committee.changeRequest.impact.none' | translate }}</p>
                  }
                }
              </section>
            }

            @if (instance(); as instance) {
              <section class="am-crp__card" aria-labelledby="crp-h-history" data-testid="crp-history">
                <h2 class="am-crp__h" id="crp-h-history">{{ 'committee.stageHistory' | translate }}</h2>
                <app-workflow-stage-indicator [instance]="instance" show="history" />
              </section>
            }

            @if (phone() && hasActions()) {
              <div class="am-crp__bar" role="region" [attr.aria-label]="actionsRegion()" data-testid="crp-bar">
                <ng-container [ngTemplateOutlet]="actionsTpl" />
              </div>
            }
          </div>

          <ng-template #actionsTpl>
            @if (canEdit()) {
              <p-button [label]="'common.edit' | translate" icon="pi pi-pencil" size="small" [outlined]="true" (onClick)="edit()" data-testid="crp-edit" />
            }
            @if (r.actions.submit) {
              <p-button [label]="'committee.changeRequest.action.submit' | translate" size="small" [loading]="busy() === 'submit'" (onClick)="submit()" data-testid="crp-submit" />
            }
            @if (r.actions.approve) {
              <p-button [label]="'committee.changeRequest.action.approve' | translate" size="small" (onClick)="approve()" data-testid="crp-approve" />
            }
            @if (r.actions.return) {
              <p-button [label]="'committee.changeRequest.action.return' | translate" size="small" [outlined]="true" (onClick)="decision.set('return')" data-testid="crp-return" />
            }
            @if (r.actions.reject) {
              <p-button [label]="'committee.changeRequest.action.reject' | translate" size="small" severity="danger" [outlined]="true" (onClick)="decision.set('reject')" data-testid="crp-reject" />
            }
            @if (r.actions.withdraw) {
              <p-button [label]="'committee.changeRequest.action.withdraw' | translate" size="small" severity="secondary" [text]="true" (onClick)="withdraw()" data-testid="crp-withdraw" />
            }
          </ng-template>

          @if (decision(); as kind) {
            <am-change-request-decision-dialog
              [kind]="kind"
              [request]="r"
              [visible]="true"
              (visibleChange)="!$event && decision.set(null)"
              (decided)="onDecided($event)"
            />
          }
        }
      }
    }
  `,
  styles: [
    `
      :host{display:block}
      .am-crp{display:flex;flex-direction:column;gap:var(--am-space-12);max-inline-size:1040px;min-inline-size:0}
      .am-crp__state{display:flex;align-items:center;gap:var(--am-space-8);padding:var(--am-space-16) 0;color:var(--am-ink-700)}
      .am-crp__state--block{flex-direction:column;align-items:flex-start}
      .am-crp__skel{border-radius:var(--am-radius-card);background:var(--am-skeleton-shimmer)}
      .am-crp__chips{display:inline-flex;flex-wrap:wrap;gap:var(--am-space-6);align-items:center}
      .am-crp__chip{display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--am-neutral-chip-bg);border:1px solid var(--am-neutral-chip-border);color:var(--am-neutral-chip-ink);white-space:nowrap}
      .am-crp__chip[data-status='under_review']{background:var(--am-info-bg);border-color:var(--am-info-border);color:var(--am-info-ink)}
      .am-crp__chip[data-status='approved']{background:var(--am-success-bg);border-color:var(--am-success-border);color:var(--am-success-ink)}
      .am-crp__chip[data-status='returned']{background:var(--am-warning-bg);border-color:var(--am-warning-border);color:var(--am-warning-ink)}
      .am-crp__chip[data-status='rejected']{background:var(--am-danger-bg);border-color:var(--am-danger-border);color:var(--am-danger-ink)}
      .am-crp__chip--plain{font-weight:500;background:none;border-color:transparent;color:var(--am-ink-700);white-space:normal}
      .am-crp__actions{display:inline-flex;flex-wrap:wrap;gap:var(--am-space-8)}
      .am-crp__banner{display:flex;flex-direction:column;gap:var(--am-space-2);margin:0;padding:10px 14px;border-radius:var(--am-radius-card);background:var(--am-neutral-chip-bg);border:1px solid var(--am-neutral-chip-border);color:var(--am-ink-900);overflow-wrap:anywhere}
      .am-crp__banner--info{background:var(--am-info-bg);border-color:var(--am-info-border);color:var(--am-info-ink)}
      .am-crp__banner--success{background:var(--am-success-bg);border-color:var(--am-success-border)}
      .am-crp__banner--warning{background:var(--am-warning-bg);border-color:var(--am-warning-border)}
      .am-crp__banner--danger{background:var(--am-danger-bg);border-color:var(--am-danger-border)}
      .am-crp__card{background:var(--am-card);border:1px solid var(--am-border);border-radius:var(--am-radius-card);padding:14px 18px;min-inline-size:0}
      .am-crp__card-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--am-space-4) var(--am-space-12);margin-block-end:var(--am-space-8)}
      .am-crp__h{margin:0;font-size:13px;font-weight:600;color:var(--am-ink-900)}
      .am-crp__card > .am-crp__h{margin-block-end:var(--am-space-8)}
      .am-crp__muted{margin:0;font-size:12.5px;color:var(--am-ink-700)}
      .am-crp__reason{margin:0;white-space:pre-line;overflow-wrap:anywhere}
      .am-crp__lines{margin:0;display:flex;flex-direction:column;gap:var(--am-space-8)}
      .am-crp__line{display:grid;grid-template-columns:minmax(0,220px) minmax(0,1fr);gap:var(--am-space-12);font-size:12.5px}
      .am-crp__line dt{font-weight:600;color:var(--am-ink-900);overflow-wrap:anywhere}
      .am-crp__line dd{margin:0;color:var(--am-ink-700);overflow-wrap:anywhere}
      .am-crp__link{font:inherit;font-weight:600;color:var(--am-primary-700);background:none;border:0;padding:0;margin-inline-start:var(--am-space-4);cursor:pointer;text-decoration:none}
      .am-crp__link:hover{text-decoration:underline}
      .am-crp__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      /* Phone: one column per row, and the actions in a bar that sticks to the
         bottom of the page while it scrolls. Sticky, not fixed, so the bar keeps
         its own place at the end of the page and nothing is ever behind it. */
      .am-crp--phone .am-crp__line{grid-template-columns:minmax(0,1fr);gap:var(--am-space-2)}
      .am-crp__bar{position:sticky;inset-block-end:-16px;z-index:2;display:flex;flex-wrap:wrap;gap:var(--am-space-8);margin-inline:-16px;margin-block-end:-16px;padding:12px 16px;background:var(--am-card);border-block-start:1px solid var(--am-border)}
      .am-crp__bar p-button{flex:1 1 auto}
      .am-crp__bar p-button .p-button{inline-size:100%}
    `,
  ],
})
export class CommitteeChangeRequestPageComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(ChangeRequestService);
  private readonly committees = inject(CommitteeService);
  private readonly workflow = inject(WorkflowService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(AmConfirmService);
  private readonly breadcrumb = inject(BreadcrumbParentService);
  protected readonly text = inject(ChangeRequestText);
  protected readonly format = inject(FormatService);
  protected readonly phone = injectIsPhone();

  readonly committeeId = this.route.snapshot.paramMap.get('id')!;
  readonly requestId = this.route.snapshot.paramMap.get('requestId')!;

  readonly phase = signal<Phase>('loading');
  readonly request = signal<ChangeRequestDto | null>(null);
  readonly committee = signal<CommitteeDetailDto | null>(null);
  readonly instance = signal<WorkflowInstanceDto | null>(null);
  readonly preview = signal<ChangeRequestPreviewDto | null>(null);
  readonly previewState = signal<PreviewState>('none');
  readonly decision = signal<ChangeRequestDecision | null>(null);
  readonly busy = signal<'submit' | 'approve' | 'withdraw' | null>(null);
  readonly actionError = signal<{ text: string; retry: boolean; again: () => void } | null>(null);

  readonly isOpen = computed(() => {
    const r = this.request();
    return !!r && !(r.status && CLOSED_STATUSES.has(r.status));
  });
  readonly isClosedUnapplied = computed(() => {
    const s = this.request()?.status;
    return s === 'rejected' || s === 'withdrawn';
  });
  readonly isRequester = computed(() => {
    const me = this.auth.currentUser()?.id;
    return !!me && me === this.request()?.requestedBy.id;
  });
  /** The server's answer for this viewer: the request's own `actions.edit`. */
  readonly canEdit = computed(() => !!this.request()?.actions.edit);
  readonly hasActions = computed(() => {
    const a = this.request()?.actions;
    return !!a && (a.edit || a.submit || a.approve || a.return || a.reject || a.withdraw);
  });

  readonly committeeName = computed(() => {
    const c = this.committee();
    const r = this.request();
    return c ? this.language.bilingual(c.nameEn, c.nameAr) : r ? this.language.bilingual(r.committeeNameEn, r.committeeNameAr) : '';
  });

  readonly eyebrow = computed(() => {
    this.translate.currentLang();
    const r = this.request();
    return r ? this.translate.instant('committee.changeRequest.page.eyebrow', { n: this.format.number(r.number) }) : '';
  });
  readonly title = computed(() => {
    this.translate.currentLang();
    const r = this.request();
    return r ? this.translate.instant('committee.changeRequest.page.title', { n: this.format.number(r.number), committee: this.committeeName() }) : '';
  });
  readonly actionsRegion = computed(() => {
    this.translate.currentLang();
    return this.translate.instant('committee.changeRequest.page.actionsRegion', { n: this.format.number(this.request()?.number ?? 0) });
  });

  /** Who and when, by stage key. */
  readonly whoChip = computed(() => {
    this.translate.currentLang();
    const r = this.request();
    if (!r) return '';
    const t = (key: string, params: Record<string, string>) => this.translate.instant(`committee.changeRequest.page.${key}`, params);
    switch (r.status) {
      case 'returned':
        return t('returnedBy', { name: r.decidedBy?.name ?? '', date: this.format.date(r.decidedAt) });
      case 'approved':
        return t('approvedBy', { name: r.decidedBy?.name ?? '' });
      case 'withdrawn':
        return t('withdrawnBy', { name: r.withdrawnBy?.name ?? '', date: this.format.date(r.withdrawnAt) });
      default:
        return t('requestedBy', { name: r.requestedBy.name, date: this.format.date(r.submittedAt ?? r.createdAt) });
    }
  });

  readonly labels = computed<ChangeRequestLabelsDto>(() => ({ ...(this.preview()?.labels ?? {}), ...(this.request()?.labels ?? {}) }));

  readonly rows = computed<ChangeRow[]>(() => {
    this.translate.currentLang();
    const r = this.request();
    if (!r) return [];
    const live = (this.committee() ?? {}) as unknown as Record<ChangeField, ChangeValue>;
    const from = r.fromValues;
    const labels = this.labels();
    return changedFields(r.changes).map((field) => {
      const proposed = r.changes[field] ?? null;
      let current: ChangeValue;
      let struck = false;
      let drift = false;
      if (r.status === 'approved') {
        current = from?.[field] ?? null;
        struck = true;
      } else if (this.isClosedUnapplied()) {
        current = from ? (from[field] ?? null) : (live[field] ?? null);
      } else {
        current = live[field] ?? null;
        drift = r.status === 'under_review' && !!from && field in from && !same(from[field], live[field]);
      }
      return {
        field,
        label: this.text.fieldLabel(field),
        current: this.text.value(field, current, labels),
        struck,
        proposed: this.text.value(field, proposed, labels),
        drift,
        long: field === 'purpose',
      };
    });
  });

  readonly hasDrift = computed(() => this.rows().some((row) => row.drift));

  readonly impactLines = computed<ImpactLineText[]>(() => {
    this.translate.currentLang();
    const p = this.preview();
    const r = this.request();
    return p && r ? p.impacts.map((i) => this.text.impact(i, this.labels(), r.requestedBy.name)) : [];
  });

  /** The terms-of-reference task, linked for its assignee (the requester) and its creator (the decider) only (D6). */
  readonly taskLink = computed(() => {
    const r = this.request();
    const me = this.auth.currentUser()?.id;
    if (!r?.termsTaskId || !me) return null;
    return me === r.requestedBy.id || me === r.decidedById ? ['/tasks', r.termsTaskId] : null;
  });

  constructor() {
    this.load();
    effect(() => {
      const name = this.committeeName();
      if (!name || this.phase() !== 'ready') return;
      untracked(() => this.breadcrumb.set(this.router.url, `/committees/${this.committeeId}`, name));
    });
  }

  ngOnDestroy(): void {
    this.breadcrumb.clear(this.router.url);
  }

  load(): void {
    this.phase.set('loading');
    this.actionError.set(null);
    forkJoin([
      this.service.get(this.requestId),
      this.committees.getById(this.committeeId).pipe(catchError(() => of(null))),
    ]).subscribe({
      next: ([request, committee]) => {
        // A request from another committee's URL is the same not-found as an invented id.
        if (request.committeeId !== this.committeeId) {
          this.phase.set('notFound');
          return;
        }
        this.request.set(request);
        this.committee.set(committee);
        this.phase.set('ready');
        this.loadInstance();
        this.loadPreview();
      },
      error: (err: unknown) => this.phase.set(err instanceof HttpErrorResponse && err.status === 404 ? 'notFound' : 'error'),
    });
  }

  private loadInstance(): void {
    this.workflow.getInstancesByObject('COMMITTEE_CHANGE_REQUEST', this.requestId).subscribe({
      next: (instances) => this.instance.set(instances[0] ?? null),
      error: () => this.instance.set(null),
    });
  }

  /** What approving would do now — open requests only. */
  loadPreview(): void {
    const r = this.request();
    if (!r || !this.isOpen() || !changedFields(r.changes).length) {
      this.previewState.set('none');
      return;
    }
    this.previewState.set('loading');
    this.service.preview(this.committeeId, r.changes).subscribe({
      next: (p) => {
        this.preview.set(p);
        this.previewState.set('ready');
      },
      error: () => this.previewState.set('failed'),
    });
  }

  edit(): void {
    void this.router.navigate(['/committees', this.committeeId, 'change-requests', this.requestId, 'edit']);
  }

  submit(): void {
    this.run('submit', () => this.service.submit(this.requestId), () => this.submit());
  }

  /** Approve: a confirm through ask(), the changes listed in words (D3), then the task it creates. */
  approve(): void {
    const r = this.request();
    if (!r) return;
    const fields = changedFields(r.changes);
    const live = (this.committee() ?? {}) as unknown as Record<ChangeField, ChangeValue>;
    const labels = this.labels();
    const details =
      fields.length > APPROVE_LIST_MAX
        ? [this.text.fieldListCapped(fields, APPROVE_LIST_MAX)]
        : fields.map((f) => this.text.span(f, live[f] ?? null, r.changes[f] ?? null, labels));
    this.confirm.ask({
      tone: 'neutral',
      header: this.translate.instant(fields.length === 1 ? 'committee.changeRequest.approve.headerOne' : 'committee.changeRequest.approve.header'),
      message: this.translate.instant('committee.changeRequest.approve.task', { name: r.requestedBy.name }),
      details,
      acceptLabel: this.translate.instant('committee.changeRequest.approve.button'),
      accept: () => this.run('approve', () => this.service.approve(this.requestId), () => this.approve()),
    });
  }

  withdraw(): void {
    const r = this.request();
    if (!r) return;
    this.confirm.ask({
      tone: 'destructive',
      header: this.translate.instant('committee.changeRequest.withdraw.header', { n: this.format.number(r.number) }),
      message: this.translate.instant('committee.changeRequest.withdraw.message'),
      acceptLabel: this.translate.instant('committee.changeRequest.withdraw.button'),
      rejectLabel: this.translate.instant('committee.changeRequest.withdraw.keep'),
      accept: () => this.run('withdraw', () => this.service.withdraw(this.requestId), () => this.withdraw()),
    });
  }

  onDecided(request: ChangeRequestDto): void {
    this.decision.set(null);
    this.afterMove(request);
  }

  private run(kind: 'submit' | 'approve' | 'withdraw', call: () => ReturnType<ChangeRequestService['submit']>, again: () => void): void {
    if (this.busy()) return;
    this.busy.set(kind);
    this.actionError.set(null);
    call().subscribe({
      next: (r) => {
        this.busy.set(null);
        this.afterMove(r);
      },
      error: (err: unknown) => {
        this.busy.set(null);
        const said = this.text.refusal(err, this.request()?.number ?? null);
        this.actionError.set({ text: said.text, retry: said.retry, again });
      },
    });
  }

  /** After any move: the request, its history, the committee and the preview, read again. */
  private afterMove(request: ChangeRequestDto): void {
    this.request.set(request);
    this.preview.set(null);
    this.committees.getById(this.committeeId).subscribe({ next: (c) => this.committee.set(c) });
    this.loadInstance();
    this.loadPreview();
  }
}
