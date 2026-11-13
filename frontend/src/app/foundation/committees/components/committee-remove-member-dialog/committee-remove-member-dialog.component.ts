import { Component, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { CommitteeStageRefusal, committeeStageRefusal } from '../../committee-stage-refusal';
import { CommitteeService } from '../../services/committee.service';

/** The longest reason the server accepts (RemoveCommitteeMemberDto). */
export const REMOVE_REASON_MAX = 2000;

// Whitespace is not a reason — reported as `required`, as the server refuses it.
function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/** Who is being removed: the membership's id, and the person's one name. */
export interface RemoveMemberTarget {
  memberId: string;
  name: string;
}

/**
 * Remove a committee member, with a reason — ACC-298 (Ahmad, 11 Nov: "removal
 * from committee requires a reason"). Replaces ACC-240's plain confirm.
 *
 * Built the way Cancel task is (ACC-174): one required field in the form
 * dialog shell, a hint saying where the reason goes, and a destructive button
 * that is never disabled. An empty reason reveals the field's error and moves
 * focus to it. The title still names the person, and the consequence line is
 * the confirm's: the membership ends today (no date is sent) and its LEFT event
 * keeps it, with this reason, in the committee's history. ACC-297's notice to
 * the committee's officers shows the same reason.
 *
 * A refusal is said here, where the reader pressed Remove, and the reason they
 * typed stays: a stage refusal from its code, in the reader's language
 * (committeeStageRefusal, ACC-255), anything else through extractErrorMessage.
 */
@Component({
  selector: 'app-committee-remove-member-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
        <p class="text-body m-0" data-testid="remove-member-consequence">
          {{ 'committee.confirmRemoveMemberMessage' | translate }}
        </p>
        <am-field
          [label]="'committee.removeMemberReason' | translate"
          [control]="form.controls.reason"
          [hint]="'committee.removeMemberReasonHint' | translate"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ required: 'committee.removeMemberReasonRequired' }"
        >
          <textarea
            #reasonInput
            pTextarea
            id="committeeRemoveMemberReason"
            formControlName="reason"
            rows="3"
          ></textarea>
        </am-field>
        @if (stageRefusal(); as r) {
          <p class="text-meta text-[var(--am-danger-ink)] m-0" role="alert" data-testid="committee-stage-refusal">
            {{ r.key | translate: { stage: stageName(r) } }}
          </p>
        } @else if (error()) {
          <p class="text-meta text-[var(--am-danger-ink)] m-0" role="alert" data-testid="remove-member-error">{{ error()! | translate }}</p>
        }
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="saving()"
          (onClick)="dialog.requestClose()"
        />
        <p-button
          type="button"
          severity="danger"
          data-testid="remove-member-submit"
          [label]="'common.remove' | translate"
          [loading]="saving()"
          (onClick)="submit()"
        />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'committee.confirmRemoveMember' | translate: { name: target()?.name ?? '' }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
})
export class CommitteeRemoveMemberDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly committeeService = inject(CommitteeService);
  private readonly languageService = inject(LanguageService);

  readonly visible = input.required<boolean>();
  readonly committeeId = input.required<string>();
  readonly target = input<RemoveMemberTarget | null>(null);
  readonly visibleChange = output<boolean>();
  /** Emitted once the member has been removed; the page reloads what it shows. */
  readonly removed = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly stageRefusal = signal<CommitteeStageRefusal | null>(null);
  readonly showErrors = signal(false);

  // The textarea sits in a template the shell renders inside <body>, outside this
  // component's element, so focus goes through this query, not a host lookup.
  private readonly reasonInput = viewChild<ElementRef<HTMLTextAreaElement>>('reasonInput');

  readonly form = this.fb.group({
    reason: ['', [notBlank, Validators.maxLength(REMOVE_REASON_MAX)]],
  });

  constructor() {
    // Every opening starts clean: a reason typed for one person must never be
    // sent for the next.
    effect(() => {
      if (this.visible()) {
        this.form.reset({ reason: '' });
        this.error.set(null);
        this.stageRefusal.set(null);
        this.showErrors.set(false);
      }
    });
  }

  stageName(refusal: CommitteeStageRefusal): string {
    return this.languageService.bilingual(refusal.stageNameEn ?? refusal.stageNameAr ?? '', refusal.stageNameAr);
  }

  submit(): void {
    const target = this.target();
    if (!target || this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.reasonInput()?.nativeElement.focus();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.stageRefusal.set(null);
    const reason = this.form.getRawValue().reason!.trim();
    this.committeeService.removeMember(this.committeeId(), target.memberId, { reason }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.removed.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        // ACC-255 — refused by the committee's stage: said, with its name.
        this.stageRefusal.set(committeeStageRefusal(err));
        if (!this.stageRefusal()) this.error.set(extractErrorMessage(err, 'committee.errorAction'));
      },
    });
  }
}
