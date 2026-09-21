// ACC-96 — the three things PrimeNG does NOT do, and the one thing it does.
//
// These are the only behaviours in the calendar that are ours rather than the
// library's, which makes them the only ones that can silently regress on a
// PrimeNG upgrade. Each asserts BOTH directions: an RTL test that passes in
// LTR too would prove nothing, since the whole claim is that the two differ.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { InlineCalendarComponent, dayKey } from './inline-calendar.component';
import { LanguageService } from '../../../core/services/language.service';

// A real Sunday-to-Thursday week, and a holiday on it.
const WORKING_DAYS = [0, 1, 2, 3, 4];
const HOLIDAY_KEY = '2026-09-23';

@Component({
  standalone: true,
  imports: [InlineCalendarComponent],
  template: `
    <am-inline-calendar
      [(value)]="value"
      [showTime]="showTime()"
      [workingDays]="workingDays()"
      [holidays]="holidays()"
    />
  `,
})
class HostComponent {
  readonly value = signal<Date | null>(new Date(2026, 8, 22, 9, 0));
  readonly showTime = signal(false);
  readonly workingDays = signal<readonly number[] | null>(WORKING_DAYS);
  readonly holidays = signal(new Map([[HOLIDAY_KEY, 'National Day']]));
}

describe('InlineCalendarComponent (ACC-96)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let rtl: boolean;

  const cellFor = (day: number): HTMLElement => {
    const el = fixture.nativeElement as HTMLElement;
    const match = Array.from(el.querySelectorAll<HTMLElement>('span[data-date]')).find(
      (s) => s.textContent?.trim() === String(day) && !isOtherMonth(s),
    );
    if (!match) throw new Error(`no in-month cell for day ${day}`);
    return match;
  };

  const isOtherMonth = (span: HTMLElement): boolean =>
    !!span.closest('td')?.classList.contains('p-datepicker-other-month');

  beforeEach(async () => {
    rtl = false;
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        {
          provide: LanguageService,
          useValue: { isRtl: () => rtl, isArabic: () => rtl },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  // ── Day markers ─────────────────────────────────────────────────────────

  it('marks non-working days and holidays without disabling either', () => {
    // 25 Sep 2026 is a Friday — outside Sun–Thu.
    const friday = cellFor(25);
    expect(friday.querySelector('.am-cal__day--nonworking')).toBeTruthy();
    expect(friday.classList.contains('p-disabled'))
      .withContext('a task may legitimately be due on a Friday — marked, never blocked')
      .toBe(false);

    const holiday = cellFor(23);
    expect(holiday.querySelector('.am-cal__day--holiday')).toBeTruthy();
    expect(holiday.classList.contains('p-disabled')).toBe(false);
  });

  it('marks nothing when the working calendar is not known', () => {
    host.workingDays.set(null);
    host.holidays.set(new Map());
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.am-cal__day--nonworking').length).toBe(0);
    expect(el.querySelectorAll('.am-cal__day--holiday').length).toBe(0);
  });

  // ── Other-month cells are inert ─────────────────────────────────────────

  it('hides other-month cells from the accessibility tree and names the real ones', () => {
    const el = fixture.nativeElement as HTMLElement;
    const others = Array.from(el.querySelectorAll<HTMLElement>('td.p-datepicker-other-month'));
    expect(others.length).toBeGreaterThan(0);
    for (const cell of others) {
      expect(cell.getAttribute('aria-hidden')).toBe('true');
      expect(cell.getAttribute('aria-label')).toBeNull();
    }

    // PrimeNG's own aria-label is the bare day number; ours is the full date
    // plus the working-day fact, because that is what changes the SLA meaning.
    const tuesday = cellFor(22).closest('td')!;
    expect(tuesday.getAttribute('aria-hidden')).toBeNull();
    expect(tuesday.getAttribute('aria-label')).toContain('22 September 2026');
    expect(tuesday.getAttribute('aria-label')).toContain('Tuesday');

    const holiday = cellFor(23).closest('td')!;
    expect(holiday.getAttribute('aria-label')).toContain('National Day');
  });

  it('other-month cells are non-selectable, which is what makes arrows skip them', () => {
    const el = fixture.nativeElement as HTMLElement;
    const other = el.querySelector<HTMLElement>('td.p-datepicker-other-month span[data-date]');
    // PrimeNG's own doing (selectOtherMonths defaults false) — asserted here
    // because the arrow-skip behaviour we rely on is keyed to this class.
    expect(other?.classList.contains('p-disabled')).toBe(true);
  });

  // ── Override 1: RTL arrow direction ─────────────────────────────────────

  describe('arrow direction', () => {
    // The mirrored event PrimeNG ends up seeing, captured at the cell.
    const keysSeenBy = (cell: HTMLElement, press: string): string[] => {
      const seen: string[] = [];
      cell.addEventListener('keydown', (e) => seen.push((e as KeyboardEvent).key));
      cell.dispatchEvent(
        new KeyboardEvent('keydown', { key: press, code: press, bubbles: true, cancelable: true }),
      );
      return seen;
    };

    it('passes arrows through unchanged in English', () => {
      expect(keysSeenBy(cellFor(22), 'ArrowLeft')).toEqual(['ArrowLeft']);
      expect(keysSeenBy(cellFor(22), 'ArrowRight')).toEqual(['ArrowRight']);
    });

    it('mirrors arrows in Arabic, so the left arrow moves to the visually left cell', () => {
      rtl = true;
      // Both the original and the mirrored event reach the listener; the
      // original is the one PrimeNG's handler no longer acts on, because
      // stopImmediatePropagation fires before its own binding.
      expect(keysSeenBy(cellFor(22), 'ArrowLeft')).toContain('ArrowRight');
      expect(keysSeenBy(cellFor(22), 'ArrowLeft')).not.toEqual(['ArrowLeft']);
      expect(keysSeenBy(cellFor(22), 'ArrowRight')).toContain('ArrowLeft');
    });

    it('gives the mirrored event the keyCode PrimeNG actually reads', () => {
      rtl = true;
      const cell = cellFor(22);
      const codes: number[] = [];
      cell.addEventListener('keydown', (e) => codes.push((e as KeyboardEvent).which));
      cell.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          bubbles: true,
          cancelable: true,
        }),
      );
      // onDateCellKeydown switches on event.which, never event.key — so a
      // mirrored event that only carried `key` would do nothing at all.
      expect(codes).toContain(39);
    });

    it('does not mirror keys that are not arrows', () => {
      rtl = true;
      expect(keysSeenBy(cellFor(22), 'Enter')).toEqual(['Enter']);
      expect(keysSeenBy(cellFor(22), 'Home')).toEqual(['Home']);
    });
  });

  // ── Override 2: Shift+PageUp / PageDown by year ─────────────────────────

  describe('year step', () => {
    const press = (cell: HTMLElement, key: string, shiftKey: boolean): void => {
      cell.dispatchEvent(
        new KeyboardEvent('keydown', { key, code: key, shiftKey, bubbles: true, cancelable: true }),
      );
      fixture.detectChanges();
    };

    const shownTitle = (): string =>
      (fixture.nativeElement as HTMLElement).querySelector('.p-datepicker-header')?.textContent ??
      '';

    it('moves a year back on Shift+PageUp and forward on Shift+PageDown', () => {
      expect(shownTitle()).toContain('2026');

      press(cellFor(22), 'PageUp', true);
      expect(shownTitle()).toContain('2025');

      press(cellFor(22), 'PageDown', true);
      expect(shownTitle()).toContain('2026');
    });

    it('leaves plain PageUp to PrimeNG, which steps by month', () => {
      press(cellFor(22), 'PageUp', false);
      // Still 2026 — a month step, not a year step. The assertion is that we
      // did NOT intercept, which is the half most easily broken by widening
      // the guard.
      expect(shownTitle()).toContain('2026');
    });
  });

  // ── The time strip ──────────────────────────────────────────────────────

  it('renders no time strip unless asked, and a masked field when asked', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.am-cal__time')).toBeNull();

    host.showTime.set(true);
    fixture.detectChanges();

    const mask = el.querySelector<HTMLInputElement>('.am-cal__time input');
    expect(mask).toBeTruthy();
    // p-inputmask, not p-datepicker's hour/minute spinners (artboard 12's
    // named compromise).
    expect(el.querySelector('.p-datepicker-time-picker')).toBeNull();
  });

  // ── Picking ─────────────────────────────────────────────────────────────

  it('writes the picked day out and does not close or clear anything', () => {
    cellFor(25).click();
    fixture.detectChanges();
    expect(dayKey(host.value()!)).toBe('2026-09-25');
    // Still rendered: this component never dismisses itself, because it does
    // not know whether it is in a layer.
    expect((fixture.nativeElement as HTMLElement).querySelector('.p-datepicker-panel')).toBeTruthy();
  });
});
