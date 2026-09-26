import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { IOrgUnitHeadStatus } from '../../services/org-unit-head.service';
import { SetActingHeadDialogComponent } from './set-acting-head-dialog.component';

const dialogOf = (f: ComponentFixture<HostComponent>): SetActingHeadDialogComponent =>
  f.debugElement.children[0].children[0].componentInstance as SetActingHeadDialogComponent;

/**
 * ACC-120 slice 2 — the dialog body MUST NOT SCROLL HORIZONTALLY, measured
 * rather than reasoned about.
 *
 * Found in Ahmad's browser pass: every label in the dialog rendered
 * mid-sentence ("...ing covered for", "vill cover") because the body was
 * scrolled right, in both languages. The cause is a flex item that cannot
 * shrink — `<input>` carries an intrinsic width from its `size` attribute, and
 * a flex item's `min-width: auto` refuses to go below it, so Tailwind's
 * `flex-1` (`flex: 1 1 0%`) does NOT make it shrinkable on its own.
 *
 * `.am-dialog__body` sets only `overflow-y: auto`, which is the trap: per CSS
 * overflow, when one axis is not `visible` the other's `visible` COMPUTES TO
 * `auto`. So a body that only ever meant to scroll vertically silently gained a
 * horizontal scrollbar, and nothing in that rule says so.
 *
 * This spec exists because arithmetic could not settle it: adding up the
 * design's own numbers said the row fitted with ~20px to spare, and it did not.
 * A measurement in a real browser is the only honest check, and it pins the fix
 * against the next person who adds a third field to the row.
 */
@Component({
  standalone: true,
  imports: [SetActingHeadDialogComponent],
  // 560px is --am-dialog-form, the width this dialog actually gets.
  template: `
    <div style="width: 560px;">
      <app-set-acting-head-dialog
        orgUnitId="unit-pharmacy"
        unitName="Pharmacy"
        [status]="status()"
        [people]="people"
        [visible]="true"
      />
    </div>
  `,
})
class HostComponent {
  readonly status = signal<IOrgUnitHeadStatus>({
    holders: [],
    pendingHeadUserId: null,
    headHandoverEffectiveDate: null,
    actingHeadUserId: null,
  });
  readonly people = [{ id: 'u-huda', name: 'Dr. Huda Zahrani', email: 'huda@example.com' }];
}

function setup(dir: 'ltr' | 'rtl'): ComponentFixture<HostComponent> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      ConfirmationService,
      // The real preset, because PrimeNG's own control padding is part of the
      // width being measured. Without it the measurement is a lower bound.
      providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      provideTranslateService({ lang: 'en' }),
    ],
  });
  document.documentElement.dir = dir;
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

const body = (f: ComponentFixture<HostComponent>): HTMLElement | null =>
  document.querySelector('.am-dialog__body');

