import { Component, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { InputMaskModule } from 'primeng/inputmask';

/**
 * ACC-316 PR 6 — a meeting's start, as Schedule and Reschedule take it: New
 * task's date-and-time control (task-form.component.ts, `.am-due__*`). The day
 * reads as words in a field with its calendar toggle (the calendar swaps the
 * dialog body, so this control only asks for it), and the time is typed HH:mm.
 * The time box is sized on PrimeNG's INNER input: sizing only the host left a
 * 305px input that ran the dialog body sideways (measured, ACC-111 and again
 * here). The owning dialog holds the day and the time's control.
 */
@Component({
  selector: 'am-meeting-when-field',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, InputTextModule, InputMaskModule],
  template: `
    <div class="am-mw__row">
      <div class="am-mw__field" [class.am-mw__field--invalid]="invalid()">
        <input pInputText readonly class="am-mw__date" [id]="dayId()" [value]="dayText()" [placeholder]="'meeting.when.dayPlaceholder' | translate" [attr.aria-label]="'meeting.when.day' | translate" [attr.data-testid]="testIdPrefix() + '-day'" />
        <button type="button" class="am-mw__calendar-button" [attr.aria-label]="'meeting.when.pickDay' | translate" [attr.title]="'meeting.when.pickDay' | translate" (click)="calendarRequested.emit()">
          <i class="pi pi-calendar" aria-hidden="true"></i>
        </button>
      </div>
      <p-inputmask [inputId]="timeId()" dir="ltr" mask="99:99" [placeholder]="'meeting.when.timePlaceholder' | translate" [formControl]="time()" [attr.data-testid]="testIdPrefix() + '-time'" />
    </div>
  `,
  styles: [
    `
      .am-mw__row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      /* The wrapper carries the border; the input inside is borderless, so the
         pair reads and focuses as ONE control (New task's .am-due__field). */
      .am-mw__field {
        display: flex;
        align-items: center;
        flex: 1 1 auto;
        min-inline-size: 0;
        block-size: 36px;
        padding-inline-end: 2px;
        border: 1px solid var(--am-control-border);
        border-radius: 4px;
        background: var(--am-control-bg);
      }

      .am-mw__field:hover {
        border-color: var(--am-control-border-hover);
      }

      .am-mw__field--invalid {
        border-color: var(--am-danger-ink);
      }

      .am-mw__field:focus-within {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }

      .am-mw__date {
        flex: 1 1 auto;
        min-inline-size: 0;
        border: none;
        background: none;
        box-shadow: none;
      }

      .am-mw__date:focus,
      .am-mw__date:focus-visible {
        outline: none;
        box-shadow: none;
      }

      /* 28x28, above the 24px WCAG 2.5.8 floor. */
      .am-mw__calendar-button {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        inline-size: 28px;
        block-size: 28px;
        padding: 0;
        border: none;
        background: none;
        border-radius: 4px;
        color: var(--am-primary-600);
        cursor: pointer;
      }

      .am-mw__calendar-button:hover {
        background: var(--am-primary-50);
      }

      .am-mw__calendar-button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: 1px;
      }

      /* 112px: the Arabic hint is not clipped at that width (New task's reason). */
      .am-mw__row .p-inputmask {
        flex: none;
        inline-size: 112px;
      }

      .am-mw__row ::ng-deep .p-inputmask input {
        inline-size: 112px;
        min-inline-size: 0;
      }
    `,
  ],
})
export class MeetingWhenFieldComponent {
  /** The day as the reader reads it, or '' while none is picked. */
  readonly dayText = input('');
  readonly time = input.required<FormControl<string | null>>();
  readonly invalid = input(false);
  readonly dayId = input('meetingDay');
  readonly timeId = input('meetingTime');
  readonly testIdPrefix = input('meeting-when');
  readonly calendarRequested = output<void>();
}
