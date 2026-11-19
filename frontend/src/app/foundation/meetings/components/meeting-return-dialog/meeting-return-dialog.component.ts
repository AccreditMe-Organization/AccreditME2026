import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { FormatService } from '../../../../core/formatting';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingService, type MeetingMinutesDto } from '../../services/meeting.service';

/**
 * ACC-316 PR 7c-1 — Return for Correction? (Meeting Screens, dialogs; a confirm
 * at 420): the minutes go back to Minutes Draft, and distributing again starts
 * a new review. Who is told (the present members, as the server tells them) and
 * the answers so far, then an optional reason, shown to the present members and
 * in the draft. Offered on `may.returnForCorrection` only.
 */
@Component({
  selector: 'app-meeting-return-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
        <p class="m-0 text-[13px]">{{ 'meeting.return.lead' | translate }}</p>
        <dl class="m-0 grid gap-x-3 gap-y-1 text-meta" style="grid-template-columns: max-content 1fr" data-testid="return-pairs">
          <dt class="text-[var(--am-ink-500)]">{{ 'meeting.return.told' | translate }}</dt>
          <dd class="m-0">{{ told() }}</dd>
          <dt class="text-[var(--am-ink-500)]">{{ 'meeting.return.answers' | translate }}</dt>
          <dd class="m-0">{{ answers() }}</dd>
        </dl>
        <am-field [label]="'meeting.return.reason' | translate" [control]="form.controls.reason" [hint]="'meeting.return.reasonHint' | translate" message="none">
          <textarea pTextarea id="returnReason" formControlName="reason" rows="3" maxlength="2000" data-testid="return-reason"></textarea>
        </am-field>
        @if (error()) {
          <p class="m-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="return-error">{{ error()! | translate }}</p>
        }
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button [label]="'meeting.distribute.notYet' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
        <p-button type="button" data-testid="return-submit" [label]="'meeting.return.submit' | translate" [loading]="saving()" (onClick)="submit()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.return.title' | translate"
      [context]="context()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="confirm"
    />
  `,
})
export class MeetingReturnDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  readonly meetingId = input.required<string>();
  readonly context = input('');
  readonly minutes = input<MeetingMinutesDto | null>(null);
  readonly visibleChange = output<boolean>();
  /** Returned: the page reads the meeting again (its stage moved). */
  readonly returned = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({ reason: ['', Validators.maxLength(2000)] });

  /** The present members, whom the server tells. */
  readonly told = computed(() => {
    const present = (this.minutes()?.attendance ?? []).filter((r) => r.kind === 'MEMBER' && r.attendance === 'PRESENT').length;
    return this.format.count('meeting.presentMembers', present);
  });

  readonly answers = computed(() => {
    const r = this.minutes()?.review;
    if (!r) return '';
    const answered = r.reviewers.filter((x) => x.answered).length;
    const open = r.suggestions.filter((s) => s.round === r.round && s.status === 'OPEN').length;
    return `${this.format.count('meeting.reviewAnswered', answered)} · ${this.format.count('meeting.suggestionsOpen', open)}`;
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.form.reset({ reason: '' });
        this.error.set(null);
      });
    });
  }

  submit(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.meetings.returnMinutes(this.meetingId(), this.form.getRawValue().reason?.trim() || null).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.returned.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(meetingRefusalKey(err) ?? 'meeting.return.error');
      },
    });
  }
}
