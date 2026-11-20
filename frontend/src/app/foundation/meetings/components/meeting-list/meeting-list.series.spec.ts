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
// "Whole series"): ONE list by date from the server (view=series, P240), headed
// by its owner and pattern, carried by the link or else read from its first
// meeting; a cancelled meeting reads Cancelled (A9), and a moved one says where
// it came from.
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

  it("asks the server for the whole series in one answer (view=series), with no views to switch between", async () => {
    const { c, el, fixture } = create({ series: aSeries(), ownerName: 'Pharmacy and Therapeutics Committee' });
    expect(c.scopes()).toEqual([]);
    const page = await firstPage(c);
    expect(list).toHaveBeenCalledOnceWith({ view: 'series', seriesId: 'series-1', q: undefined });
    expect(page).toEqual(jasmine.objectContaining({ data: [cancelled], total: 1, page: 1 }));
    fixture.detectChanges();
    expect(text(el, 'meeting-list-order')).toBe('Sorted by date, earliest first.');
  });

  it('a moved meeting says where it was moved from; one never moved says nothing', async () => {
    const moved = { ...cancelled, id: 'm-2', title: 'P&T · May 2027', stage: { id: 's-p', nameEn: 'Planned', nameAr: 'مجدول', flags: [] }, movedFrom: '2027-05-20T10:30:00Z' };
    const { el, fixture } = create({ series: aSeries(), ownerName: 'Pharmacy and Therapeutics Committee' }, [moved, { ...cancelled, movedFrom: null }]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const note = (id: string) => el.querySelector(`[data-meeting-row="${id}"] [data-meeting-moved-from]`)?.textContent?.trim() ?? null;
    expect(note('m-2')).toBe('Rescheduled from 20 May 2027');
    expect(note('m-3')).toBeNull();
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
    await firstPage(c);
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
