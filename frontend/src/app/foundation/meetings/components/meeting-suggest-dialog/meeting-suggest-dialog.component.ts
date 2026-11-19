import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { meetingNeedsReload, meetingRefusalKey } from '../../meeting-refusal';
import { MeetingService, type MeetingMinutesItemDto } from '../../services/meeting.service';

function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/** The "About" value for the minutes as a whole. */
const WHOLE = 'whole';

/**
 * ACC-316 PR 7c-1 — Suggest a correction (Meeting Screens, dialogs): a present
 * member's correction, about one agenda item or the minutes as a whole, which
 * whoever records the minutes applies or declines. The minutes stay in review.
 * Opened from the banner only (plan 7c draws no per-item Suggest), so it always
 * starts on the minutes as a whole. A refusal is said from its code; a stale one
 * (P220) offers Reload, which closes and lets the page read the meeting again.
 */
@Component({
  selector: 'app-meeting-suggest-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent, OverlaySelectComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col gap-3">
        <am-field [label]="'meeting.suggest.about' | translate" [control]="form.controls.about" [hint]="'meeting.suggest.aboutHint' | translate" message="none">
          <app-overlay-select [options]="aboutOptions()" optionLabel="label" optionValue="value" formControlName="about" [ariaLabel]="'meeting.suggest.about' | translate" data-testid="suggest-about" />
        </am-field>
        <am-field [label]="'meeting.suggest.text' | translate" [control]="form.controls.text" [forceShowErrors]="showErrors()" [errorMessages]="{ required: 'meeting.suggest.textRequired' }">
          <textarea #textInput pTextarea id="suggestText" formControlName="text" rows="3" maxlength="4000" data-testid="suggest-text"></textarea>
        </am-field>
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex items-center justify-end gap-3">
        @if (error()) {
          <p class="m-0 me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="suggest-error">{{ error()! | translate }}</p>
        }
        <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
        @if (needsReload()) {
          <p-button type="button" data-testid="suggest-reload" [label]="'meeting.agenda.reload' | translate" (onClick)="reloadMeeting()" />
        } @else {
          <p-button type="button" data-testid="suggest-submit" [label]="'meeting.suggest.submit' | translate" [loading]="saving()" (onClick)="submit()" />
        }
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'meeting.suggest.title' | translate"
      [context]="'meeting.suggest.context' | translate"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
})
export class MeetingSuggestDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  readonly meetingId = input.required<string>();
  readonly items = input<MeetingMinutesItemDto[]>([]);
  readonly visibleChange = output<boolean>();
  /** Sent: the page reads the minutes again. */
  readonly sent = output<void>();
  /** A stale refusal's Reload: the page reads the meeting again. */
  readonly reload = output<void>();

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly needsReload = signal(false);
  readonly showErrors = signal(false);
  private readonly textInput = viewChild<ElementRef<HTMLTextAreaElement>>('textInput');

  readonly form = this.fb.group({
    about: [WHOLE],
    text: ['', [notBlank, Validators.maxLength(4000)]],
  });

  readonly aboutOptions = computed(() => {
    this.language.isArabic();
    return [
      { label: this.translate.instant('meeting.suggest.whole') as string, value: WHOLE },
      ...this.items().map((i) => ({ label: `${this.format.number(i.order)} · ${i.title}`, value: i.id })),
    ];
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.form.reset({ about: WHOLE, text: '' });
        this.error.set(null);
        this.needsReload.set(false);
        this.showErrors.set(false);
      });
    });
  }

  submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.textInput()?.nativeElement.focus();
      return;
    }
    const v = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.meetings.suggest(this.meetingId(), { agendaItemId: v.about === WHOLE ? null : v.about, text: v.text!.trim() }).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.sent.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(meetingRefusalKey(err) ?? 'meeting.suggest.error');
        this.needsReload.set(meetingNeedsReload(err));
      },
    });
  }

  /** Close, and let the page read the meeting again. */
  reloadMeeting(): void {
    this.form.markAsPristine();
    this.visibleChange.emit(false);
    this.reload.emit();
  }
}
