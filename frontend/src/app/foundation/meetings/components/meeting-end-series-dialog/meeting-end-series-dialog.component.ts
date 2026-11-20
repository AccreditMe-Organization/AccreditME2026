import { Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { Subscription } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { meetingFailure, meetingRefusalKey, type MeetingFailure } from '../../meeting-refusal';
import { ownerName } from '../../meeting-display';
import { MeetingService, type MeetingDto, type MeetingEndSeriesPreviewDto } from '../../services/meeting.service';

/** The longest reason End series takes (EndMeetingSeriesDto). */
export const END_SERIES_REASON_MAX = 500;

function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim() ? null : { required: true };
}

/**
 * ACC-316 PR 8d — "End the monthly series?" (Meeting Screens, End the series,
 * 94 / 104). Opened from a series meeting's page, so the meeting on screen is
 * the series' LAST meeting (Q4): it and those before it stay, every later one
 * still in Planned or Agenda Issued is cancelled, each by its own Cancel
 * Meeting, and everyone invited is told.
 *
 *   Last meeting  this meeting's date, as the server's plan names it
 *   Cancelled     "7 meetings, 26 Nov 2026 → 27 May 2027", from the server's
 *                 preview (the write's own plan, read-only), never worked out
 *                 here: which meetings are still open is their stages' rule
 *   Reason        required: the built endpoint sends it with each cancellation
 *                 (the drawing has no reason field; End needs one)
 *
 * End is never pressed blind, as the scope confirm (P254): pressed while the
 * preview loads it waits; a lost preview is asked again and then ends; a
 * refused one does nothing, its refusal shown. End is never disabled: an
 * empty reason shows its error and moves focus to it. Some meetings left
 * uncancelled keep the dialog open and say how many; the page reads the
 * meeting again when it closes (ACC-55's contract).
 */
