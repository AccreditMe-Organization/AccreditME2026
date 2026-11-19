import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { FormatService } from '../../../../core/formatting';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { meetingRefusalKey } from '../../meeting-refusal';
import { MeetingService, type MeetingSuggestionDto } from '../../services/meeting.service';

function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/**
 * ACC-316 PR 7c-1 — Decline this suggestion? (Meeting Screens, dialogs): the
 * suggestion quoted, and a REQUIRED reply its author reads with the item. The
 * server refuses an empty one too (MEETING_SUGGESTION_REPLY_REQUIRED, P212).
 */
@Component({
  selector: 'app-meeting-decline-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
        <p class="m-0 whitespace-pre-line text-[13px]" dir="auto" data-testid="decline-quote">“{{ suggestion()?.text }}”</p>
        <am-field
          [label]="'meeting.decline.reply' | translate"
          [control]="form.controls.reply"
          [hint]="'meeting.decline.replyHint' | translate: { name: suggestion()?.author?.name ?? '' }"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ required: 'meeting.decline.replyRequired' }"
        >
          <textarea #replyInput pTextarea id="declineReply" formControlName="reply" rows="3" maxlength="2000" data-testid="decline-reply"></textarea>
        </am-field>
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex items-center justify-end gap-3">
        @if (error()) {
          <p class="m-0 me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="decline-error">{{ error()! | translate }}</p>
        }
        <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
        <p-button type="button" data-testid="decline-submit" [label]="'meeting.review.decline' | translate" [loading]="saving()" (onClick)="submit()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.decline.title' | translate"
      [context]="context()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="confirm"
    />
  `,
})
export class MeetingDeclineDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  readonly meetingId = input.required<string>();
  readonly suggestion = input<MeetingSuggestionDto | null>(null);
  /** The place of the item the suggestion is about, or null for the minutes as a whole. */
  readonly itemOrder = input<number | null>(null);
  readonly visibleChange = output<boolean>();
  /** Declined: the page reads the minutes again. */
  readonly declined = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  private readonly replyInput = viewChild<ElementRef<HTMLTextAreaElement>>('replyInput');

  readonly form = this.fb.group({ reply: ['', [notBlank, Validators.maxLength(2000)]] });

  readonly context = computed(() => {
    const s = this.suggestion();
    if (!s) return '';
    const n = this.itemOrder();
    return n
      ? (this.translate.instant('meeting.decline.contextItem', { n: this.format.number(n), name: s.author.name }) as string)
      : (this.translate.instant('meeting.decline.contextWhole', { name: s.author.name }) as string);
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.form.reset({ reply: '' });
        this.error.set(null);
        this.showErrors.set(false);
      });
    });
  }

  submit(): void {
    const s = this.suggestion();
    if (!s || this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.replyInput()?.nativeElement.focus();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    this.meetings.declineSuggestion(this.meetingId(), s.id, this.form.getRawValue().reply!.trim()).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.declined.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(meetingRefusalKey(err) ?? 'meeting.decline.error');
      },
    });
  }
}
