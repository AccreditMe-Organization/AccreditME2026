import {
  Component,
  ElementRef,
  TemplateRef,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  input,
  output,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import type { AiRefusal } from '../../../core/ai/ai-refusal';

export type AiAssistState = 'idle' | 'working' | 'result' | 'refusal';
export type AiAssistPlacement = 'card' | 'inline' | 'header';

/**
 * am-ai-assist — the ONE AI pattern (ACC-198), from the drawing "AccreditMe AI
 * for Users" §1 (accepted 10 Oct). Every AI place in the product is this
 * component: the Home briefing (ACC-198), Summarize in the viewer (ACC-193),
 * Draft with AI on New task (ACC-197).
 *
 *   - TRIGGER: the spark ✦ (aria-hidden) PLUS words — never an icon alone.
 *     While working the mark becomes ◌ and pulses, and the words read
 *     "Working…". Once a result exists it reads `againLabel` ("Draft again",
 *     "Make a new briefing"). `triggerNote` is an optional quiet note after
 *     the words (the briefing's "· 5 credits", ACC-198 D2).
 *   - WORKING: the result area opens at once with a calm placeholder.
 *   - RESULT: marked FOUR ways, never by colour alone — the ✦ mark, the tag
 *     words, a dashed rule on the INLINE-START edge, and a light tint. The
 *     content is the host's `resultTemplate` (TemplateRef + ngTemplateOutlet,
 *     never ng-content: ACC-29). `accept` adds Accept / Edit / Discard.
 *   - REFUSAL: after a press, inside the result area, never a modal — from
 *     ACC-194's shared helper (core/ai/ai-refusal.ts), so every place reads
 *     the same words. "Unavailable" (a failed or impossible call) offers Try
 *     again.
 *   - ANNOUNCED: results and refusals arrive in a polite live region, and
 *     focus moves to the result.
 *
 * It makes NO request. The host calls its own endpoint and sets `state`; the
 * model is reached only through the backend's AiService (check:ai-gateway).
 *
 * NOT built, stated for ACC-193 and ACC-197: the drawing's "paused by
 * AccreditMe" and "turned off by AccreditMe" lines that replace a trigger in
 * place. Neither state exists on the platform yet (ACC-194: only
 * settings.ai.enabled, which nothing writes); add an input when one does.
 */
@Component({
  selector: 'am-ai-assist',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe],
  template: `
    <div class="am-ai" [class]="'am-ai am-ai--' + placement()">
      @if (!hideTrigger()) {
        <div class="am-ai__trigger-row">
          <button
            type="button"
            class="am-ai__trigger"
            [class.am-ai__trigger--working]="state() === 'working'"
            [disabled]="state() === 'working'"
            [attr.aria-busy]="state() === 'working'"
            (click)="trigger.emit()"
          >
            <span class="am-ai__mark" aria-hidden="true">{{ state() === 'working' ? '◌' : '✦' }}</span>
            <span>{{ state() === 'working' ? ('ai.assist.working' | translate) : triggerWords() }}</span>
            @if (triggerNote() && state() !== 'working') {
              <span class="am-ai__note">{{ triggerNote() }}</span>
            }
          </button>
          @if (state() === 'working' && cancellable()) {
            <button type="button" class="am-ai__text-button" (click)="cancel.emit()">{{ 'ai.assist.cancel' | translate }}</button>
          }
        </div>
      }

      @switch (state()) {
        @case ('working') {
          <div class="am-ai__result am-ai__result--working" role="status">
            @if (tag()) {
              <p class="am-ai__tag"><span aria-hidden="true">✦</span> {{ tag() }}</p>
            }
            <p class="am-ai__working-text">{{ workingText() }}</p>
            <div class="am-ai__pulse" aria-hidden="true"><span></span><span></span><span></span></div>
          </div>
        }
        @case ('result') {
          <section #resultRegion class="am-ai__result" tabindex="-1" [attr.aria-label]="tag() || ('ai.assist.resultLabel' | translate)">
            @if (tag()) {
              <p class="am-ai__tag"><span aria-hidden="true">✦</span> {{ tag() }}</p>
            }
            @if (resultTemplate(); as tpl) {
              <ng-container [ngTemplateOutlet]="tpl" />
            }
            @if (accept()) {
              <div class="am-ai__actions">
                <button type="button" class="am-ai__primary" (click)="accepted.emit()">{{ 'ai.assist.accept' | translate }}</button>
                <button type="button" class="am-ai__secondary" (click)="edited.emit()">{{ 'ai.assist.edit' | translate }}</button>
                <button type="button" class="am-ai__text-button" (click)="discarded.emit()">{{ 'ai.assist.discard' | translate }}</button>
              </div>
            }
          </section>
        }
        @case ('refusal') {
          @if (refusal(); as r) {
            <div class="am-ai__refusal" [class.am-ai__refusal--failed]="r.kind === 'unavailable'">
              <p class="am-ai__refusal-text">
                <span aria-hidden="true">{{ glyph() }}</span> {{ r.messageKey | translate: r.params }}
              </p>
              @if (r.kind === 'unavailable') {
                <button type="button" class="am-ai__secondary" (click)="retry.emit()">{{ 'ai.assist.retry' | translate }}</button>
              }
            </div>
          }
        }
      }

      <p class="sr-only" aria-live="polite">{{ announcement() | translate: announcementParams() }}</p>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .am-ai {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
      }
      .am-ai__trigger-row {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        flex-wrap: wrap;
      }
      .am-ai--inline .am-ai__trigger-row,
      .am-ai--header .am-ai__trigger-row {
        justify-content: flex-end;
      }
      .am-ai__trigger {
        display: inline-flex;
        align-items: center;
        gap: var(--am-space-6);
        font: inherit;
        font-size: var(--am-type-meta-size);
        font-weight: 600;
        white-space: nowrap;
        border-radius: var(--am-radius-button);
        padding: var(--am-space-4) var(--am-space-12);
        background: var(--am-control-bg);
        color: var(--am-primary-700);
        border: 1px solid var(--am-primary-600);
        cursor: pointer;
      }
      .am-ai__trigger:focus-visible,
      .am-ai__secondary:focus-visible,
      .am-ai__primary:focus-visible,
      .am-ai__text-button:focus-visible,
      .am-ai__result:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-ai__trigger--working {
        background: var(--am-surface);
        color: var(--am-ink-700);
        border-color: var(--am-border-strong);
        cursor: progress;
      }
      .am-ai__mark {
        color: var(--am-primary-600);
      }
      .am-ai__trigger--working .am-ai__mark {
        animation: am-ai-pulse 1.2s infinite;
      }
      .am-ai__note {
        font-weight: 400;
        color: var(--am-ink-500);
      }
      /* The four marks: ✦, the tag words, the dashed INLINE-START rule, the tint. */
      .am-ai__result {
        background: var(--am-primary-50);
        border: 1px solid var(--am-info-border);
        border-inline-start: 3px dashed var(--am-primary-600);
        border-radius: var(--am-radius-card);
        padding: var(--am-space-12) var(--am-space-16);
      }
      .am-ai__tag {
        margin: 0 0 var(--am-space-4);
        font-size: var(--am-type-meta-size);
        font-weight: 600;
        color: var(--am-primary-700);
      }
      .am-ai__working-text {
        margin: 0;
        color: var(--am-ink-700);
      }
      .am-ai__pulse {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-6);
        margin-block-start: var(--am-space-8);
      }
      .am-ai__pulse span {
        display: block;
        height: 8px;
        border-radius: var(--am-radius-pill);
        background: var(--am-skeleton-base);
        animation: am-ai-pulse 1.2s infinite;
      }
      .am-ai__pulse span:nth-child(2) {
        width: 80%;
      }
      .am-ai__pulse span:nth-child(3) {
        width: 55%;
      }
      .am-ai__actions {
        display: flex;
        gap: var(--am-space-8);
        margin-block-start: var(--am-space-8);
      }
      .am-ai__refusal {
        border-radius: var(--am-radius-card);
        padding: var(--am-space-12);
        border: 1px solid var(--am-border);
        background: var(--am-surface);
      }
      .am-ai__refusal--failed {
        border-color: var(--am-danger-border);
        background: var(--am-danger-bg);
      }
      .am-ai__refusal-text {
        margin: 0;
      }
      .am-ai__refusal--failed .am-ai__refusal-text {
        color: var(--am-danger-ink);
        font-weight: 500;
      }
      .am-ai__refusal .am-ai__secondary {
        margin-block-start: var(--am-space-8);
      }
      .am-ai__primary,
      .am-ai__secondary,
      .am-ai__text-button {
        font: inherit;
        font-size: var(--am-type-meta-size);
        border-radius: var(--am-radius-button);
        padding: var(--am-space-4) var(--am-space-12);
        cursor: pointer;
        white-space: nowrap;
      }
      .am-ai__primary {
        background: var(--am-primary-600);
        color: var(--am-control-bg);
        border: 1px solid var(--am-primary-700);
        font-weight: 600;
      }
      .am-ai__secondary {
        background: var(--am-control-bg);
        color: var(--am-ink-900);
        border: 1px solid var(--am-ink-500);
      }
      .am-ai__text-button {
        background: transparent;
        color: var(--am-primary-600);
        border: 1px solid transparent;
      }
      @keyframes am-ai-pulse {
        0%,
        100% {
          opacity: 0.55;
        }
        50% {
          opacity: 1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .am-ai__trigger--working .am-ai__mark,
        .am-ai__pulse span {
          animation: none;
        }
      }
    `,
  ],
})
export class AiAssistComponent {
  private readonly injector = inject(Injector);

