import { Component, ElementRef, Injector, afterNextRender, effect, inject, output, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AiAssistComponent } from '../../../../shared/components/ai-assist/ai-assist.component';
import { TaskDraftStore } from './task-draft.store';

/**
 * ACC-197 — what "Draft with AI" shows under the Description field: the
 * working line, the suggestion, or a refusal. The result half of the one AI
 * pattern (am-ai-assist with `hideTrigger`).
 *
 * THE SUGGESTION: three labelled lines — the labels are the server's, in the
 * reader's language — then the suggested title on one line, then Accept ·
 * Edit · Discard with "Use this title" at the row's far end. Each line is
 * `dir="auto"`, so a code or a number inside Arabic text keeps its own order.
 *
 * DRAWN SMALL ON PURPOSE (the 420px cap, measured): the lines are at the meta
 * step, and the title is a line rather than a box. At the body step with a
 * boxed title the worst case measured 507 / 585 px. See the layout spec.
 *
 * EIGHT LINES, AND NEVER MORE: the server's caps make a draft eight lines at
 * most in ordinary prose (2 + 3 + 2 and the title). The text block is also
 * HELD to eight lines and scrolls inside itself past that, so no wording —
 * very wide letters, an unbroken string — can push the dialog body over its
 * cap. That is the inner-scroll escape (EditDialogComponent, ACC-120), and
 * its one condition holds: nothing in the block opens a floating panel.
 *
 * "Accept or discard the suggestion first." (§2.2) appears here when Create
 * task is pressed while the working line or a suggestion is showing, and focus
 * moves to this card.
 */
@Component({
  selector: 'app-task-draft-card',
  standalone: true,
  imports: [AiAssistComponent, TranslatePipe],
  template: `
    @if (store.state() !== 'idle') {
      <div #card class="am-draft" tabindex="-1">
        <am-ai-assist
          [hideTrigger]="true"
          triggerLabel=""
          [state]="store.state()"
          [tag]="'task.draft.tag' | translate"
          [workingText]="'task.draft.working' | translate"
          [refusal]="store.refusal()"
          [accept]="true"
          [resultTemplate]="suggestion"
          [actionsExtra]="titleAction"
          (accepted)="accepted.emit({ focus: false })"
          (edited)="accepted.emit({ focus: true })"
          (discarded)="store.discard()"
          (retry)="store.retry()"
        />
        @if (store.settleRequests() > 0 && store.unsettled()) {
          <p class="am-draft__settle" role="alert">{{ 'task.draft.settleFirst' | translate }}</p>
        }
      </div>
    }

    <ng-template #suggestion>
      @if (store.draft(); as draft) {
        <div class="am-draft__text">
          @for (line of draft.lines; track line.label) {
            <p class="am-draft__line" dir="auto">
              <span class="am-draft__label">{{ line.label }}</span> {{ line.text }}
            </p>
          }
          @if (draft.title && !store.titleUsed()) {
            <p class="am-draft__title" dir="auto">{{ 'task.draft.titleIs' | translate: { title: draft.title } }}</p>
          }
        </div>
      }
    </ng-template>

    <ng-template #titleAction>
      @if (store.draft()?.title && !store.titleUsed()) {
        <button type="button" class="am-draft__title-button" (click)="titleChosen.emit()">{{ 'task.draft.useTitle' | translate }}</button>
      }
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .am-draft:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-draft__text {
        max-height: calc(var(--am-type-meta-line) * 8);
        overflow-y: auto;
        overflow-wrap: anywhere;
      }
      .am-draft__line,
      .am-draft__title {
        margin: 0;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-900);
      }
      .am-draft__label {
        font-weight: 600;
      }
      .am-draft__title {
        color: var(--am-ink-700);
      }
      /* The size and shape of the row's own Edit button, which it sits beside. */
      .am-draft__title-button {
        font: inherit;
        font-size: var(--am-type-meta-size);
        white-space: nowrap;
        cursor: pointer;
        border-radius: var(--am-radius-button);
        padding: var(--am-space-4) var(--am-space-12);
        background: var(--am-control-bg);
        color: var(--am-ink-900);
        border: 1px solid var(--am-ink-500);
      }
      .am-draft__title-button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-draft__settle {
        margin: var(--am-space-4) 0 0;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        font-weight: 500;
        color: var(--am-danger-ink);
      }
    `,
  ],
})
export class TaskDraftCardComponent {
  readonly store = inject(TaskDraftStore);
  private readonly injector = inject(Injector);

  /** Accept (focus false) and Edit (focus true): the form puts the text in the field. */
  readonly accepted = output<{ focus: boolean }>();
  /** "Use this title": the form sets the Title on step 1. */
  readonly titleChosen = output<void>();

  private readonly card = viewChild<ElementRef<HTMLElement>>('card');

  constructor() {
    // §2.2 — every press of Create task while a draft is unsettled moves focus
    // here, including the press made from step 1 (the card renders, then this runs).
    effect(() => {
      if (this.store.settleRequests() === 0) return;
      afterNextRender(() => this.card()?.nativeElement.focus(), { injector: this.injector });
    });
  }
}
