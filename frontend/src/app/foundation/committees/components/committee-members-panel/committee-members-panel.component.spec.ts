import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AuthService } from '../../../../core/services/auth.service';
import { CommitteeMemberRowDto, SubCommitteeRowDto } from '../../services/committee.service';
import { CommitteeMembersPanelComponent } from './committee-members-panel.component';
import { CommitteeSubCommitteesPanelComponent } from '../committee-sub-committees-panel/committee-sub-committees-panel.component';
import { SimpleListComponent } from '../../../../shared/components/simple-list/simple-list.component';

// ACC-230 — the Members and Sub-committees panels (Record Tasks Panel §3) and
// the plain list behind their "See all". Heights: committee-panels.layout.spec.

const API = `${environment.apiUrl}/committees/c-1`;

export function memberRow(i: number, over: Partial<CommitteeMemberRowDto> = {}): CommitteeMemberRowDto {
  return {
    id: `m${i}`,
    userId: `u${i}`,
    name: `Member ${i}`,
    roleValueId: 'member',
    roleLabelEn: 'Member',
    roleLabelAr: 'عضو',
    joinedAt: '2026-03-0' + ((i % 9) + 1) + 'T05:00:00.000Z',
    ...over,
  };
}

export function subRow(i: number, over: Partial<SubCommitteeRowDto> = {}): SubCommitteeRowDto {
  return { id: `s${i}`, nameEn: `Sub ${i}`, nameAr: null, stageNameEn: 'Active', stageNameAr: 'نشطة', memberCount: i, ...over };
}

const page = <T>(items: T[], total = items.length, matching = total) => ({ items, total, matching });

@Component({
  standalone: true,
  imports: [CommitteeMembersPanelComponent, CommitteeSubCommitteesPanelComponent],
  template: `
    <app-committee-members-panel
      committeeId="c-1"
      committeeName="Infection Control"
      [canAddMember]="canAdd()"
      [canChangeRole]="canChange()"
      [canRemove]="canRemove()"
      (addRequested)="added = added + 1"
      (changeRoleRequested)="changed = $event"
      (removeRequested)="removed = $event"
    />
    <app-committee-sub-committees-panel committeeId="c-1" committeeName="Infection Control" />
  `,
})
class HostComponent {
  readonly canAdd = signal(true);
  readonly canChange = signal(true);
  readonly canRemove = signal(true);
  added = 0;
  changed: CommitteeMemberRowDto | null = null;
  removed: CommitteeMemberRowDto | null = null;
}

