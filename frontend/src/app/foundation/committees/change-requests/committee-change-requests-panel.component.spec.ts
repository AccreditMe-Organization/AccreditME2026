import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { FormatService } from '../../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { CommitteePageDto } from '../services/committee.service';
import { CommitteeChangeRequestsPanelComponent } from './committee-change-requests-panel.component';
import { ChangeRequestDto, ChangeRequestListQuery, ChangeRequestService } from './change-request.service';
import { REQUEST, fakePhone } from './change-request.testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';

/** Request n, newest = highest number. */
export function requestRow(n: number, over: Partial<ChangeRequestDto> = {}): ChangeRequestDto {
  return REQUEST({ id: `cr-${n}`, number: n, ...over });
}

// ACC-240 — the committee page's Change requests panel: five rows, newest first
// (the server's number ▼), the total in the header, the frame's empty, error and
// loading states; each row links to its request page and says who and when by
// status. See all: the plain list popup, sorted by header both ways, searched
// by the server, Load more by 50.
describe('CommitteeChangeRequestsPanelComponent (ACC-240)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<CommitteeChangeRequestsPanelComponent>;
  let format: FormatService;
  let calls: ChangeRequestListQuery[];
  let answer: (q: ChangeRequestListQuery) => Observable<CommitteePageDto<ChangeRequestDto>>;

  beforeEach(() => {
    fakePhone(false);
    calls = [];
    answer = () => of({ items: [], total: 0, matching: 0 });
    TestBed.configureTestingModule({
      imports: [CommitteeChangeRequestsPanelComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        {
          provide: ChangeRequestService,
          useValue: {
            list: (_id: string, q: ChangeRequestListQuery) => {
              calls.push(q);
              return answer(q);
            },
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    format = TestBed.inject(FormatService);
  });

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  function render(): HTMLElement {
    fixture = TestBed.createComponent(CommitteeChangeRequestsPanelComponent);
    fixture.componentRef.setInput('committeeId', 'c-1');
    fixture.componentRef.setInput('committeeName', 'Quality Council');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const rows = (el: HTMLElement) => Array.from(el.querySelectorAll('li.am-cp-row'));

  it('asks for five, newest first, and shows the total', () => {
    answer = () => of({ items: [7, 6, 5, 4, 3].map((n) => requestRow(n)), total: 7, matching: 7 });
    const el = render();
    expect(calls[0]).toEqual({ sort: 'number', dir: 'desc', take: 5 });
    expect(rows(el).length).toBe(5);
    expect(text(el.querySelector('[data-testid="committee-crs-head"]'))).toContain('7');
    expect(text(el.querySelector('[data-testid="committee-crs-foot"]'))).toContain('See all');
    expect(text(rows(el)[0].querySelector('a'))).toBe('Change request 7 · Quorum');
    expect(rows(el)[0].querySelector('a')!.getAttribute('href')).toBe('/committees/c-1/change-requests/cr-7');
  });

  it('a row: its status at the end, and who and when by status', () => {
    answer = () =>
      of({
        items: [
          requestRow(5, { status: 'draft', submittedAt: null }),
          requestRow(4),
          requestRow(3, { status: 'approved', decidedAt: '2026-10-20T09:00:00Z' }),
          requestRow(2, { status: 'returned', decidedAt: '2026-10-19T09:00:00Z' }),
          requestRow(1, { status: 'withdrawn', withdrawnAt: '2026-10-16T09:00:00Z', submittedAt: null }),
        ],
        total: 5,
        matching: 5,
      });
    const el = render();
    const line = (i: number) => [text(rows(el)[i].querySelector('.am-ccr__status')), text(rows(el)[i].querySelector('.am-cp-l2'))];
    const d = (iso: string) => format.date(iso);
    expect(line(0)).toEqual(['Draft', `Nora Al-Otaibi · started ${d('2026-10-17T09:00:00Z')}`]);
    expect(line(1)).toEqual(['Under review', `Nora Al-Otaibi · submitted ${d('2026-10-18T09:00:00Z')}`]);
    expect(line(2)).toEqual(['✓ Applied', `Nora Al-Otaibi · ${d('2026-10-18T09:00:00Z')} to ${d('2026-10-20T09:00:00Z')}`]);
    expect(line(3)).toEqual(['Returned for changes', `Nora Al-Otaibi · ${d('2026-10-19T09:00:00Z')}`]);
    expect(line(4)).toEqual(['Withdrawn', `Nora Al-Otaibi · ${d('2026-10-16T09:00:00Z')}`]);
    // No row menu and no action column (step 238, Q17).
    expect(el.querySelector('am-row-menu, button')).toBeNull();
  });

  it('empty: the frame says so, and there is no See all', () => {
    const el = render();
    expect(text(el.querySelector('[data-testid="committee-crs-body"]'))).toContain(en.committee.changeRequest.panel.empty);
    expect(el.querySelector('[data-testid="committee-crs-foot"]')).toBeNull();
  });

  it('error: the sentence and Retry, which reads again', () => {
    let fail = true;
    answer = () => (fail ? throwError(() => ({ status: 500 })) : of({ items: [requestRow(1)], total: 1, matching: 1 }));
    const el = render();
    expect(text(el)).toContain("Couldn't load the change requests.");
    fail = false;
    const retry = el.querySelector('[data-testid="committee-crs-body"] button') as HTMLButtonElement;
    retry.click();
    fixture.detectChanges();
    expect(rows(el).length).toBe(1);
  });

  it('reads again when the page bumps reloadKey', () => {
    render();
    fixture.componentRef.setInput('reloadKey', 1);
    fixture.detectChanges();
    expect(calls.length).toBe(2);
  });

  describe('See all', () => {
    async function openPopup(): Promise<HTMLElement> {
      answer = (q) => {
        const all = Array.from({ length: 60 }, (_, i) => requestRow(60 - i));
        const skip = 'skip' in q ? (q.skip ?? 0) : 0;
        return of({ items: all.slice(skip, skip + (q.take ?? 50)), total: 60, matching: q.q ? 1 : 60 });
      };
      const el = render();
      (el.querySelector('[data-testid="committee-crs-foot"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      for (let i = 0; i < 50 && !document.querySelector('[data-testid="simple-list-row"]'); i++) {
        await new Promise((r) => setTimeout(r, 20));
        fixture.detectChanges();
      }
      return document.querySelector('[data-testid="simple-list"]') as HTMLElement;
    }

    const popupCall = () => calls[calls.length - 1];

    it('opens on Requested ▼, with five columns, three of them sortable', async () => {
      const list = await openPopup();
      expect(list).withContext('the popup list').not.toBeNull();
      expect(popupCall()).toEqual(jasmine.objectContaining({ sort: 'requested', dir: 'desc', take: 50, skip: 0 }));
      const head = list.querySelector('[data-testid="simple-list-head"]')!;
      expect(Array.from(head.querySelectorAll('am-sort-header')).map((h) => text(h).replace(/[▲▼]/g, '').trim())).toEqual([
        'Request',
        'Status',
        'Requested',
      ]);
      expect(head.querySelector('am-sort-header[aria-sort="descending"]')).not.toBeNull();
      expect(document.querySelectorAll('[data-testid="simple-list-row"]').length).toBe(50);
    });

    it('sorts by a header, both ways', async () => {
      const list = await openPopup();
      const header = (label: string) =>
        Array.from(list.querySelectorAll('am-sort-header')).find((h) => text(h).includes(label))!.querySelector('button') as HTMLButtonElement;
      header('Request').click();
      fixture.detectChanges();
      expect(popupCall()).toEqual(jasmine.objectContaining({ sort: 'number', dir: 'asc' }));
      header('Request').click();
      fixture.detectChanges();
      expect(popupCall()).toEqual(jasmine.objectContaining({ sort: 'number', dir: 'desc' }));
      header('Status').click();
      fixture.detectChanges();
      expect(popupCall()).toEqual(jasmine.objectContaining({ sort: 'status', dir: 'asc' }));
    });

    it('searches through the server, and loads more by 50', async () => {
      const list = await openPopup();
      (list.querySelector('[data-testid="simple-list-more"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(popupCall()).toEqual(jasmine.objectContaining({ skip: 50, take: 50 }));
      const box = list.querySelector('[data-testid="simple-list-search"] input, input[data-testid="simple-list-search"]') as HTMLInputElement;
      box.value = 'Nora';
      box.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 300));
      fixture.detectChanges();
      expect(popupCall()).toEqual(jasmine.objectContaining({ q: 'Nora', skip: 0 }));
    });
  });

  it('Arabic', () => {
    TestBed.inject(TranslateService).use('ar');
    answer = () => of({ items: [requestRow(3, { changes: { quorumCount: 6, purpose: 'x' } })], total: 1, matching: 1 });
    const el = render();
    expect(text(rows(el)[0].querySelector('a'))).toBe('طلب التغيير 3 · الغرض والنصاب');
    expect(text(rows(el)[0].querySelector('.am-ccr__status'))).toBe('قيد المراجعة');
  });
});
