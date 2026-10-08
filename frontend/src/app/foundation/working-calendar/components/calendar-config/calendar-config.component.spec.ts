import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { provideFormatTesting } from '../../../../core/formatting/testing';
import { CalendarConfigComponent } from './calendar-config.component';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';

/**
 * ACC-120 slice 1 — the Template 5 behaviours that are structural rather than
 * stylistic, and the two that were browser defects on the old screen.
 */
const CALENDAR = {
  id: 'cal-a',
  organizationId: 'org-a',
  timezone: 'Asia/Riyadh',
  workingDays: [0, 1, 2, 3, 4],
  workingHoursStart: '08:00',
  workingHoursEnd: '16:00',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const base = `${environment.apiUrl}/working-calendar`;

function setup(permissions: string[]): {
  fixture: ComponentFixture<CalendarConfigComponent>;
  http: HttpTestingController;
  page: CalendarConfigComponent;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CalendarConfigComponent],
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
  const fixture = TestBed.createComponent(CalendarConfigComponent);
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  return { fixture, http, page: fixture.componentInstance };
}

/** Answers both of the page's requests; `history` may be a 403. */
function flush(
  http: HttpTestingController,
  options: { history?: unknown[] | 'denied' } = {},
): void {
  http.expectOne(base).flush(CALENDAR);
  const history = http.match(`${base}/history`);
  for (const req of history) {
    if (options.history === 'denied') {
      req.flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
    } else {
      req.flush(options.history ?? []);
    }
  }
}

/**
 * Flush both requests AND let the fill effect run.
 *
 * The forms are filled by an effect on the calendar outcome, and this app is
 * zoneless — so whenStable() alone does not run it. Without the extra
 * detectChanges() every assertion measures an unfilled form, which reads as five
 * unrelated failures rather than one missing pass.
 */