describe('Committee Members and Sub-committees panels (ACC-230)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let permissions: string[];

  function setup(perms: string[] = [], me = 'someone-else'): void {
    permissions = perms;
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: me }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask').forEach((m) => m.remove()));

  const membersReq = (): TestRequest => http.expectOne((r) => r.url === `${API}/members/page` && r.params.get('take') === '5');
  const subsReq = (): TestRequest => http.expectOne((r) => r.url === `${API}/sub-committees` && r.params.get('take') === '5');
  function answer(req: TestRequest, body: object): void {
    req.flush(body);
    fixture.detectChanges();
  }
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const memberRows = () => Array.from(el.querySelectorAll<HTMLElement>('[data-member-row]'));

  describe('Members', () => {
    it('asks the server for the first five by seat; the header counts every member; the footer only above five', () => {
      setup();
      const req = membersReq();
      expect(req.request.params.get('sort')).toBe('seat');
      expect(req.request.params.get('dir')).toBe('asc');
      answer(req, page([memberRow(1, { roleLabelEn: 'Chairman' }), memberRow(2), memberRow(3), memberRow(4), memberRow(5)], 9));
      answer(subsReq(), page([]));
      expect(q('committee-members-count')!.textContent!.trim()).toBe('9');
      expect(memberRows().length).toBe(5);
      expect(q('committee-members-foot')!.textContent).toContain('Showing 5 of 9');
      expect(memberRows()[0]!.textContent).toContain('Chairman · Since');
    });

    it('five or fewer: no footer; none: says so, Add member still in the header', () => {
      setup();
      answer(membersReq(), page([]));
      answer(subsReq(), page([]));
      expect(q('committee-members-foot')).toBeNull();
      expect(q('committee-members-empty')!.textContent).toContain('No members yet');
      q('committee-members-add')!.click();
      expect(fixture.componentInstance.added).toBe(1);
    });

    it('Add member is ABSENT, not disabled, without committees:add_member', () => {
      setup();
      fixture.componentInstance.canAdd.set(false);
      answer(membersReq(), page([]));
      answer(subsReq(), page([]));
      expect(q('committee-members-add')).toBeNull();
    });

    it('Change role and Remove are a worded ⋯ menu, named for the member, each item only with its permission', () => {
      setup();
      fixture.componentInstance.canRemove.set(false);
      answer(membersReq(), page([memberRow(1, { name: 'Dr. Sara Al-Qahtani' })]));
      answer(subsReq(), page([]));
      const trigger = memberRows()[0]!.querySelector<HTMLButtonElement>('[data-testid="row-menu-trigger"]')!;
      expect(trigger.getAttribute('aria-label')).toBe('Actions for Dr. Sara Al-Qahtani');
      trigger.click();
      fixture.detectChanges();
      const items = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="row-menu"] [data-action]'));
      expect(items.map((i) => i.getAttribute('data-action'))).toEqual(['changeRole']);
      items[0]!.click();
      expect(fixture.componentInstance.changed?.id).toBe('m1');
    });

    it('with neither permission there is no ⋯ at all', () => {
      setup();
      fixture.componentInstance.canChange.set(false);
      fixture.componentInstance.canRemove.set(false);
      answer(membersReq(), page([memberRow(1)]));
      answer(subsReq(), page([]));
      expect(memberRows()[0]!.querySelector('[data-testid="row-menu-trigger"]')).toBeNull();
    });

    it('the name links to the user record only where the viewer may open it', () => {
      setup(['admin:access', 'users:view']);
      answer(membersReq(), page([memberRow(1)]));
      answer(subsReq(), page([]));
      expect(memberRows()[0]!.querySelector('a')!.getAttribute('href')).toBe('/users/u1');
      TestBed.resetTestingModule();
      setup([], 'u2');
      answer(membersReq(), page([memberRow(1), memberRow(2)]));
      answer(subsReq(), page([]));
      expect(memberRows()[0]!.querySelector('a')).withContext('someone else, without users:view').toBeNull();
      expect(memberRows()[1]!.querySelector('a')!.getAttribute('href')).withContext('their own record').toBe('/users/u2');
    });

    it('error: in the body only, with Retry', () => {
      setup();
      membersReq().flush('x', { status: 500, statusText: 'Server Error' });
      answer(subsReq(), page([]));
      expect(q('committee-members-error')).not.toBeNull();
      q('committee-members-error')!.querySelector('button')!.click();
      answer(membersReq(), page([memberRow(1)]));
      expect(memberRows().length).toBe(1);
    });

    describe('See all', () => {
      function openPopup(): TestRequest {
        answer(membersReq(), page([1, 2, 3, 4, 5].map((i) => memberRow(i)), 60));
        answer(subsReq(), page([]));
        q('committee-members-see-all')!.click();
        fixture.detectChanges();
        desktop();
        return http.expectOne((r) => r.url === `${API}/members/page` && r.params.get('take') === '50');
      }

      it('opens the compact list on its defaults (seat, first 50), titled with the committee', () => {
        setup();
        const req = openPopup();
        expect(req.request.params.get('sort')).toBe('seat');
        expect(req.request.params.get('skip')).toBe('0');
        expect(req.request.params.has('q')).toBeFalse();
        answer(req, page(Array.from({ length: 50 }, (_, i) => memberRow(i + 1)), 60));
        expect(document.querySelector('[data-testid="list-dialog"] h2')!.textContent).toContain('All members · Infection Control');
        expect(document.querySelectorAll('[data-testid="simple-list-row"]').length).toBe(50);
        expect(document.querySelector('[data-testid="simple-list-live"]')!.textContent).toContain('60 members');
      });

      it('Load more adds the next 50', () => {
        setup();
        answer(openPopup(), page(Array.from({ length: 50 }, (_, i) => memberRow(i + 1)), 60));
        document.querySelector<HTMLButtonElement>('[data-testid="simple-list-more"]')!.click();
        fixture.detectChanges();
        const more = http.expectOne((r) => r.url === `${API}/members/page` && r.params.get('skip') === '50');
        answer(more, page(Array.from({ length: 10 }, (_, i) => memberRow(i + 51)), 60));
        expect(document.querySelectorAll('[data-testid="simple-list-row"]').length).toBe(60);
      });

      it('search and sort go to the server; no match says so', fakeAsync(() => {
        setup();
        answer(openPopup(), page([memberRow(1)], 60));
        const input = document.querySelector<HTMLInputElement>('[data-testid="simple-list-search"]')!;
        input.value = 'ventilator';
        input.dispatchEvent(new Event('input'));
        tick(300);
        fixture.detectChanges();
        const searched = http.expectOne((r) => r.url === `${API}/members/page` && r.params.get('q') === 'ventilator');
        answer(searched, page([], 60, 0));
        expect(document.querySelector('[data-testid="simple-list-empty"]')!.textContent).toContain('Nothing matches “ventilator”');
        expect(document.querySelector('[data-testid="simple-list-live"]')!.textContent).toContain('0 members match');
      }));

      // ACC-234 — the popup sorts by its column headers, never a toolbar dropdown.
      it('the toolbar has no Sort control; Member, Seat and Since are headers, the actions column is plain', () => {
        setup();
        answer(openPopup(), page([memberRow(1)], 60));
        expect(document.querySelector('[data-testid="simple-list-sort"], [data-testid="simple-list-sort-menu"]')).toBeNull();
        const cells = Array.from(document.querySelector('[data-testid="simple-list-head"]')!.children) as HTMLElement[];
        expect(cells.map((c) => c.getAttribute('role'))).toEqual(['columnheader', 'columnheader', 'columnheader', 'columnheader']);
        expect(cells.map((c) => c.getAttribute('data-sort-key'))).toEqual(['name', 'seat', 'since', null]);
        expect(cells.map((c) => c.querySelector('button')?.getAttribute('aria-label') ?? null)).toEqual(['Sort by Member', 'Sort by Seat', 'Sort by Since', null]);
        // The default (by seat) carries the arrow.
        expect(sortHeader('seat').getAttribute('aria-sort')).toBe('ascending');
        expect(sortHeader('seat').textContent).toContain('▲');
      });

      it('a phone (cards, no headers) keeps a compact sort menu with the headers\' sorts, both ways', () => {
        setup();
        answer(openPopup(), page([memberRow(1)], 60));
        const simple = fixture.debugElement.query((d) => d.componentInstance instanceof SimpleListComponent)!
          .componentInstance as SimpleListComponent<{ id: string }>;
        simple.phone.set(true);
        fixture.detectChanges();
        expect(document.querySelector('[data-testid="simple-list-head"]')).toBeNull();
        expect(document.querySelector('[data-testid="simple-list-sort-menu"]')).not.toBeNull();
        expect(simple.phoneSortOptions().map((o) => o.label)).toEqual([
          'Member, ascending',
          'Member, descending',
          'Seat, ascending',
          'Seat, descending',
          'Since, ascending',
          'Since, descending',
        ]);
        simple.onPhoneSort('since:desc');
        fixture.detectChanges();
        const req = http.expectOne((r) => r.url === `${API}/members/page` && r.params.get('sort') === 'since' && r.params.get('dir') === 'desc');
        answer(req, page([memberRow(1)], 60));
      });

      for (const key of ['name', 'seat', 'since']) {
        it(`${key}: each press is a server request from the first page, keeping the search; aria-sort follows`, fakeAsync(() => {
          setup();
          answer(openPopup(), page(Array.from({ length: 50 }, (_, i) => memberRow(i + 1)), 60));
          const input = document.querySelector<HTMLInputElement>('[data-testid="simple-list-search"]')!;
          input.value = 'al';
          input.dispatchEvent(new Event('input'));
          tick(300);
          fixture.detectChanges();
          answer(http.expectOne((r) => r.url === `${API}/members/page` && r.params.get('q') === 'al'), page([memberRow(1)], 60, 1));
          // Seat is already ascending, so its first press turns it round.
          for (const dir of key === 'seat' ? ['desc', 'asc'] : ['asc', 'desc']) {
            sortHeader(key).querySelector('button')!.click();
            fixture.detectChanges();
            const req = http.expectOne((r) => r.url === `${API}/members/page` && r.params.get('sort') === key && r.params.get('dir') === dir);
            expect(req.request.params.get('skip')).toBe('0');
            expect(req.request.params.get('q')).toBe('al');
            const order = dir === 'asc' ? [7, 8, 9] : [9, 8, 7];
            answer(req, page(order.map((i) => memberRow(i)), 60, 3));
            expect(Array.from(document.querySelectorAll('[data-testid="simple-list-row"]')).map((r) => r.textContent!.match(/Member \d/)![0])).toEqual(order.map((i) => `Member ${i}`));
            expect(sortHeader(key).getAttribute('aria-sort')).toBe(dir === 'asc' ? 'ascending' : 'descending');
            expect(document.querySelectorAll('[data-testid="simple-list-head"] [aria-sort]').length).toBe(1);
          }
        }));
      }
    });
  });

  /** The popup's list in its desktop layout: Karma's window is narrower than the phone breakpoint. */
  function desktop(): void {
    (fixture.debugElement.query((d) => d.componentInstance instanceof SimpleListComponent)!.componentInstance as SimpleListComponent<{ id: string }>).phone.set(false);
    fixture.detectChanges();
  }
  const sortHeader = (key: string) => document.querySelector<HTMLElement>(`[data-testid="simple-list-head"] am-sort-header[data-sort-key="${key}"]`)!;

  describe('Sub-committees', () => {
    it('says what each child is: its live stage and its member count; links it', () => {
      setup();
      answer(membersReq(), page([]));
      const req = subsReq();
      expect(req.request.params.get('sort')).toBe('name');
      answer(req, page([subRow(3), subRow(1, { stageNameEn: null, stageNameAr: null })]));
      const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-sub-row]'));
      expect(rows[0]!.textContent).toContain('Active · 3 members');
      expect(rows[1]!.textContent).toContain('1 member');
      expect(rows[1]!.textContent).not.toContain('·');
      expect(rows[0]!.querySelector('a')!.getAttribute('href')).toBe('/committees/s3');
    });

    it('has no header action, and See all opens its own list', () => {
      setup();
      answer(membersReq(), page([]));
      answer(subsReq(), page([1, 2, 3, 4, 5].map((i) => subRow(i)), 7));
      expect(q('committee-subs-panel')!.querySelector('header button')).toBeNull();
      q('committee-subs-see-all')!.click();
      fixture.detectChanges();
      const req = http.expectOne((r) => r.url === `${API}/sub-committees` && r.params.get('take') === '50');
      expect(req.request.params.get('sort')).toBe('name');
      answer(req, page(Array.from({ length: 7 }, (_, i) => subRow(i + 1))));
      expect(document.querySelector('[data-testid="list-dialog"] h2')!.textContent).toContain('All sub-committees · Infection Control');
    });

    // ACC-234 — Name, Status and Members are headers you press.
    for (const key of ['name', 'status', 'members']) {
      it(`See all, ${key}: ascending then descending, each a server request; aria-sort follows; no Sort control`, () => {
        setup();
        answer(membersReq(), page([]));
        answer(subsReq(), page([1, 2, 3, 4, 5].map((i) => subRow(i)), 7));
        q('committee-subs-see-all')!.click();
        fixture.detectChanges();
        desktop();
        answer(http.expectOne((r) => r.url === `${API}/sub-committees` && r.params.get('take') === '50'), page(Array.from({ length: 7 }, (_, i) => subRow(i + 1))));
        expect(document.querySelector('[data-testid="simple-list-sort"], [data-testid="simple-list-sort-menu"]')).toBeNull();
        expect(Array.from(document.querySelectorAll('[data-testid="simple-list-head"] am-sort-header')).map((h) => h.getAttribute('data-sort-key'))).toEqual(['name', 'status', 'members']);
        for (const dir of key === 'name' ? ['desc', 'asc'] : ['asc', 'desc']) {
          sortHeader(key).querySelector('button')!.click();
          fixture.detectChanges();
          const req = http.expectOne((r) => r.url === `${API}/sub-committees` && r.params.get('sort') === key && r.params.get('dir') === dir);
          expect(req.request.params.get('skip')).toBe('0');
          const order = dir === 'asc' ? [1, 2, 3] : [3, 2, 1];
          answer(req, page(order.map((i) => subRow(i)), 7));
          expect(Array.from(document.querySelectorAll('[data-testid="simple-list-row"]')).map((r) => r.textContent!.match(/Sub \d/)![0])).toEqual(order.map((i) => `Sub ${i}`));
          expect(sortHeader(key).getAttribute('aria-sort')).toBe(dir === 'asc' ? 'ascending' : 'descending');
          expect(sortHeader(key).textContent).toContain(dir === 'asc' ? '▲' : '▼');
        }
      });
    }
  });
});
