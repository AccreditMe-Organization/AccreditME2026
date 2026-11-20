import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { BehaviorSubject, of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { aMeeting, aSeries } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingDto } from '../../services/meeting.service';
import { MeetingPageComponent } from './meeting-page.component';
import { MeetingPageHostComponent } from './meeting-page-host.component';

// ACC-316 PR 8b — the series on the meeting's page: the readback and where this
// meeting sits, previous and next ONLY where the server names them (the screen
// never works out a neighbour), and the whole series, which carries the series
// to the list. And /meetings/:id opens a new page when only the id changes.
describe('Meeting page — the series (ACC-316 PR 8b)', () => {
  preserveDocumentLanguage();
  let meeting: MeetingDto;
  let get: jasmine.Spy;
  let paramMap: BehaviorSubject<ParamMap>;
  const route = { snapshot: { paramMap: convertToParamMap({ id: 'm-1' }) }, paramMap: null as unknown as BehaviorSubject<ParamMap> };

  function configure() {
    paramMap = new BehaviorSubject(convertToParamMap({ id: 'm-1' }));
    route.snapshot = { paramMap: convertToParamMap({ id: 'm-1' }) };
    route.paramMap = paramMap;
    get = jasmine.createSpy('get').and.callFake((id: string) => of({ ...meeting, id }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: route },
        {
          provide: MeetingService,
          useValue: {
            get,
            attendees: () => of([]),
            agenda: () => of([]),
            files: () => of({ attachments: [], papers: [] }),
            minutes: () => of(null),
            openActions: () => of({ mayRead: false, rows: [] }),
          },
        },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
  }

  function create(language: 'en' | 'ar' = 'en') {
    configure();
    TestBed.inject(TranslateService).use(language);
    const fixture = TestBed.createComponent(MeetingPageComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const q = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  beforeEach(() => {
    meeting = aMeeting({ series: aSeries() });
  });

  it('says the pattern and where this meeting sits, with previous and next named by their dates', () => {
    const { el } = create();
    expect(q(el, 'meeting-series-line')!.textContent!.trim()).toBe('Every month, the 4th Thursday · 4 of 12');
    const previous = q(el, 'meeting-series-previous')!;
    const next = q(el, 'meeting-series-next')!;
    expect(previous.getAttribute('href')).toBe('/meetings/m-prev');
    expect(next.getAttribute('href')).toBe('/meetings/m-next');
    expect(previous.textContent!.replace(/\s+/g, ' ').trim()).toBe('‹ 25 Feb 2027');
    expect(next.textContent!.replace(/\s+/g, ' ').trim()).toBe('22 Apr 2027 ›');
    // The accessible name says which way, and keeps the visible date (WCAG 2.5.3).
    expect(previous.getAttribute('aria-label')).toBe('Previous meeting, 25 Feb 2027');
    expect(next.getAttribute('aria-label')).toBe('Next meeting, 22 Apr 2027');
    // In order: previous, the whole series, next.
    const links = Array.from(q(el, 'meeting-series')!.querySelectorAll('a')).map((a) => a.getAttribute('data-testid'));
    expect(links).toEqual(['meeting-series-previous', 'meeting-series-whole', 'meeting-series-next']);
  });

  it('in Arabic: the line, and the SAME arrow characters as English, which the browser mirrors in RTL (P240)', () => {
    // U+2039 and U+203A are Bidi_Mirrored: at dir=rtl the browser draws each
    // one flipped, so a hand-swapped Arabic glyph would point "previous" the
    // wrong way. The translations must carry the same characters.
    expect(ar.meeting.series.previousGlyph).toBe(en.meeting.series.previousGlyph);
    expect(ar.meeting.series.nextGlyph).toBe(en.meeting.series.nextGlyph);
    expect(en.meeting.series.previousGlyph).toBe('\u2039');
    expect(en.meeting.series.nextGlyph).toBe('\u203A');
    const { el } = create('ar');
    expect(q(el, 'meeting-series-line')!.textContent!.trim()).toBe('كل شهر، الخميس الرابع · 4 من 12');
    // The line is isolated, so an English committee name never reorders it.
    expect(q(el, 'meeting-series-line')!.tagName).toBe('BDI');
    expect(q(el, 'meeting-series-previous')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('\u2039 25 فبراير 2027');
    expect(q(el, 'meeting-series-next')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('22 أبريل 2027 \u203A');
  });

  it('shows previous and next only where the server names them, never working one out', () => {
    // The 4th of 12, with meetings either side, that this viewer may not open (or that are cancelled): the server names none.
    meeting = aMeeting({ series: aSeries({ index: 4, previousId: null, previousAt: null, nextId: null, nextAt: null }) });
    const { el } = create();
    // So no link either way, though the series has meetings before and after this one.
    expect(q(el, 'meeting-series-previous')).toBeNull();
    expect(q(el, 'meeting-series-next')).toBeNull();
    expect(q(el, 'meeting-series-whole')).not.toBeNull();
  });

  it('Whole series opens the list for this series, carrying the series and its owner', async () => {
    const { el, fixture } = create();
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    const whole = q(el, 'meeting-series-whole')!;
    expect(whole.getAttribute('href')).toBe('/meetings?seriesId=series-1');
    whole.click();
    fixture.detectChanges();
    const [url, extras] = navigate.calls.mostRecent().args;
    expect(url.toString()).toBe('/meetings?seriesId=series-1');
    expect(extras?.state).toEqual({ series: meeting.series, ownerName: 'Pharmacy and Therapeutics Committee' });
  });

  it('after End series: "Every month · ended after 4 of 12", with the whole series still a link (Q11)', () => {
    meeting = aMeeting({ series: aSeries({ index: 2, ended: true, endedAfter: 4, nextId: null, nextAt: null }) });
    const { el } = create();
    expect(q(el, 'meeting-series-line')!.textContent!.trim()).toBe('Every month · ended after 4 of 12');
    expect(q(el, 'meeting-series-whole')).not.toBeNull();
  });

  it('a meeting outside a series has no series cell', () => {
    meeting = aMeeting();
    const { el } = create();
    expect(q(el, 'meeting-series')).toBeNull();
    // Non-vacuity: the page itself is drawn.
    expect(q(el, 'meeting-page')).not.toBeNull();
  });

  it('/meetings/:id builds a new page when only the id changes (a series link), and reads that meeting', () => {
    configure();
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingPageHostComponent);
    fixture.detectChanges();
    const first = fixture.debugElement.query((d) => d.componentInstance instanceof MeetingPageComponent).componentInstance as MeetingPageComponent;
    expect(first.id).toBe('m-1');
    expect(get).toHaveBeenCalledWith('m-1');

    // The router updates the snapshot, then emits the new params (advanceActivatedRoute).
    route.snapshot = { paramMap: convertToParamMap({ id: 'm-next' }) };
    paramMap.next(convertToParamMap({ id: 'm-next' }));
    fixture.detectChanges();
    const second = fixture.debugElement.query((d) => d.componentInstance instanceof MeetingPageComponent).componentInstance as MeetingPageComponent;
    expect(second).not.toBe(first);
    expect(second.id).toBe('m-next');
    expect(get).toHaveBeenCalledWith('m-next');
    expect(second.meeting()?.id).toBe('m-next');
  });
});