async function settle(
  fixture: ComponentFixture<CalendarConfigComponent>,
  http: HttpTestingController,
  options: { history?: unknown[] | 'denied' } = {},
): Promise<void> {
  flush(http, options);
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('CalendarConfigComponent (ACC-120 slice 1)', () => {
  // The direction is global, so a spec that sets it must put it back or every
  // later spec inherits an RTL document. ACC-184 — declared first so it runs
  // last, after verify() below has used the live TestBed.
  preserveDocumentLanguage();

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
  });

  describe('two sections, each saved on its own', () => {
    it('saves ONLY the working days from the working-week section', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.toggleDay(5);
      page.saveWeek();

      const req = http.expectOne((r) => r.url === base && r.method === 'PATCH');
      // The hours section is untouched, so its fields must not travel with this
      // save — that is the whole point of a section-level Save.
      expect(Object.keys(req.request.body)).toEqual(['workingDays']);
      expect(req.request.body.workingDays).toContain(5);
      req.flush(CALENDAR);
      http.match(`${base}/history`).forEach((r) => r.flush([]));
    });

    it('saves ONLY the hours and zone from the hours section', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.hoursForm.controls.workingHoursEnd.setValue('17:00');
      page.saveHours();

      const req = http.expectOne((r) => r.url === base && r.method === 'PATCH');
      expect(Object.keys(req.request.body).sort()).toEqual([
        'timezone',
        'workingHoursEnd',
        'workingHoursStart',
      ]);
      req.flush(CALENDAR);
      http.match(`${base}/history`).forEach((r) => r.flush([]));
    });

    it('is not dirty before anything is touched, and each section tracks its own', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      expect(page.weekDirty()).toBeFalse();
      expect(page.hoursDirty()).toBeFalse();

      page.toggleDay(5);
      expect(page.weekDirty()).toBeTrue();
      expect(page.hoursDirty()).withContext('one section must not dirty the other').toBeFalse();
    });

    // workingDays is a SET. Unticking Friday and re-ticking it leaves the same
    // week, and a page that still says "Unsaved" is training people to ignore it.
    it('is clean again when a day is toggled back', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.toggleDay(4);
      expect(page.weekDirty()).toBeTrue();
      page.toggleDay(4);

      expect(page.weekDirty()).toBeFalse();
    });

    it('discards back to what the server holds', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.applyPreset([1, 2, 3, 4, 5]);
      page.resetWeek();

      expect(page.selectedDays()).toEqual([0, 1, 2, 3, 4]);
      expect(page.weekDirty()).toBeFalse();
    });
  });

  describe('the guards on a working week', () => {
    it('refuses to save no working days at all', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      for (const d of [0, 1, 2, 3, 4]) page.toggleDay(d);
      expect(page.noDaysChosen()).toBeTrue();

      page.saveWeek();

      http.expectNone((r) => r.method === 'PATCH');
    });

    // The validator sits on the END control and reads its sibling. The first
    // version put it on the group and set the child's error from there, which set
    // it and never cleared it — this pair of tests is what found that.
    it('refuses a working day that ends before it starts', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.hoursForm.controls.workingHoursStart.setValue('17:00');

      expect(page.hoursForm.invalid).toBeTrue();
      expect(page.hoursForm.controls.workingHoursEnd.errors?.['endBeforeStart']).toBeTrue();

      page.saveHours();
      http.expectNone((r) => r.method === 'PATCH');
    });

    it('accepts it again once the start moves back', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      page.hoursForm.controls.workingHoursStart.setValue('17:00');
      expect(page.hoursForm.invalid).toBeTrue();

      page.hoursForm.controls.workingHoursStart.setValue('07:00');

      expect(page.hoursForm.invalid).toBeFalse();
    });
  });

  // The header line is real audit data, which is what made it worth building
  // rather than showing a date with no actor.
  describe('last changed', () => {
    it('names who changed it, from the audit trail', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http, {
        history: [
          {
            id: 'a2',
            changedAt: '2026-09-20T10:00:00.000Z',
            actorName: 'Nora Al-Otaibi',
            before: { ...CALENDAR, workingHoursEnd: '16:00' },
            after: { ...CALENDAR, workingHoursEnd: '17:00' },
          },
        ],
      });

      expect(page.lastChange()?.actorName).toBe('Nora Al-Otaibi');
      // And the entry says WHAT changed, which is what Template 5's reset note
      // promises the history records.
      const fields = page.fieldsOf(page.lastChange()!);
      expect(fields.map((f) => f.labelKey)).toEqual(['workingCalendar.workingHoursEnd']);
    });

    // THE MEANING MUST BE IN WORDS. The first version put it in a line-through
    // and an aria-hidden arrow, so a screen reader heard two day lists with
    // nothing saying which was old — the sibling of colour-only, which the design
    // system already forbids.
    it('says which value is old IN WORDS, not only as a decoration', async () => {
      const { fixture, http } = setup(['org:view', 'org:manage']);
      await settle(fixture, http, {
        history: [
          {
            id: 'a1',
            changedAt: '2026-09-20T10:00:00.000Z',
            actorName: 'Nora Al-Otaibi',
            before: { ...CALENDAR, workingDays: [0, 1, 2, 3, 4] },
            after: { ...CALENDAR, workingDays: [0, 1, 2, 3] },
          },
        ],
      });
      fixture.componentInstance.historyOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const row = document.querySelector('.am-history__fields li');
      expect(row).withContext('history row not rendered').not.toBeNull();

      // Semantic elements, so a reader that announces them gets it...
      expect(row!.querySelector('del')).not.toBeNull();
      expect(row!.querySelector('ins')).not.toBeNull();
      // ...and the words, for the many that do not.
      const hidden = Array.from(row!.querySelectorAll('.sr-only')).map((e) => e.textContent?.trim());
      expect(hidden).toEqual(['workingCalendar.wasValue', 'workingCalendar.nowValue']);
    });

    // THE ARROW MUST FOLLOW THE READING DIRECTION. U+2192 is not bidi-mirrored
    // by the renderer, so in Arabic the values ordered correctly — old on the
    // right, new on the left — while the glyph kept pointing left-to-right and
    // therefore ran from the new value back to the old one. It is the row's only
    // visual direction cue.
    //
    // Asserted on the computed transform, and on the box NOT being inline — a
    // transform does not apply to a non-replaced inline element, so the rule
    // could parse, match and do nothing at all. It computes to `block` rather
    // than `inline-block` because the glyph is a flex item and flex items are
    // blockified; asserting inline-block would have been asserting the
    // declaration rather than the effect.
    for (const [dir, expected] of [
      ['ltr', 'none'],
      ['rtl', 'matrix(-1, 0, 0, 1, 0, 0)'],
    ] as const) {
      it(`renders the arrow ${dir === 'rtl' ? 'mirrored' : 'unmirrored'} in ${dir}`, async () => {
        document.documentElement.dir = dir;
        const { fixture, http } = setup(['org:view', 'org:manage']);
        await settle(fixture, http, {
          history: [
            {
              id: 'a1',
              changedAt: '2026-09-20T10:00:00.000Z',
              actorName: 'Nora Al-Otaibi',
              before: { ...CALENDAR, workingHoursEnd: '16:00' },
              after: { ...CALENDAR, workingHoursEnd: '17:00' },
            },
          ],
        });
        fixture.componentInstance.historyOpen.set(true);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const arrow = document.querySelector('.am-history__arrow') as HTMLElement | null;
        expect(arrow).withContext('arrow not rendered').not.toBeNull();
        expect(getComputedStyle(arrow!).display)
          .withContext('a transform does not apply to an inline element')
          .not.toBe('inline');
        expect(getComputedStyle(arrow!).transform).toBe(expected);
      });
    }

    it('shows nothing rather than an empty byline when no change is recorded', async () => {
      const { fixture, http, page } = setup(['org:view', 'org:manage']);
      await settle(fixture, http, { history: [] });

      expect(page.lastChange()).toBeNull();
    });
  });

  // THE PAGE STAYS USABLE WHEN THE HISTORY IS REFUSED. The calendar read needs no
  // permission and the history needs org:manage, so this is a real caller, not a
  // synthetic case — and a complete page with one annotation absent must not
  // report itself broken.
  describe('a caller who can read the calendar but not its history', () => {
    it('renders the calendar and omits the history, without reporting a failure', async () => {
      const { fixture, http, page } = setup(['org:view']);
      await settle(fixture, http, { history: 'denied' });

      expect(page.calendar()).not.toBeNull();
      expect(page.page()).withContext('the page itself is complete').toBe('complete');
      expect(page.lastChange()).toBeNull();
      expect(page.historyOutcome().status).toBe('denied');
    });

    it('offers neither Save, because it cannot write', async () => {
      const { fixture, http, page } = setup(['org:view']);
      await settle(fixture, http, { history: 'denied' });

      expect(page.canManage()).toBeFalse();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('workingCalendar.saveWorkingDays');
      expect(text).not.toContain('workingCalendar.saveWorkingHours');
    });
  });

  // A FEATURE STATE, not a request outcome: the endpoint has no handler at all,
  // so there is nothing to retry and no quota to explain. The block stays (it is
  // kept until AI features arrive) and offers no control that could only fail.
  describe('the AI suggestion block', () => {
    it('never calls the unbuilt endpoint', async () => {
      const { fixture, http } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      http.expectNone((r) => r.url.includes('/ai/suggest-holidays'));
    });

    it('says it is not available rather than offering a control', async () => {
      const { fixture, http } = setup(['org:view', 'org:manage']);
      await settle(fixture, http);

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('workingCalendar.suggestHolidaysUnavailable');
    });
  });
});
