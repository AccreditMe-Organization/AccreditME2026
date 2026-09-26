import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { provideFormatTesting } from '../../../../core/formatting/testing';
import { PublicHolidayListComponent } from './public-holiday-list.component';

/**
 * ACC-120 slice 1 — the inline add row, and the row-grid contract that a
 * browser pass found broken.
 */
const HOLIDAY = {
  id: 'h1',
  workingCalendarId: 'cal-a',
  nameEn: 'Saudi National Day',
  nameAr: 'اليوم الوطني',
  date: '2026-09-23',
  isRecurring: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const holidaysUrl = (): string => `${environment.apiUrl}/working-calendar/holidays`;

function setup(permissions: string[]): {
  fixture: ComponentFixture<PublicHolidayListComponent>;
  http: HttpTestingController;
  page: PublicHolidayListComponent;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PublicHolidayListComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      ConfirmationService,
      provideTranslateService({ lang: 'en' }),
      provideFormatTesting(),
      {
        provide: NavigationAccessService,
        useValue: {
          hasPermission: (p: string) => permissions.includes(p),
          isPlatformAdmin: () => false,
          permissions: () => permissions,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(PublicHolidayListComponent);
  fixture.detectChanges();
  return {
    fixture,
    http: TestBed.inject(HttpTestingController),
    page: fixture.componentInstance,
  };
}

async function settle(
  fixture: ComponentFixture<PublicHolidayListComponent>,
  http: HttpTestingController,
  rows: unknown[] = [HOLIDAY],
): Promise<void> {
  for (const req of http.match((r) => r.url.startsWith(holidaysUrl()))) {
    if (!req.cancelled) req.flush(rows);
  }
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('PublicHolidayListComponent (ACC-120 slice 1)', () => {
  afterEach(() => {
    const http = TestBed.inject(HttpTestingController);
    // app-data-list CANCELS its in-flight source request when it reloads — after
    // an add, an edit or a year change — and a cancelled request cannot be
    // flushed. So drain what is genuinely still open and ignore the rest, rather
    // than every test failing with "Cannot flush a cancelled request".
    for (const req of http.match(() => true)) {
      if (!req.cancelled) req.flush([]);
    }
    http.verify({ ignoreCancelled: true });
  });

  // THE ROW-GRID CONTRACT, and the defect it exists for.
  //
  // app-data-list wraps its HEADER in grid-template-columns: var(--am-list-cols)
  // but renders the consumer's #listRow template straight into the rows body. A
  // row that emits bare cells therefore flows inline: measured in a browser, the
  // headers spread the full width while the data bunched into the first ~230px
  // with the action icons stranded 1300px away and 27px below the text line.
  //
  // Asserted on the STYLE, not on pixels: the harness cannot lay PrimeNG out, and
  // the grid declaration is the thing that was missing.
  describe('the row follows its column headers', () => {
    it('declares the shared column grid on its own row element', async () => {
      const { fixture, http } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      // Named, not matched on the style variable: app-data-list's own wrapper
      // DEFINES --am-list-cols, so a loose selector finds the definer rather than
      // the row that has to consume it.
      const row = (fixture.nativeElement as HTMLElement).querySelector(
        '.am-holiday-list__row',
      ) as HTMLElement | null;
      expect(row)
        .withContext('a row without the grid flows inline under spread headers')
        .not.toBeNull();
      expect(row!.classList).toContain('grid');
      expect(row!.getAttribute('style')).toContain('var(--am-list-cols)');
    });

    // The other half of the same omission: 21px text cells beside 32px icon
    // buttons read as a second line unless the row centres them.
    it('centres its cells, so the action icons sit on the text line', async () => {
      const { fixture, http } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      const row = (fixture.nativeElement as HTMLElement).querySelector(
        '.am-holiday-list__row',
      ) as HTMLElement | null;
      expect(row!.classList).toContain('items-center');
    });
  });

  describe('the inline add row', () => {
    it('is absent for a caller who cannot write', async () => {
      const { fixture, http } = setup(['org:view']);
      await settle(fixture, http);

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('form.am-holiday-row'),
      ).toBeNull();
    });

    it('posts a calendar day built from local parts, never an instant', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.form.controls.nameEn.setValue('Founding Day');
      // 22 Feb 2026, local midnight. toISOString() on a tenant ahead of UTC
      // would send the 21st — a holiday is a calendar day, not an instant.
      page.onDatePicked(new Date(2026, 1, 22));
      page.submit();

      const req = http.expectOne((r) => r.url === holidaysUrl() && r.method === 'POST');
      expect(req.request.body.date).toBe('2026-02-22');
      req.flush(HOLIDAY);
    });

    // Enter adds and keeps the row open — the whole reason this stopped being a
    // dialog, since eight ministry holidays arrive at once.
    it('clears itself after adding, ready for the next holiday', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.form.controls.nameEn.setValue('Founding Day');
      page.onDatePicked(new Date(2026, 1, 22));
      page.submit();
      http.expectOne((r) => r.method === 'POST').flush(HOLIDAY);

      expect(page.form.controls.nameEn.value).toBe('');
      expect(page.pickedDate()).toBeNull();
      expect(page.editing()).toBeNull();
    });

    it('switches to edit in place, and back to add on cancel', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.startEdit(HOLIDAY);
      expect(page.editing()?.id).toBe('h1');
      expect(page.form.controls.nameEn.value).toBe('Saudi National Day');

      page.resetRow();
      expect(page.editing()).toBeNull();
      expect(page.form.controls.nameEn.value).toBe('');
    });

    it('PATCHes rather than POSTs while editing', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.startEdit(HOLIDAY);
      page.form.controls.nameEn.setValue('National Day');
      page.submit();

      const req = http.expectOne(`${holidaysUrl()}/h1`);
      expect(req.request.method).toBe('PATCH');
      req.flush(HOLIDAY);
    });

    it('shows the Hijri equivalent of the chosen date, whatever the reader prefers', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.onDatePicked(new Date(2026, 8, 23));

      // Entry confirmation, not a calendar preference — nothing can set
      // hijriDisplay yet, so a preference-gated line would show for nobody.
      expect(page.dateHint()).toContain('1448');
    });
  });

  // Pulled forward from slice 10 because this slice rebuilt the row the button
  // sits on, and deleting a holiday silently changes what the SLA clock does.
  describe('delete', () => {
    it('asks before deleting, and does not delete when refused', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);
      const confirmation = TestBed.inject(ConfirmationService);
      let asked = false;
      confirmation.requireConfirmation$.subscribe(() => (asked = true));

      page.confirmDelete(HOLIDAY);

      expect(asked).withContext('delete must ask first').toBeTrue();
      http.expectNone((r) => r.method === 'DELETE');
    });
  });
});
