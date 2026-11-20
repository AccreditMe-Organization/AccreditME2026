import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { firstValueFrom, of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { aMeeting, aSeries } from '../../meeting-fixtures.testing';
import { MeetingService } from '../../services/meeting.service';
import { MeetingListComponent } from './meeting-list.component';

// ACC-316 PR 8b — the whole series (/meetings?seriesId=, from a meeting's
// "Whole series"): the series' Upcoming and Past from the server, headed by its
// owner and pattern, carried by the link or else read from its first meeting,
// and a cancelled meeting reads Cancelled (A9).
describe('MeetingListComponent — the whole series (ACC-316 PR 8b)', () => {
  const cancelled = { id: 'm-3', title: 'P&T · June 2027', scheduledAt: '2027-06-24T10:30:00Z', durationMinutes: 90, location: null, meetingUrl: null, stage: { id: 's-c', nameEn: 'Cancelled', nameAr: 'ملغى', flags: ['MEETING_CANCELLED'] }, owner: { kind: 'COMMITTEE', id: 'c-1', nameEn: 'Pharmacy and Therapeutics Committee', nameAr: 'لجنة الصيدلة والعلاجات' } };
  let list: jasmine.Spy;
  let get: jasmine.Spy;

  function create(state: unknown, items: unknown[] = [cancelled]) {
    history.replaceState(state, '');
    list = jasmine.createSpy('list').and.returnValue(of({ items, total: items.length, canSeeAll: false }));
    get = jasmine.createSpy('get').and.returnValue(of(aMeeting({ id: 'm-3', series: aSeries() })));
    const query = { seriesId: 'series-1' };
    TestBed.configureTestingModule({
      imports: [MeetingListComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        { provide: MeetingService, useValue: { list, get } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => false, isModuleEnabled: () => true } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(query)), snapshot: { queryParams: query, queryParamMap: convertToParamMap(query) } } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingListComponent);
    return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => history.replaceState(null, ''));

  const firstPage = (c: MeetingListComponent, scope?: string) => firstValueFrom(c.source({ page: 1, pageSize: 25, scope } as Parameters<typeof c.source>[0]));
  const text = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? null;

  it("asks the server for the series' meetings, Upcoming then Past, and nothing else", async () => {
    const { c } = create({ series: aSeries(), ownerName: 'Pharmacy and Therapeutics Committee' });
    expect(c.scopes().map((s) => s.key)).toEqual(['upcoming', 'past']);
    await firstPage(c);
    expect(list).toHaveBeenCalledWith({ view: 'upcoming', q: undefined, seriesId: 'series-1', skip: 0, take: 25 });
    await firstPage(c, 'past');
    expect(list).toHaveBeenCalledWith({ view: 'past', q: undefined, seriesId: 'series-1', skip: 0, take: 25 });
  });

  it('heads the list with the owner and pattern the link carried, and reads no meeting for them', async () => {
    const { c, el, fixture } = create({ series: aSeries(), ownerName: 'Pharmacy and Therapeutics Committee' });
    await firstPage(c);
    fixture.detectChanges();
    expect(text(el, 'meeting-list-series-title')).toBe('Whole series · Pharmacy and Therapeutics Committee');
    expect(text(el, 'meeting-list-series-line')).toBe('Every month, the 4th Thursday');
    expect(get).not.toHaveBeenCalled();
  });

  it('opened from a shared link (no state): names the owner from the first row and reads the pattern from that meeting, once', async () => {
    const { c, el, fixture } = create(null);
    await firstPage(c);
    await firstPage(c, 'past');
    fixture.detectChanges();
    expect(get).toHaveBeenCalledOnceWith('m-3');
    expect(text(el, 'meeting-list-series-title')).toBe('Whole series · Pharmacy and Therapeutics Committee');
    expect(text(el, 'meeting-list-series-line')).toBe('Every month, the 4th Thursday');
  });

  it("another series' state is not this series'", async () => {
    const { c, el, fixture } = create({ series: aSeries({ id: 'series-other', every: 'WEEK_1' }), ownerName: 'Someone else' });
    await firstPage(c);
    fixture.detectChanges();
    expect(text(el, 'meeting-list-series-title')).toBe('Whole series · Pharmacy and Therapeutics Committee');
    expect(text(el, 'meeting-list-series-line')).toBe('Every month, the 4th Thursday');
  });

  it('an ended series: where it stopped (Q11)', async () => {
    const { c, el, fixture } = create({ series: aSeries({ ended: true, endedAfter: 4 }), ownerName: 'Pharmacy and Therapeutics Committee' });
    await firstPage(c);
    fixture.detectChanges();
    expect(text(el, 'meeting-list-series-line')).toBe('Every month · ended after 4 of 12');
  });

  it('a cancelled meeting of the series reads Cancelled, struck through (A9)', async () => {
    const { el, fixture } = create({ series: aSeries(), ownerName: 'Pharmacy and Therapeutics Committee' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const row = el.querySelector('[data-meeting-row="m-3"]')!;
    expect(row).withContext('the row is drawn').not.toBeNull();
    expect(row.querySelector('[data-meeting-stage]')!.textContent!.trim()).toBe('Cancelled');
    expect(row.querySelector('.line-through')!.textContent!.trim()).toBe('P&T · June 2027');
  });
});
