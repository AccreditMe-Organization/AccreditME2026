// am-inline-calendar — the one calendar in the product (ACC-96, artboard 12).
//
// ## Why this exists rather than a p-datepicker per screen
//
// Artboard 12 fixes the geometry so a template can budget against it: 28x28
// day cells, six week rows ALWAYS rendered, 258px.
//
// NO TIME STRIP. Rev 7 deleted it: the date-and-time drawing showed the time
// TWICE, once here and once beside the date field, and the field is the one
// that survives — it is a sibling of the date field in BOTH states, so
// pressing the calendar toggle never moves it. That returns this component's
// figure to 258px and the task form's date view to 358 of its 420 cap. Six rows always, never five, because a calendar that changes
// height between months moves the dialog footer under the cursor — the same
// failure the in-flow rule exists to prevent. None of that survives being
// re-derived screen by screen, so it lives here once.
//
// 28, not the WCAG 2.5.8 floor of 24: a 24px cell with a 2px gap leaves a
// target with no margin for a trackpad slip, on a screen used all day.
//
// ## It IS a p-datepicker, and that was checked rather than assumed
//
// `[inline]` builds no overlay at all, so there is no
// ConnectedOverlayScrollHandler to close it on an ancestor scroll and nothing
// for a dialog to clip. Everything artboard 12 asks for is reachable from
// PrimeNG except three things, verified against primeng-datepicker.mjs:
//
//   - RTL arrow direction. `case 37` is hard-wired to previousElementSibling,
//     so in Arabic the left arrow walks backwards against the eye.
//   - Shift+PageUp/PageDown by year. `case 33`/`34` never read shiftKey.
//   - aria-hidden and a full per-day announcement. PrimeNG puts the bare day
//     NUMBER in aria-label, on the <td>, which no template can reach.
//   - A tab stop on the grid AT ALL. initFocusableCell() runs from the
//     overlay's show path, and inline there is no overlay — so every one of
//     the 42 cells stays tabIndex -1 and Tab skips the calendar entirely.
//
// All three are handled here — the first two by intercepting keydown ahead of
// PrimeNG, the third by a directive. No new library, and nothing patched.
//
// What IS stock, and is why the interception stays small: other-month days are
// already non-selectable (`selectOtherMonths` defaults false, so
// `isSelectable()` returns false and the day span gets `p-disabled`), and the
// arrow handler skips `p-disabled` cells by calling navForward/navBackward —
// which is exactly artboard 12's "arrowing past the end of the month advances
// the month and lands on a real day".
//
// ## Six rows: the one point NOT built as drawn
//
// Artboard 12 asks for six week rows always. PrimeNG builds as many as the
// month needs — September 2026 is five — and exposes no input to pad to six.
// Injecting a filler <tr> into a library's own table, on every month change,
// is the kind of thing that breaks on upgrade.
//
// So the INVARIANT is held rather than the markup: the grid is pinned to the
// height six rows would occupy, which is the drawing's own reason for asking
// — "a calendar that changes height between months would move the dialog
// footer under the cursor". A five-row month shows a blank final row instead
// of dim other-month numbers. A deviation, recorded rather than discovered.
//
// ## Non-working days are MARKED, never disabled
//
// `disabledDays` would have been the obvious input and is wrong: artboard 12
// settles out-of-hours as "allowed, warned, never blocked". A hospital does not
// stop at 17:00, and a product that refuses to record a true due date makes
// people round to 17:00 and corrupt the SLA data. So the hatch is a marker and
// the day stays clickable.