describe('SetActingHeadDialogComponent — the body does not scroll sideways (ACC-120)', () => {
  afterEach(() => {
    document.documentElement.dir = 'ltr';
  });

  for (const dir of ['ltr', 'rtl'] as const) {
    it(`has no horizontal overflow in ${dir}`, () => {
      const fixture = setup(dir);
      const el = body(fixture);

      // If the shell ever stops using this class the spec must fail loudly
      // rather than silently measure nothing.
      expect(el).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();

      // scrollWidth rounds, so 1px of subpixel rounding is not a defect; a
      // clipped sentence is tens of pixels.
      const overflow = el!.scrollWidth - el!.clientWidth;
      expect(overflow)
        .withContext(
          `body scrollWidth ${el!.scrollWidth} vs clientWidth ${el!.clientWidth} — ` +
            `content is ${overflow}px too wide, so every label renders mid-sentence`,
        )
        .toBeLessThanOrEqual(1);
    });
  }

  // ── The date view (ACC-120, second browser pass) ────────────────────────
  //
  // Two elements of it were simply not built — the design's fits table names
  // "back link 26 + date field 79 + 8 + calendar 258" and only the calendar
  // existed — and the calendar sat at its max-content width, leaving ~160px of
  // the body empty. Both came from rendering a local p-datepicker in a stacked
  // layer instead of the shared am-inline-calendar in this body.
  describe('the date view', () => {
    it('renders all three rows the design specifies', () => {
      const fixture = setup('ltr');
      dialogOf(fixture).openCalendar('from');
      fixture.detectChanges();

      const body = document.querySelector('.am-dialog__body')!;
      expect(body.querySelector('.am-backlink')).withContext('back link').not.toBeNull();
      expect(body.querySelector('.am-cover-dateview input')).withContext('typed date field').not.toBeNull();
      expect(body.querySelector('am-inline-calendar')).withContext('the shared calendar').not.toBeNull();
    });

    // The point of Ahmad's "one calendar, not one per page": a local
    // p-datepicker here would pass a "is there a calendar" check and still have
    // no tab stop on the grid, no RTL arrows and no day announcements.
    it('renders THE shared calendar, not a local p-datepicker', () => {
      const fixture = setup('ltr');
      dialogOf(fixture).openCalendar('until');
      fixture.detectChanges();

      const body = document.querySelector('.am-dialog__body')!;
      expect(body.querySelectorAll('am-inline-calendar').length).toBe(1);
      // The shared component's own scope class — present only if it rendered.
      expect(body.querySelector('.am-cal')).withContext('am-inline-calendar scope').not.toBeNull();
    });

    it('substitutes for the fields rather than stacking a second dialog', () => {
      const fixture = setup('ltr');
      dialogOf(fixture).openCalendar('from');
      fixture.detectChanges();

      expect(document.querySelectorAll('.am-dialog__body').length)
        .withContext('a second body means a second stacked dialog')
        .toBe(1);
      expect(document.querySelector('.am-cover-range'))
        .withContext('the range row should be gone, not pushed down')
        .toBeNull();
    });

    // ── WIDTH: why there is no pixel assertion on the calendar here ────────
    //
    // The second defect was the calendar sitting at its max-content width,
    // leaving ~160px of the body empty. The fix is not local: it is that
    // am-inline-calendar sets inline-size 100% on the panel, with a comment in
    // that file recording the same defect being fixed once before ("it used to
    // be max-content, which left the calendar at ~226px in a 520px dialog
    // body").
    //
    // It CANNOT be measured here, and saying so beats a green test that checks
    // nothing: PrimeNG builds the month grid outside this harness — the panel
    // holds only its container comment and reports a zero-width box, through
    // extra change-detection cycles and whenStable alike. So the panel's
    // rendered width is verified in a browser, and what this file pins is the
    // thing that CAUSES the right width: that we render the shared component
    // rather than a p-datepicker of our own (the test above).
    //
    // If a future change makes the grid render under Karma, add the pixel
    // assertion here rather than trusting this note.
    for (const dir of ['ltr', 'rtl'] as const) {
      it(`does not scroll sideways in the date view in ${dir}`, () => {
        const fixture = setup(dir);
        dialogOf(fixture).openCalendar('until');
        fixture.detectChanges();

        const body = document.querySelector('.am-dialog__body') as HTMLElement;
        expect(body.scrollWidth - body.clientWidth).toBeLessThanOrEqual(1);
      });
    }

    it('returns to the fields by the back link, not by closing the dialog', () => {
      const fixture = setup('ltr');
      const dialog = dialogOf(fixture);
      dialog.openCalendar('from');
      fixture.detectChanges();

      (document.querySelector('.am-backlink') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(dialog.calendarFor()).toBeNull();
      expect(document.querySelector('.am-cover-range')).not.toBeNull();
    });
  });

  // The specific mechanism, so a regression names itself instead of showing up
  // as "the labels look wrong again".
  it('lets both date inputs shrink below their intrinsic size', () => {
    const fixture = setup('ltr');
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('.am-cover-range__control input'),
    );

    expect(inputs.length).toBe(2);
    for (const input of inputs) {
      expect(getComputedStyle(input).minWidth)
        .withContext('min-width:auto keeps an input at its size-attribute width inside a flex row')
        .toBe('0px');
    }
  });
});