@Component({
  selector: 'app-meeting-end-series-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="end()" class="flex flex-col gap-3" data-testid="end-series-body">
        <p class="m-0 text-[13px]">{{ 'meeting.endSeries.lead' | translate }}</p>
        <dl class="am-end-series-pairs m-0 grid gap-x-3 gap-y-1 text-meta" data-testid="end-series-pairs">
          <dt class="text-[var(--am-ink-500)]">{{ 'meeting.endSeries.last' | translate }}</dt>
          <dd class="m-0" data-testid="end-series-last">{{ lastLine() }}</dd>
          <dt class="text-[var(--am-ink-500)]">{{ 'meeting.endSeries.cancelled' | translate }}</dt>
          <dd class="m-0" data-testid="end-series-cancelled">{{ cancelledLine() }}</dd>
        </dl>
        @if (previewState() === 'error') {
          <p class="m-0 flex flex-wrap items-center gap-2 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="end-series-preview-error">
            {{ previewError()! | translate }}
            @if (!previewRefused()) {
              <p-button size="small" [text]="true" [label]="'common.retry' | translate" data-testid="end-series-preview-retry" (onClick)="loadPreview()" />
            }
          </p>
        }
        <am-field
          [label]="'meeting.endSeries.reason' | translate"
          [control]="form.controls.reason"
          [hint]="'meeting.endSeries.reasonHint' | translate"
          [forceShowErrors]="showErrors()"
          [errorMessages]="{ required: 'meeting.endSeries.reasonRequired' }"
        >
          <textarea #reasonInput pTextarea id="endSeriesReason" formControlName="reason" rows="3" [attr.maxlength]="reasonMax" data-testid="end-series-reason"></textarea>
        </am-field>
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex flex-wrap items-center justify-end gap-3">
        @if (failureKey()) {
          <p class="m-0 me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="end-series-error">{{ failureKey()! | translate }}</p>
        }
        @if (failedLine()) {
          <p class="m-0 me-auto min-w-0 text-meta text-[var(--am-danger-ink)]" role="alert" data-testid="end-series-partial">{{ failedLine() }}</p>
        }
        <p-button [label]="'meeting.endSeries.keep' | translate" severity="secondary" [text]="true" type="button" [disabled]="saving()" (onClick)="dialog.requestClose()" />
        <p-button type="button" severity="danger" data-testid="end-series-submit" [label]="'meeting.endSeries.confirm' | translate" [loading]="saving() || waiting()" (onClick)="end()" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="onVisible($event)"
      [header]="title()"
      [context]="context()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="confirm"
    />
  `,
  styles: [
    `
      .am-end-series-pairs {
        grid-template-columns: max-content 1fr;
      }
    `,
  ],
})
export class MeetingEndSeriesDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly meetings = inject(MeetingService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  /** A series meeting: the last one the series keeps. */
  readonly meeting = input<MeetingDto | null>(null);
  readonly visibleChange = output<boolean>();
  /** The series ended (or some of it did): the page reads the meeting again. */
  readonly ended = output<void>();

  readonly reasonMax = END_SERIES_REASON_MAX;
  readonly form = this.fb.group({ reason: ['', [notBlank, Validators.maxLength(END_SERIES_REASON_MAX)]] });
  readonly showErrors = signal(false);
  private readonly reasonInput = viewChild<ElementRef<HTMLTextAreaElement>>('reasonInput');

  readonly preview = signal<MeetingEndSeriesPreviewDto | null>(null);
  readonly previewState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly previewError = signal<string | null>(null);
  /** The preview was refused (a code), not lost: Retry would ask the same. */
  readonly previewRefused = signal(false);
  /** End was pressed before the plan was on screen: it ends when it is. */
  readonly waiting = signal(false);
  readonly saving = signal(false);
  readonly failure = signal<MeetingFailure | null>(null);
  readonly failureKey = computed(() => this.failure()?.key ?? null);
  /** How many meetings End couldn't cancel, after it ran. */
  readonly failedCount = signal(0);
  /** Something was written: the page reads the meeting again when the dialog closes. */
  private refreshPending = false;
  private reads = new Subscription();

  /** "End the monthly series?", by how often it repeats. */
  readonly title = computed(() => {
    this.translate.currentLang();
    const s = this.meeting()?.series;
    return s ? (this.translate.instant(`meeting.endSeries.title.${s.every}`) as string) : '';
  });

  /** "Infection Prevention & Control · 4 of 12 held". */
  readonly context = computed(() => {
    this.translate.currentLang();
    const m = this.meeting();
    if (!m) return '';
    const p = this.preview();
    const owner = ownerName(m.owner, this.language);
    return p ? `${owner} · ${this.translate.instant('meeting.endSeries.held', { held: this.format.number(p.held), total: this.format.number(p.total) })}` : owner;
  });

  readonly lastLine = computed(() => {
    this.translate.currentLang();
    const p = this.preview();
    if (this.previewState() !== 'ready' || !p) return this.translate.instant(this.previewState() === 'error' ? 'meeting.scope.laterUnknown' : 'meeting.scope.working') as string;
    return p.last ? this.format.date(p.last.startsAt) : (this.translate.instant('meeting.endSeries.none') as string);
  });

  /** "7 meetings, 26 Nov 2026 → 27 May 2027", from the server's plan. */
  readonly cancelledLine = computed(() => {
    this.translate.currentLang();
    const p = this.preview();
    if (this.previewState() !== 'ready' || !p) return this.translate.instant(this.previewState() === 'error' ? 'meeting.scope.laterUnknown' : 'meeting.scope.working') as string;
    const list = p.cancelled;
    if (list.length === 0) return this.translate.instant('meeting.endSeries.none') as string;
    const first = this.format.date(list[0]!.startsAt);
    const last = this.format.date(list[list.length - 1]!.startsAt);
    return this.format.count('meeting.scopeMeetings', list.length, { range: first === last ? first : `${first} → ${last}` });
  });

  readonly failedLine = computed(() => {
    this.translate.currentLang();
    const n = this.failedCount();
    return n > 0 ? this.format.count('meeting.endSeriesFailed', n) : '';
  });

  constructor() {
    // Every OPENING starts clean and asks afresh.
    effect(() => {
      if (!this.visible()) {
        untracked(() => this.reads.unsubscribe());
        return;
      }
      untracked(() => {
        this.form.reset({ reason: '' });
        this.showErrors.set(false);
        this.waiting.set(false);
        this.failure.set(null);
        this.failedCount.set(0);
        this.refreshPending = false;
        this.reads.unsubscribe();
        this.reads = new Subscription();
        this.loadPreview();
      });
    });
  }

  loadPreview(): void {
    const m = this.meeting();
    if (!m?.series) return;
    this.previewState.set('loading');
    this.previewError.set(null);
    this.previewRefused.set(false);
    this.preview.set(null);
    this.reads.add(
      this.meetings.endSeriesPreview(m.series.id, { lastMeetingId: m.id }).subscribe({
        next: (p) => {
          this.preview.set(p);
          this.previewState.set('ready');
          if (this.waiting()) {
            this.waiting.set(false);
            this.send();
          }
        },
        error: (err: unknown) => {
          const key = meetingRefusalKey(err);
          this.previewRefused.set(!!key);
          this.previewError.set(key ?? 'meeting.endSeries.previewError');
          this.previewState.set('error');
          this.waiting.set(false);
        },
      }),
    );
  }

  end(): void {
    if (this.saving() || this.waiting()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.reasonInput()?.nativeElement.focus();
      return;
    }
    // Never blind: it ends once what it cancels is on screen.
    if (this.previewState() === 'loading') {
      this.waiting.set(true);
      return;
    }
    if (this.previewState() === 'error') {
      // A refused preview: nothing, the refusal stays shown. A lost one is asked again, and ends when it arrives.
      if (this.previewRefused()) return;
      this.waiting.set(true);
      this.loadPreview();
      return;
    }
    this.send();
  }

  private send(): void {
    const m = this.meeting();
    if (!m?.series) return;
    this.saving.set(true);
    this.failure.set(null);
    this.failedCount.set(0);
    this.meetings.endSeries(m.series.id, { reason: this.form.getRawValue().reason!.trim(), lastMeetingId: m.id }).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.refreshPending = true;
        if (r.failed.length > 0) {
          // Kept open, saying how many are left; End again finishes them.
          this.failedCount.set(r.failed.length);
          this.loadPreview();
          return;
        }
        this.form.markAsPristine();
        this.visibleChange.emit(false);
        this.flush();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.failure.set(meetingFailure(err, 'meeting.endSeries.error', 'meeting.endSeries.error'));
      },
    });
  }

  onVisible(visible: boolean): void {
    this.visibleChange.emit(visible);
    if (!visible) this.flush();
  }

  private flush(): void {
    if (!this.refreshPending) return;
    this.refreshPending = false;
    this.ended.emit();
  }
}
