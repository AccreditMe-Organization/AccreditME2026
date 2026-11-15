import { Component, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { UserService } from '../../services/user.service';
import { ResetRefusal, describeResetRefusal } from './two-step-refusal';
import { TwoStepMessageComponent } from './two-step-message.component';

/** Unicode first-strong isolate / pop: a Latin name inside an Arabic title. */
const FSI = '⁨';
const PDI = '⁩';

/**
 * Reset someone's two-step sign-in — ACC-164, "AccreditMe Two-step Sign-in"
 * screen 2. POST /users/:id/mfa/reset.
 *
 * A destructive 420 confirm with no fields: the title names the person (a
 * left-to-right isolate, so a Latin name reads right inside Arabic), one
 * paragraph, and Cancel (focused) / Reset. While sending, Cancel is disabled
 * and Escape and the backdrop do nothing (Q10).
 *
 * Refusals, from two-step-refusal.ts:
 *   - the account owner: the message REPLACES the paragraph, only Close (Q9);
 *   - already off: a blue message, only Close; closing refreshes the record;
 *   - signed in as someone else: the fallback, since the panel hides Reset;
 *   - unreachable: a red message, and pressing Reset again retries.
 */
@Component({
  selector: 'app-two-step-reset-dialog',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, EditDialogComponent, TwoStepMessageComponent],
  template: `
    <ng-template #bodyTpl>
      <div class="flex flex-col gap-3" data-two-step-reset-body>
        @if (!refusal()?.replacesBody) {
          <p class="am-two-step-reset-text">{{ 'userRecord.twoStep.resetBody' | translate }}</p>
        }
        @if (refusal(); as r) {
          <am-two-step-message [tone]="r.tone" [text]="r.key | translate" data-two-step-reset-message />
        }
      </div>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3" data-two-step-reset-footer>
        @if (refusal()?.closeOnly) {
          <p-button
            [label]="'common.close' | translate"
            severity="secondary"
            [outlined]="true"
            type="button"
            (onClick)="close()"
            data-two-step-reset-close
          />
        } @else {
          <p-button
            [label]="'common.cancel' | translate"
            severity="secondary"
            [text]="true"
            type="button"
            [disabled]="busy()"
            (onClick)="close()"
            data-two-step-reset-cancel
          />
          <p-button
            type="button"
            severity="danger"
            [label]="'userRecord.twoStep.reset' | translate"
            [loading]="busy()"
            (onClick)="reset()"
            data-two-step-reset-confirm
          />
        }
      </div>
    </ng-template>
    <app-edit-dialog
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      [header]="title()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [saving]="busy()"
      role="alertdialog"
      size="confirm"
    />
  `,
  styles: [
    `
      .am-two-step-reset-text {
        margin: 0;
        font-size: var(--am-type-body-size);
        line-height: var(--am-type-body-line);
        color: var(--am-ink-700);
      }
    `,
  ],
})
export class TwoStepResetDialogComponent {
  private readonly userService = inject(UserService);
  private readonly translate = inject(TranslateService);
  private readonly injector = inject(Injector);

  readonly visible = input.required<boolean>();
  readonly visibleChange = output<boolean>();
  readonly userId = input.required<string>();
  readonly userName = input.required<string>();
  /** Two-step sign-in was reset. */
  readonly done = output<void>();
  /** Closed after a refusal that may mean the record changed: read it again. */
  readonly stale = output<void>();

  readonly busy = signal(false);
  readonly refusal = signal<ResetRefusal | null>(null);

  readonly title = computed(() => {
    this.translate.currentLang();
    return this.translate.instant('userRecord.twoStep.resetTitle', { name: `${FSI}${this.userName()}${PDI}` });
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.refusal.set(null);
        this.busy.set(false);
        // Cancel first, as every destructive confirm without fields (Q2).
        afterNextRender(
          { write: () => document.querySelector<HTMLElement>('[data-two-step-reset-cancel] button')?.focus() },
          { injector: this.injector },
        );
      });
    });
  }

  onVisibleChange(visible: boolean): void {
    if (!visible && this.busy()) return;
    if (!visible && this.refusal()?.closeOnly) this.stale.emit();
    this.visibleChange.emit(visible);
  }

  close(): void {
    this.onVisibleChange(false);
  }

  reset(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.refusal.set(null);
    this.userService.resetMfa(this.userId()).subscribe({
      next: () => {
        this.busy.set(false);
        this.done.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.refusal.set(describeResetRefusal(err));
        afterNextRender(
          {
            write: () =>
              document
                .querySelector<HTMLElement>('[data-two-step-reset-close] button, [data-two-step-reset-confirm] button')
                ?.focus(),
          },
          { injector: this.injector },
        );
      },
    });
  }
}