import {
  AfterViewChecked,
  Component,
  Directive,
  ElementRef,
  ViewEncapsulation,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { DatePicker, DatePickerModule } from 'primeng/datepicker';
import { LanguageService } from '../../../core/services/language.service';
import { FormatService } from '../../../core/formatting';

/** 'YYYY-MM-DD' → the holiday's name in the reader's language. */
export type HolidayMap = ReadonlyMap<string, string>;

/** A local calendar day as 'YYYY-MM-DD'. Never an instant — that is Part B. */
export function dayKey(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * PrimeNG's OWN key, which is what lands in each cell's `data-date`.
 *
 * Deliberately a second function rather than reusing dayKey(): PrimeNG writes
 * `${y}-${getMonth()}-${d}` — zero-based month, no padding — so 22 Sep 2026 is
 * "2026-8-22", not "2026-09-22". Read from primeng-datepicker.mjs:1410, not
 * assumed. Anything that queries the DOM or parses data-date must use this one;
 * anything public uses dayKey().
 */
function primeKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function parsePrimeKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(key);
  return m ? new Date(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

// ─── The a11y directive ──────────────────────────────────────────────────────

/**
 * Rewrites what a screen reader gets for each day cell, because PrimeNG's own
 * markup cannot be reached any other way: `[attr.aria-label]="date.day"` sits
 * on the `<td>`, outside `dateTemplate`'s reach, and announces a bare number.
 *
 * Two jobs, both from artboard 12:
 *
 *  - Other-month days become `aria-hidden`. They are padding that keeps the
 *    grid rectangular. They are already unreachable by pointer (CSS) and by
 *    arrow key (PrimeNG skips `p-disabled`), so hiding them from the
 *    accessibility tree is what makes #A7B2C2 at 2.14:1 defensible here: it is
 *    not text a user can read, act on or reach.
 *  - Real days announce in full — "Tuesday 22 September 2026, working day" —
 *    because the working-day fact changes what the date MEANS for an SLA, and
 *    a bare number does not carry it.
 *
 * ngAfterViewChecked, NOT a MutationObserver. The observer was the first
 * instinct and it is worse: PrimeNG rebuilds the grid from inside an Angular
 * event handler, so a checked hook already sees every rebuild, synchronously
 * and in a spec without waiting. The observer version left the labels as
 * PrimeNG's bare numbers for a whole detectChanges cycle, which the spec below
 * caught.
 *
 * The cost is a walk of ~40 cells per change-detection pass while a calendar is
 * open. Every write is guarded by a comparison, so the pass is reads only once
 * the labels are correct.
 */
@Directive({ selector: '[amCalendarA11y]', standalone: true })
export class CalendarA11yDirective implements AfterViewChecked {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly describeDay = input.required<(key: string) => string>({ alias: 'amCalendarA11y' });

  ngAfterViewChecked(): void {
    this.apply();
  }

  /** Public so a spec can drive it directly. */
  apply(): void {
    this.seedRovingTabIndex();
    for (const cell of Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('td'))) {
      const span = cell.querySelector<HTMLElement>('span[data-date]');
      if (!span || cell.classList.contains('p-datepicker-other-month')) {
        if (cell.getAttribute('aria-hidden') !== 'true') cell.setAttribute('aria-hidden', 'true');
        cell.removeAttribute('aria-label');
        continue;
      }
      cell.removeAttribute('aria-hidden');
      const label = this.describeDay()(span.dataset['date'] ?? '');
      // Guarded: an unconditional write would rewrite on every pass.
      if (label && cell.getAttribute('aria-label') !== label) {
        cell.setAttribute('aria-label', label);
      }
    }
  }

  /**
   * THE GRID IS OTHERWISE UNREACHABLE BY KEYBOARD — a fourth thing PrimeNG
   * does not do for an [inline] picker, found in a browser and not predicted.
   *
   * `initFocusableCell()` sets tabIndex 0 on one cell, but it runs from the
   * OVERLAY's show path. Inline there is no overlay, so it never runs: every
   * one of the 42 spans stays at tabIndex -1 with no tabindex attribute, Tab
   * skips the whole calendar, and a keyboard user cannot reach a single day.
   *
   * Seeds the roving tab stop, once: the selected day, else today, else the
   * first selectable day — artboard 12's "one tab stop for the whole grid,
   * Tab leaves the calendar, it does not walk 42 cells".
   *
   * ONLY when nothing is tabbable. PrimeNG's own arrow handler moves the stop
   * as you navigate (-1 on the old cell, 0 on the new); re-seeding on every
   * change-detection pass would drag focus back to the selected day mid-arrow.
   */
  private seedRovingTabIndex(): void {
    const root = this.host.nativeElement;
    const days = Array.from(root.querySelectorAll<HTMLElement>('span[data-date]:not(.p-disabled)'));
    if (days.length === 0) return;

    if (days.some((d) => d.tabIndex === 0)) return;
    const target =
      days.find((d) => d.classList.contains('p-datepicker-day-selected')) ??
      days.find((d) => d.closest('td')?.classList.contains('p-datepicker-today')) ??
      days[0];
    target.tabIndex = 0;
  }
}

// ─── The calendar ────────────────────────────────────────────────────────────

@Component({
  selector: 'am-inline-calendar',
  standalone: true,
  imports: [FormsModule, DatePickerModule, CalendarA11yDirective],
  // Encapsulation.None under an `.am-cal` scope class: every rule below targets
  // PrimeNG's own generated classes, which :host ::ng-deep can reach but which
  // read far worse when every selector carries it.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="am-cal" (keydown)="onKeydownCapture($event)">
      <p-datepicker
        [inline]="true"
        [ngModel]="value()"
        (ngModelChange)="onDayPicked($event)"
        [ngModelOptions]="{ standalone: true }"
        [firstDayOfWeek]="0"
        [showOtherMonths]="true"
        [selectOtherMonths]="false"
        [minDate]="minDate() ?? undefined"
        [amCalendarA11y]="describeDay"
      >
        <ng-template #date let-d>
          <span
            class="am-cal__day"
            [class.am-cal__day--nonworking]="isNonWorking(d)"
            [class.am-cal__day--holiday]="isHoliday(d)"
            >{{ d.day }}</span
          >
        </ng-template>
      </p-datepicker>
    </div>
  `,
  styles: [
    `
      /* Artboard 12's geometry, as the numbers it names so a template can
         budget against them: 258px date-only, 314px with the time strip. */
      /* FULL WIDTH of whatever holds it, as Template 3 draws it: seven columns
         across the body, no empty half. It used to be max-content, which left
         the calendar at ~226px in a 520px dialog body.
         --am-cal-cell is now a FLOOR, not a fixed size: the cells stretch to
         fill and never go under 28px (the WCAG 2.5.8 floor of 24 plus margin
         for a trackpad slip). The HEIGHT stays 28px, so the six-row budget of
         178px — and the 258/314 panel totals — are unchanged. */
      .am-cal {
        --am-cal-cell: 28px;
        --am-cal-gap: 2px;
        inline-size: 100%;
      }

      .am-cal .p-datepicker-panel {
        inline-size: 100%;
        border: 1px solid var(--am-border);
        border-radius: 8px;
        padding: 8px;
        background: var(--am-surface-raised);
      }

      .am-cal .p-datepicker-header {
        block-size: 32px;
        min-block-size: 32px;
        padding: 0;
        margin-block-end: 6px;
        border-block-end: none;
        background: transparent;
      }

      .am-cal .p-datepicker-prev-button,
      .am-cal .p-datepicker-next-button {
        inline-size: 28px;
        block-size: 28px;
      }

      /* The chevrons MIRROR, not just the buttons' positions. Flex already
         swaps which side each button sits on in RTL, but PrimeNG's icons are
         literal left/right chevrons — so "previous" ended up on the right
         still pointing left, i.e. away from the direction it travels. Artboard
         12: "the header chevrons mirror with it". */
      :dir(rtl) .am-cal .p-datepicker-prev-button svg,
      :dir(rtl) .am-cal .p-datepicker-next-button svg {
        transform: scaleX(-1);
      }

      .am-cal .p-datepicker-weekday-cell {
        block-size: 20px;
        padding: 0;
      }

      .am-cal .p-datepicker-weekday {
        font-size: 10.5px;
        font-weight: 700;
        color: var(--am-ink-500);
      }

      /* Six rows' worth of height, always — see "Six rows" in the header
         comment. 6 x 28 + 5 x 2 = 178; the negative margin cancels the ring of
         border-spacing outside the table. */
      .am-cal .p-datepicker-day-view {
        /* Block only. An inline negative margin left the table's own content
           2px wider than its box — harmless, since both it and its container
           are overflow: visible and the panel above them does not scroll, but
           it reads as an overflow in any measurement and is not worth keeping
           for nothing. */
        margin-block: calc(var(--am-cal-gap) * -1);
        margin-inline: 0;
        margin-block-start: calc(4px - var(--am-cal-gap));
        border-spacing: var(--am-cal-gap);
        border-collapse: separate;
        block-size: calc(6 * var(--am-cal-cell) + 5 * var(--am-cal-gap));
      }

      .am-cal .p-datepicker-day-view tr {
        block-size: var(--am-cal-cell);
      }

      /* Seven equal columns across whatever width the table gets. */
      .am-cal .p-datepicker-day-view {
        inline-size: 100%;
        table-layout: fixed;
      }

      .am-cal .p-datepicker-day-cell {
        inline-size: calc(100% / 7);
      }

      .am-cal .p-datepicker-day-cell {
        padding: 0;
      }

      /* The cell. PrimeNG's own span is the target and carries the selected
         fill; the inner am-cal__day carries the marker textures, so the two
         never fight over one background. */
      .am-cal .p-datepicker-day {
        inline-size: 100%;
        min-inline-size: var(--am-cal-cell);
        block-size: var(--am-cal-cell);
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: var(--am-ink-900);
        padding: 0;
      }

      .am-cal__day {
        inline-size: 100%;
        block-size: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        box-sizing: border-box;
      }

      /* Non-working — the system hatch, the same "present but not available"
         texture the restricted relation uses. Not colour alone, and NOT
         disabled: a task may legitimately be due on a Friday. */
      .am-cal__day--nonworking {
        background: var(--am-restricted-hatch);
        color: var(--am-ink-700);
      }

      /* Holiday — the hatch PLUS a dotted underline. The amber border in the
         drawing is 1.30:1 and could never be the signal; it decorates a state
         the texture has already made. */
      .am-cal__day--holiday {
        background: var(--am-restricted-hatch);
        color: var(--am-warning-ink);
        border: 1px solid var(--am-warning-border);
        text-decoration: underline dotted;
        text-underline-offset: 2px;
      }

      /* Today — a border. */
      .am-cal .p-datepicker-today > .p-datepicker-day {
        border: 1px solid var(--am-primary-600);
        color: var(--am-primary-700);
        font-weight: 700;
      }

      /* Selected — a fill. Wins over every marker above, which is why it is
         last and why it paints the inner span too. */
      .am-cal .p-datepicker-day-selected,
      .am-cal .p-datepicker-day-selected .am-cal__day {
        background: var(--am-primary-600);
        color: #fff;
        font-weight: 600;
        border-color: transparent;
      }

      /* Focused — the system ring, never a tint, so it is never confused with
         the selected fill. */
      .am-cal .p-datepicker-day:focus-visible {
        outline: none;
        box-shadow:
          0 0 0 var(--am-focus-ring-offset) var(--am-surface-raised),
          0 0 0 calc(var(--am-focus-ring-offset) + var(--am-focus-ring-width)) var(--am-focus-ring);
      }

      /* Other month — inert. Unreachable by pointer here, by arrow key in
         PrimeNG, and by a screen reader via CalendarA11yDirective. */
      .am-cal .p-datepicker-other-month > .p-datepicker-day {
        color: #a7b2c2;
        pointer-events: none;
        cursor: default;
      }

    `,
  ],
})
export class InlineCalendarComponent {
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly picker = viewChild(DatePicker);

  readonly value = model<Date | null>(null);
  /**
   * The earliest selectable day. PrimeNG's own isSelectable() refuses anything
   * before it, which gives the day `p-disabled` — so it is skipped by arrow
   * traversal and by pointer exactly as an other-month day is, with no second
   * mechanism to keep in step.
   */
  readonly minDate = input<Date | null>(null);

  /** 0=Sun … 6=Sat. Null or empty means "not known" — nothing is hatched. */
  readonly workingDays = input<readonly number[] | null>(null);
  readonly holidays = input<HolidayMap | null>(null);

  // ── Day markers ────────────────────────────────────────────────────────

  isNonWorking(d: DayMeta): boolean {
    const days = this.workingDays();
    if (!days || days.length === 0) return false;
    return !days.includes(new Date(d.year, d.month, d.day).getDay());
  }

  isHoliday(d: DayMeta): boolean {
    return !!this.holidays()?.has(dayKey(new Date(d.year, d.month, d.day)));
  }

  // ── The announcement ───────────────────────────────────────────────────

  // An arrow function, because it is handed to the directive as a value.
  readonly describeDay = (key: string): string => {
    const at = parsePrimeKey(key);
    if (!at) return '';
    // Through the formatting layer, never a local Intl formatter: ACC-94 makes
    // that a REQUIRED pattern and check:formatting enforces it. The layer also
    // gets the ordering right — `en` is en-US, which would announce
    // "September 22, 2026" while the field beside it reads "22 Sep 2026".
    const full = this.format.dateWithWeekday(at);

    const holiday = this.holidays()?.get(dayKey(at));
    if (holiday) return `${full}, ${this.translate.instant('calendar.a11y.holiday')} — ${holiday}`;

    const days = this.workingDays();
    if (!days || days.length === 0) return full;
    const fact = days.includes(at.getDay())
      ? 'calendar.a11y.workingDay'
      : 'calendar.a11y.nonWorkingDay';
    return `${full}, ${this.translate.instant(fact)}`;
  };

  // ── Value ──────────────────────────────────────────────────────────────

  onDayPicked(next: Date | null): void {
    // Deliberately does NOT close anything. This component does not know
    // whether it sits in a layer; its host decides, and artboard 12 is explicit
    // that the day is usually picked before the time.
    this.value.set(next);
  }

  // ── The two PrimeNG overrides ──────────────────────────────────────────

  /**
   * Bound on an ANCESTOR of the day cells, so it runs before PrimeNG's own
   * (keydown) binding on the cell reaches its handler via bubbling.
   *
   * 1. RTL arrow direction. `onDateCellKeydown`'s `case 37` always walks to
   *    previousElementSibling. A month's DOM order does not mirror, so in
   *    Arabic the left arrow moves to the PREVIOUS day while the eye expects
   *    the next one. Artboard 12 names this exactly: "mirroring the layout but
   *    not the keys is the bug that makes Arabic keyboard users navigate
   *    backwards."
   *
   *    Fixed by re-dispatching the MIRRORED key rather than re-implementing the
   *    traversal — PrimeNG's handler already does the hard part (skipping
   *    p-disabled cells, advancing the month at the edges), and duplicating
   *    that is how the two drift apart. `which` is a prototype getter and
   *    cannot be set through the constructor, so it is defined on the instance.
   *
   * 2. Shift+PageUp/PageDown by year. `case 33`/`34` compute a target one
   *    MONTH away and never read shiftKey, so there is nothing to re-dispatch;
   *    the year step is driven directly.
   */
  onKeydownCapture(event: KeyboardEvent): void {
    if ((event as MirroredKeyboardEvent).__amMirrored) return;

    const target = event.target as HTMLElement | null;
    if (!target?.matches?.('span[data-date]')) return;

    // ARROWING ACROSS A MONTH BOUNDARY OTHERWISE LOSES FOCUS ENTIRELY.
    //
    // PrimeNG's handler calls navigateToMonth(), which rebuilds the grid and
    // leaves updateFocus() to land on a day. That path is written for the
    // overlay and does not land inline: the month advances and focus falls
    // back to <body>, dropping a keyboard user out of the calendar mid-walk.
    // Seen in a browser — the month DID change, which is exactly what made it
    // look like it had worked.
    //
    // Restored after PrimeNG has rebuilt, and only if focus really was lost to
    // <body>. Narrow on purpose: <body> holding focus means nothing else has
    // claimed it, so this can never steal focus from another control.
    if (NAVIGATION_KEYS.has(event.key)) this.restoreGridFocusAfterRebuild();

    if (event.shiftKey && (event.key === 'PageUp' || event.key === 'PageDown')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.stepYear(event.key === 'PageUp' ? -1 : 1, target);
      return;
    }

    if (!this.language.isRtl()) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    const mirrored = event.key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
    const code = mirrored === 'ArrowRight' ? 39 : 37;

    event.preventDefault();
    event.stopImmediatePropagation();

    const clone = new KeyboardEvent('keydown', {
      key: mirrored,
      code: mirrored,
      bubbles: true,
      cancelable: true,
    }) as MirroredKeyboardEvent;
    Object.defineProperty(clone, 'which', { get: () => code });
    Object.defineProperty(clone, 'keyCode', { get: () => code });
    clone.__amMirrored = true;
    target.dispatchEvent(clone);
  }

  private restoreGridFocusAfterRebuild(): void {
    setTimeout(() => {
      if (document.activeElement !== document.body) return;
      const root = this.host.nativeElement;
      const stop =
        root.querySelector<HTMLElement>('span[data-date][tabindex="0"]:not(.p-disabled)') ??
        root.querySelector<HTMLElement>('span[data-date]:not(.p-disabled)');
      stop?.focus();
    });
  }

  private stepYear(delta: number, cell: HTMLElement): void {
    const picker = this.picker();
    const from = parsePrimeKey(cell.dataset['date'] ?? '');
    if (!picker || !from) return;

    const target = new Date(from.getFullYear() + delta, from.getMonth(), from.getDate());
    picker.currentYear = target.getFullYear();
    picker.currentMonth = target.getMonth();
    picker.createMonths(picker.currentMonth, picker.currentYear);

    // Focus the same day in the new year, or the first real day when that date
    // does not exist there (29 February).
    queueMicrotask(() => {
      const root = this.host.nativeElement;
      const wanted = root.querySelector<HTMLElement>(
        `span[data-date="${primeKey(target)}"]:not(.p-disabled)`,
      );
      (wanted ?? root.querySelector<HTMLElement>('span[data-date]:not(.p-disabled)'))?.focus();
    });
  }
}

const NAVIGATION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);

interface DayMeta {
  day: number;
  month: number;
  year: number;
  otherMonth?: boolean;
}

interface MirroredKeyboardEvent extends KeyboardEvent {
  __amMirrored?: boolean;
}