  readonly state = input<AiAssistState>('idle');
  readonly triggerLabel = input.required<string>();
  /** The words once a result exists ("Make a new briefing", "Draft again"). */
  readonly againLabel = input<string>('');
  readonly triggerNote = input<string>('');
  readonly workingText = input<string>('');
  readonly tag = input<string>('');
  readonly refusal = input<AiRefusal | null>(null);
  readonly cancellable = input(false);
  readonly accept = input(false);
  readonly hideTrigger = input(false);
  readonly placement = input<AiAssistPlacement>('card');
  readonly resultTemplate = input<TemplateRef<unknown> | null>(null);
  /** True when a result already exists (even after a later refusal), so the trigger reads againLabel. */
  readonly hasResult = input(false);

  readonly trigger = output<void>();
  readonly cancel = output<void>();
  readonly retry = output<void>();
  readonly accepted = output<void>();
  readonly edited = output<void>();
  readonly discarded = output<void>();

  private readonly resultRegion = viewChild<ElementRef<HTMLElement>>('resultRegion');

  readonly triggerWords = computed(() => ((this.state() === 'result' || this.hasResult()) && this.againLabel() ? this.againLabel() : this.triggerLabel()));

  readonly glyph = computed(() => {
    const kind = this.refusal()?.kind;
    if (kind === 'creditsUsedUp') return '◔';
    if (kind === 'unavailable') return '!';
    return '○';
  });

  readonly announcement = computed(() => {
    if (this.state() === 'result') return 'ai.assist.ready';
    if (this.state() === 'refusal') return this.refusal()?.messageKey ?? '';
    return '';
  });
  readonly announcementParams = computed(() => (this.state() === 'refusal' ? (this.refusal()?.params ?? {}) : {}));

  constructor() {
    // Focus moves to the result when it arrives, so a keyboard user lands on it.
    effect(() => {
      if (this.state() !== 'result') return;
      afterNextRender(() => this.resultRegion()?.nativeElement.focus(), { injector: this.injector });
    });
  }
}
