import { Component, ElementRef, effect, input, output, signal, viewChild, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';

/** The longest comment a press carries (TriggerTransitionDto). */
export const MOVE_REASON_MAX = 2000;

function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/**
 * ACC-316 PR 6 — the words a record gives one of its moves before it is
 * pressed: a confirm (Issue Agenda), or a reason the move needs (Cancel
 * Meeting). Translation KEYS, so the record's own words reach the generic
 * move buttons without the buttons knowing the record.
 */
export interface MoveConfirmCopy {
  titleKey: string;
  leadKey: string;
  /** The reason field's hint, when the move needs a reason. */
  hintKey?: string;
  confirmKey: string;
  keepKey: string;
  danger: boolean;
  /** ACC-316 PR 8d — the dialog's context line, already in the reader's words (a meeting's "IPC · 22 Oct 2026, 10:00 · Only this meeting"). */
  context?: string;
}

/**
 * The move buttons' confirm: the record's words, and, when the server says the
 * move needs one (`needsReason`), a required reason sent as the press's
 * comment. The confirm button is never disabled: an empty reason shows the
 * field's error and moves focus to it (the remove-member dialog's pattern).
 * Measured under the 420px body cap in both languages
 * (move-confirm-dialog.layout.spec.ts).
 */
@Component({
  selector: 'app-move-confirm-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="confirm()" class="flex flex-col gap-3">
        @if (copy(); as c) {
          <p class="text-body m-0" data-testid="move-confirm-lead">{{ c.leadKey | translate }}</p>
          @if (needsReason()) {
            <am-field
              [label]="'workflow.moveReason.label' | translate"
              [control]="form.controls.reason"
              [hint]="(c.hintKey ?? 'workflow.moveReason.hint') | translate"
              [forceShowErrors]="showErrors()"
              [errorMessages]="{ required: 'workflow.moveReason.required' }"
            >
              <textarea #reasonInput pTextarea id="moveConfirmReason" formControlName="reason" rows="3"></textarea>
            </am-field>
          }
        }
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button [label]="(copy()?.keepKey ?? 'common.cancel') | translate" severity="secondary" [text]="true" type="button" [disabled]="busy()" (onClick)="dialog.requestClose()" />
        <p-button
          type="button"
          data-testid="move-confirm-submit"
          [severity]="copy()?.danger ? 'danger' : 'primary'"
          [label]="(copy()?.confirmKey ?? 'common.confirm') | translate"
          [loading]="busy()"
          (onClick)="confirm()"
        />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="(copy()?.titleKey ?? '') | translate"
      [context]="copy()?.context ?? ''"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="busy()"
      [size]="needsReason() ? 'form' : 'confirm'"
    />
  `,
})
export class MoveConfirmDialogComponent {
  private readonly fb = inject(FormBuilder);

  readonly visible = input.required<boolean>();
  readonly copy = input<MoveConfirmCopy | null>(null);
  readonly needsReason = input(false);
  readonly busy = input(false);
  readonly visibleChange = output<boolean>();
  /** The reason (null when the move needs none). */
  readonly confirmed = output<string | null>();

  readonly showErrors = signal(false);
  private readonly reasonInput = viewChild<ElementRef<HTMLTextAreaElement>>('reasonInput');
  readonly form = this.fb.group({ reason: ['', [notBlank, Validators.maxLength(MOVE_REASON_MAX)]] });

  constructor() {
    // Every opening starts clean: a reason typed for one press is never sent with the next.
    effect(() => {
      if (this.visible()) {
        this.form.reset({ reason: '' });
        this.showErrors.set(false);
      }
    });
  }

  confirm(): void {
    if (this.busy()) return;
    if (this.needsReason() && this.form.invalid) {
      this.showErrors.set(true);
      this.reasonInput()?.nativeElement.focus();
      return;
    }
    this.confirmed.emit(this.needsReason() ? this.form.getRawValue().reason!.trim() : null);
  }
}
