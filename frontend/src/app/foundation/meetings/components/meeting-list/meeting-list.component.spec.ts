import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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

  function create(permissions: string[]) {
    list = jasmine.createSpy('list').and.returnValue(of({ items: [], total: 0 }));
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
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    return TestBed.createComponent(MeetingListComponent).componentInstance;
  }

  it('offers All meetings to a meetings:view holder, between Minutes and Sub-units', () => {
    expect(create(['meetings:view']).scopes().map((s) => s.key)).toEqual(['mine', 'past', 'minutes', 'all', 'subunits']);
  });

  it('never offers All meetings without meetings:view', () => {
    expect(create([]).scopes().map((s) => s.key)).toEqual(['mine', 'past', 'minutes', 'subunits']);
  });

  it('labels every view in words', () => {
    const labels = create(['meetings:view']).scopes().map((s) => s.label);
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
});
