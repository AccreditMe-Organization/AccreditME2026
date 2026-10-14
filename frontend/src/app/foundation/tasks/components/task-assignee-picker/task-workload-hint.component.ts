import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export type WorkloadHintState = 'offer' | 'working' | 'shown' | 'refusal';

/** The sentence's parts, worded by the picker (names, counts, the record phrase). */
export interface WorkloadHintView {
  sentence: string;
  /** On screen: "Assign instead". */
  assignLabel: string;
  /** Its accessible name, naming the person: "Assign instead: Huda Al-Harbi". */
  assignAria: string;
  keepLabel: string;
  keepAria: string;
}

/**
 * ACC-199 — the line under the assignee picker that carries "✦ Suggest
 * someone", and the answer to it. Plan: backend/Plans/step-199-workload-hint.md
 * §2.2.
 *
 *   offer    the plain outcome, with "✦ Suggest someone" at its end edge
 *   working  the same, the button reading "◌ Suggesting…", disabled and busy
 *   shown    the hint, marked "✦ AI ·" with a dashed rule on the INLINE-START
 *            edge, then "Assign … instead" · "Keep …"
 *   refusal  the plain outcome, and the reason on a quiet line under it
 *
 * NOT am-ai-assist (Q8, decided): the drawing makes the hint the outcome
 * line's own text — no card, no tint, nothing to accept or edit — and
 * am-ai-assist's stylesheet sits at its build budget. It keeps the AI marks the
 * pattern requires: the ✦ (hidden from screen readers) beside words, never an
 * icon alone; the "AI" words; the dashed inline-start rule.
 *
 * `inline` (Reassign): the two actions follow the sentence on its own lines
 * instead of a line of their own, which is what lets Reassign keep the hint
 * under the 420px cap.
 *
 * It decides nothing and calls nothing: the picker owns the state and words
 * every sentence.
 */
@Component({
  selector: 'app-task-workload-hint',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div #region class="am-wh" [class.am-wh--ai]="state() === 'shown'" tabindex="-1" aria-live="polite">
      @switch (state()) {
        @case ('shown') {
          @if (view(); as v) {
            <p class="am-wh__text">
              <span class="am-wh__tag"><span aria-hidden="true">✦</span> {{ 'task.workload.tag' | translate }} ·</span>
              {{ v.sentence }}
              @if (inline()) {
                <span class="am-wh__actions am-wh__actions--inline">
                  <button type="button" class="am-wh__action" [attr.aria-label]="v.assignAria" (click)="assign.emit()">
                    {{ v.assignLabel }}
                  </button>
                  <button type="button" class="am-wh__action" [attr.aria-label]="v.keepAria" (click)="keep.emit()">
                    {{ v.keepLabel }}
                  </button>
                </span>
              }
            </p>
            @if (!inline()) {
              <div class="am-wh__actions">
                <button type="button" class="am-wh__action" [attr.aria-label]="v.assignAria" (click)="assign.emit()">
                  {{ v.assignLabel }}
                </button>
                <button type="button" class="am-wh__action" [attr.aria-label]="v.keepAria" (click)="keep.emit()">
                  {{ v.keepLabel }}
                </button>
              </div>
            }
          }
        }
        @default {
          <p class="am-wh__text am-wh__line">
            <span class="am-wh__outcome">{{ outcome() }}</span>
            @if (state() === 'offer') {
              <button type="button" class="am-wh__suggest" (click)="suggest.emit()">
                <span aria-hidden="true">✦</span> {{ 'task.workload.suggest' | translate }}
              </button>
            } @else if (state() === 'working') {
              <button type="button" class="am-wh__suggest" disabled aria-busy="true">
                <span aria-hidden="true">◌</span> {{ 'task.workload.suggesting' | translate }}
              </button>
            }
          </p>
          @if (state() === 'refusal') {
            <p class="am-wh__refusal" [class.am-wh__refusal--failed]="retryable()">
              {{ refusalText() }}
              @if (retryable()) {
                <button type="button" class="am-wh__action" (click)="suggest.emit()">{{ 'ai.assist.retry' | translate }}</button>
              }
            </p>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .am-wh:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-wh__text,
      .am-wh__refusal {
        margin: 0;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-500);
      }
      .am-wh__line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        column-gap: var(--am-space-8);
      }
      /* The marks: the ✦ and the words, and a dashed rule on the inline-start edge. */
      .am-wh--ai {
        border-inline-start: 2px dashed var(--am-primary-600);
        padding-inline-start: var(--am-space-8);
      }
      .am-wh--ai .am-wh__text {
        color: var(--am-ink-900);
      }
      .am-wh__tag {
        font-weight: 600;
        color: var(--am-primary-700);
      }
      .am-wh__refusal--failed {
        color: var(--am-danger-ink);
      }
      .am-wh__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-4) var(--am-space-12);
        margin-block-start: var(--am-space-2);
      }
      .am-wh__actions--inline {
        display: inline-flex;
        margin: 0;
        margin-inline-start: var(--am-space-4);
      }
      /* Text buttons at the line's own height, so a line of them is a line. */
      .am-wh__action,
      .am-wh__suggest {
        font: inherit;
        line-height: var(--am-type-meta-line);
        padding: 0;
        border: 0;
        background: transparent;
        cursor: pointer;
        white-space: nowrap;
        color: var(--am-primary-700);
        font-weight: 600;
      }
      .am-wh__suggest:disabled {
        color: var(--am-ink-500);
        cursor: progress;
      }
      .am-wh__action:focus-visible,
      .am-wh__suggest:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
    `,
  ],
})
export class TaskWorkloadHintComponent {
  private readonly injector = inject(Injector);

  readonly state = input.required<WorkloadHintState>();
  /** The plain outcome the line always starts from ("Goes to Nora Al-Otaibi."). */
  readonly outcome = input('');
  readonly view = input<WorkloadHintView | null>(null);
  readonly refusalText = input('');
  /** A failed call (not "nobody", not credits used up) offers Try again. */
  readonly retryable = input(false);
  /** Reassign: the actions follow the sentence instead of taking a line. */
  readonly inline = input(false);

  readonly suggest = output<void>();
  readonly assign = output<void>();
  readonly keep = output<void>();

  private readonly region = viewChild<ElementRef<HTMLElement>>('region');
  private readonly arrived = computed(() => this.state() === 'shown' || this.state() === 'refusal');

  constructor() {
    // The button that was pressed is gone once the answer arrives: focus goes
    // to the answer, so a keyboard user lands on it (and it is announced).
    effect(() => {
      if (!this.arrived()) return;
      afterNextRender(() => this.region()?.nativeElement.focus(), { injector: this.injector });
    });
  }
}
