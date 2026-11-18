import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { TaskListViewComponent } from './task-list-view.component';
import { NO_ACTIONS, listPage, recordRow } from '../record-tasks-panel/record-tasks.fixtures';

// ACC-216 (CC-329, CC-331) — the list in a PERSON's scope (their record page's See
// all): every row is the person's own task and the dialog's title names them, so
// it has no "Assigned to me", no "Assignee or pool" filter, no assignee column and
// no name on a phone card. The record list and /tasks/all keep theirs (their own
// specs, unchanged). Also here: a row's failure said by kind, never the server's.

const API = `${environment.apiUrl}/tasks`;
const LIST = `${API}/record-list`;

@Component({
  standalone: true,
  imports: [TaskListViewComponent],
  template: `<app-task-list-view person="u-huda" />`,
})
class HostComponent {}

describe('TaskListViewComponent — a person\'s tasks (ACC-216)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  function setup(lang: 'en' | 'ar' = 'en'): void {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  }

  const next = (): TestRequest => http.expectOne((r) => r.url === LIST);
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const rowEls = () => Array.from(el.querySelectorAll<HTMLElement>('[data-task-row]'));
  const view = () => fixture.debugElement.children[0]!.componentInstance as TaskListViewComponent;
  function answer(req: TestRequest, body: object): void {
    req.flush(body);
    fixture.detectChanges();
  }

  it('asks for the person, with no record, no view, no assignee and no "mine"', () => {
    setup();
    const req = next();
    expect(req.request.params.get('person')).toBe('u-huda');
    for (const absent of ['sourceType', 'sourceId', 'view', 'assignee', 'pool', 'mine']) {
      expect(req.request.params.has(absent)).withContext(absent).toBeFalse();
    }
    answer(req, listPage([recordRow('t1')]));
  });

  it('no "Assigned to me" and no "Assignee or pool" filter; the search placeholder is the task-only wording', () => {
    setup();
    answer(next(), listPage([recordRow('t1')]));
    // Non-vacuity: the toolbar rendered, with the filters a person's list keeps.
    expect(q('task-list-toolbar')).not.toBeNull();
    expect(q('filter-status')).not.toBeNull();
    expect(q('filter-due')).not.toBeNull();
    expect(q('filter-mine')).toBeNull();
    expect(q('filter-who')).toBeNull();
    expect(q('task-list-search')!.getAttribute('placeholder')).toBe('Search task…');
  });

  it('no assignee column: the header names six columns, and a row draws six cells', () => {
    setup();
    answer(next(), listPage([recordRow('t1')]));
    view().phone.set(false); // the desktop columns, whatever the test window's width
    fixture.detectChanges();
    const head = q('task-list-head')!;
    expect(head.textContent).not.toContain('Assignee or pool');
    expect(head.children.length).toBe(6);
    expect(rowEls()[0]!.children.length).toBe(6);
    expect(rowEls()[0]!.textContent).not.toContain('Dr. Sara Al-Qahtani');
  });

  // CC-331 item 5 — every separator on a phone card is " · ": a space on both
  // sides, none doubled, none at the start or the end of a line.
  for (const lang of ['en', 'ar'] as const) {
    it(`${lang}: a phone card has no name, and every separator is " · "`, () => {
      setup(lang);
      answer(next(), listPage([recordRow('t1', { record: { type: 'COMMITTEE', id: 'c-1', nameEn: 'Infection Control', nameAr: 'مكافحة العدوى' } })]));
      view().phone.set(true);
      fixture.detectChanges();
      const card = rowEls()[0]!;
      expect(card.classList).toContain('am-tl__item--card'); // non-vacuity: a phone card
      expect(card.textContent).not.toContain('Dr. Sara Al-Qahtani');
      // A card's due line is parts, each after a CSS "·" (CC-339): read as joined by " · ".
      const flat = (e: Element) => e.textContent!.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      const lines = Array.from(card.querySelectorAll<HTMLElement>('.am-tl__sub')).map((l) => {
        const parts = l.querySelectorAll('.am-tl__part');
        return parts.length ? Array.from(parts).map(flat).join(' · ') : flat(l);
      });
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.some((l) => l.includes('·'))).withContext('non-vacuity: a line with a separator').toBeTrue();
      for (const line of lines) {
        expect(line).withContext(`"${line}" starts or ends with a separator`).not.toMatch(/^·|·$/);
        expect(line).withContext(`"${line}" has a separator without a space on each side`).not.toMatch(/\S·|·\S/);
        expect(line).withContext(`"${line}" doubles a separator`).not.toMatch(/·\s*·/);
      }
      const status = lang === 'en' ? 'Assigned' : 'مُسندة';
      expect(lines.join(' | ')).toContain(`· ${status}`);
    });
  }

  it('a row\'s failure in the full list: a 409 is "This task has changed." with no Try again; a 500 is "Couldn\'t do that." with Try again', () => {
    setup();
    answer(
      next(),
      listPage([recordRow('t1', { actions: { ...NO_ACTIONS, start: true, primary: 'START' } }), recordRow('t2', { actions: { ...NO_ACTIONS, start: true, primary: 'START' } })]),
    );
    rowEls()[0]!.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    http.expectOne(`${API}/t1/start`).flush({ message: 'This task has moved on.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    for (const r of http.match((x) => x.url === LIST)) r.flush(listPage([recordRow('t1')]));
    fixture.detectChanges();
    const changed = rowEls()[0]!.querySelector('[role="alert"]')!;
    expect(changed.textContent!.trim()).toBe('This task has changed.');
    expect(changed.querySelector('button')).toBeNull();

    rowEls()[1]!.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    http.expectOne(`${API}/t2/start`).flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    for (const r of http.match((x) => x.url === LIST)) r.flush(listPage([recordRow('t2', { actions: { ...NO_ACTIONS, start: true, primary: 'START' } })]));
    fixture.detectChanges();
    const failed = rowEls()[1]!.querySelector('[role="alert"]')!;
    expect(failed.textContent).toContain("Couldn't do that.");
    expect(failed.textContent).not.toContain('boom');
    failed.querySelector<HTMLButtonElement>('button')!.click();
    http.expectOne(`${API}/t2/start`).flush({});
  });
});
