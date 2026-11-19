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
import { MeetingService } from '../../services/meeting.service';
import { MeetingListComponent } from './meeting-list.component';

// ACC-316 PR 6 — /meetings offers the views the server answers, and "All
// meetings" only to a meetings:view holder (the server refuses it otherwise);
// the list is paged and searched on the server.
describe('MeetingListComponent (ACC-316 PR 6)', () => {
  let list: jasmine.Spy;

  function create(permissions: string[], canSeeAll = false, query: Record<string, string> = {}, items: unknown[] = []) {
    list = jasmine.createSpy('list').and.returnValue(of({ items, total: items.length, canSeeAll }));
    TestBed.configureTestingModule({
      imports: [MeetingListComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        { provide: MeetingService, useValue: { list } },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p), isModuleEnabled: () => true } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap(query)), snapshot: { queryParams: query, queryParamMap: convertToParamMap(query) } } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    return TestBed.createComponent(MeetingListComponent).componentInstance;
  }

  const firstPage = (c: MeetingListComponent) => firstValueFrom(c.source({ page: 1, pageSize: 25 } as Parameters<typeof c.source>[0]));

  it("offers All meetings, between Minutes and Sub-units, once the server's answer says canSeeAll", async () => {
    const c = create([], true);
    expect(c.scopes().map((s) => s.key)).toEqual(['mine', 'past', 'minutes', 'subunits']);
    await firstPage(c);
    expect(c.scopes().map((s) => s.key)).toEqual(['mine', 'past', 'minutes', 'all', 'subunits']);
  });

  it('never offers All meetings when the server says not, whatever the client holds', async () => {
    const c = create(['meetings:view'], false);
    await firstPage(c);
    expect(c.scopes().map((s) => s.key)).toEqual(['mine', 'past', 'minutes', 'subunits']);
  });

  it('labels every view in words', async () => {
    const c = create([], true);
    await firstPage(c);
    const labels = c.scopes().map((s) => s.label);
    expect(labels).toEqual(["Mine, upcoming first", 'Past', 'Minutes I record', 'All meetings', "Sub-units' meetings"]);
  });

  it('pages and searches on the server: the page becomes skip and take, the search q', async () => {
    const c = create([]);
    const page = await firstValueFrom(c.source({ page: 3, pageSize: 25, scope: 'past', search: 'pharmacy' } as Parameters<typeof c.source>[0]));
    expect(list).toHaveBeenCalledWith({ view: 'past', q: 'pharmacy', skip: 50, take: 25 });
    expect(page).toEqual(jasmine.objectContaining({ data: [], total: 0, page: 3, pageSize: 25 }));
  });

  it('with no view and no search: Mine, and no q', async () => {
    const c = create([]);
    await firstValueFrom(c.source({ page: 1, pageSize: 25 } as Parameters<typeof c.source>[0]));
    expect(list).toHaveBeenCalledWith({ view: 'mine', q: undefined, skip: 0, take: 25 });
  });

  // P189 e — opened from a committee's or unit's Meetings panel (See all).
  describe("one committee's or unit's meetings (?committeeId= / ?orgUnitId=)", () => {
    const row = { id: 'm-1', title: 'Review', scheduledAt: '2027-03-18T10:00:00Z', durationMinutes: 60, location: null, meetingUrl: null, stage: { id: 's', nameEn: 'Planned', nameAr: 'مجدول', flags: [] }, owner: { kind: 'COMMITTEE', id: 'c-1', nameEn: 'Medication Safety Committee', nameAr: 'لجنة سلامة الأدوية' } };

    it("offers that owner's Upcoming and Past, and asks the server for that owner only", async () => {
      const c = create([], true, { committeeId: 'c-1' }, [row]);
      expect(c.scopes().map((s) => s.key)).toEqual(['upcoming', 'past']);
      await firstValueFrom(c.source({ page: 1, pageSize: 25 } as Parameters<typeof c.source>[0]));
      expect(list).toHaveBeenCalledWith({ view: 'upcoming', q: undefined, committeeId: 'c-1', skip: 0, take: 25 });
      // All meetings is never offered while one owner is shown, whatever canSeeAll says.
      expect(c.scopes().map((s) => s.key)).toEqual(['upcoming', 'past']);
    });

    it('names the owner from the first row when the panel passed no name', async () => {
      const c = create([], false, { committeeId: 'c-1' }, [row]);
      expect(c.ownerLabel()).toBe(en.meeting.list.oneOwner);
      await firstValueFrom(c.source({ page: 1, pageSize: 25 } as Parameters<typeof c.source>[0]));
      expect(c.ownerLabel()).toBe('Medication Safety Committee');
    });

    it('a unit filters by orgUnitId; with neither, the usual views', async () => {
      const c = create([], false, { orgUnitId: 'u-1' });
      await firstValueFrom(c.source({ page: 1, pageSize: 25 } as Parameters<typeof c.source>[0]));
      expect(list).toHaveBeenCalledWith(jasmine.objectContaining({ orgUnitId: 'u-1', view: 'upcoming' }));
      TestBed.resetTestingModule();
      expect(create([]).scopes().map((s) => s.key)).toEqual(['mine', 'past', 'minutes', 'subunits']);
    });
  });
});
