import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { environment } from '../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { ITaskRecordRowDto } from '../services/task.service';
import { RecordTasksPanelComponent } from './record-tasks-panel/record-tasks-panel.component';
import { TaskListViewComponent } from './task-list-view/task-list-view.component';
import { listPage, recordRow } from './record-tasks-panel/record-tasks.fixtures';

// CC-338 — LINE 2, as every task row reads it: the record panel, a person's panel,
// and the phone cards of the record list and /tasks/all.
//   1. A held task's due label already starts with the hold part ("⏸ On hold to …"),
//      so its status word is left out (TaskRowText.lineStatus(), the one rule);
//      every other status still shows.
//   2. Every "·" has a space on both sides, none doubled, none at a line's start or
//      end ("…2026· name" was the record list's and /tasks/all's phone card).
// Both languages.

const API = `${environment.apiUrl}/tasks`;
const HOLD = { en: 'On hold to', ar: 'معلّقة حتى' } as const;
const ON_HOLD = { en: 'On hold', ar: 'متوقفة مؤقتًا' } as const;
const ASSIGNED = { en: 'Assigned', ar: 'مُسندة' } as const;
const IN_PROGRESS = { en: 'In progress', ar: 'قيد التنفيذ' } as const;

function rowsUnderTest(): ITaskRecordRowDto[] {
  return [
    recordRow('held', { status: 'ON_HOLD', onHoldUntil: '2099-11-22T05:00:00.000Z', dueAt: '2099-11-26T05:00:00.000Z' }),
    recordRow('pending', { status: 'PENDING' }),
    recordRow('working', { status: 'IN_PROGRESS' }),
  ];
}

@Component({
  standalone: true,
  imports: [RecordTasksPanelComponent],
  template: `@if (person()) {
      <app-record-tasks-panel person="u-huda" recordName="Huda Al-Qahtani" />
    } @else {
      <app-record-tasks-panel sourceType="COMMITTEE" sourceId="c-1" recordName="Infection Control" />
    }`,
})
class PanelHost {
  readonly person = input(false);
}

@Component({
  standalone: true,
  imports: [TaskListViewComponent],
  template: `@if (all()) {
      <app-task-list-view view="all" variant="page" />
    } @else {
      <app-task-list-view sourceType="COMMITTEE" sourceId="c-1" />
    }`,
})
class ListHost {
  readonly all = input(false);
}

/** The text of a line, with no-break spaces as spaces and runs of space collapsed. */
const textOf = (el: Element) => el.textContent!.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function expectSeparators(line: string): void {
  expect(line).withContext(`"${line}" starts or ends with a separator`).not.toMatch(/^·|·$/);
  expect(line).withContext(`"${line}" has a separator without a space on each side`).not.toMatch(/\S·|·\S/);
  expect(line).withContext(`"${line}" doubles a separator`).not.toMatch(/·\s*·/);
}

describe('Line 2 of a task row: a held task says "On hold" once, and every "·" is spaced (CC-338)', () => {
  preserveDocumentLanguage();
  let http: HttpTestingController;

  function configure(lang: 'en' | 'ar', imports: unknown[]): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: imports as never[],
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
  }

  for (const lang of ['en', 'ar'] as const) {
    for (const person of [false, true]) {
      it(`${lang} · ${person ? "a person's" : "a record's"} Tasks panel: the held row has the hold part and no status word; the others keep theirs`, () => {
        configure(lang, [PanelHost]);
        const fixture: ComponentFixture<PanelHost> = TestBed.createComponent(PanelHost);
        fixture.componentRef.setInput('person', person);
        fixture.detectChanges();
        http.expectOne((r) => r.url === `${API}/record-panel`).flush({ total: 3, scope: 'all', rows: rowsUnderTest(), canCreate: false });
        fixture.detectChanges();
        const line = (id: string) => textOf((fixture.nativeElement as HTMLElement).querySelector(`[data-task-row="${id}"] .am-cp-l2`)!);
        const held = line('held');
        expect(held).toContain(HOLD[lang]); // non-vacuity: the hold part leads the line
        expect(held).not.toContain(` · ${ON_HOLD[lang]}`);
        expect(held.split(ON_HOLD[lang]).length - 1).withContext('the status word once at most (none, here)').toBeLessThanOrEqual(lang === 'en' ? 1 : 0);
        expect(line('pending')).toContain(ASSIGNED[lang]);
        expect(line('working')).toContain(IN_PROGRESS[lang]);
        for (const id of ['held', 'pending', 'working']) expectSeparators(line(id));
      });
    }

    for (const all of [false, true]) {
      it(`${lang} · ${all ? '/tasks/all' : "a record's list"}: a phone card keeps " · " spaced, and a held card says "On hold" once`, () => {
        configure(lang, [ListHost]);
        const fixture: ComponentFixture<ListHost> = TestBed.createComponent(ListHost);
        fixture.componentRef.setInput('all', all);
        fixture.detectChanges();
        http.expectOne((r) => r.url === `${API}/record-list`).flush(listPage(rowsUnderTest()));
        fixture.detectChanges();
        const view = fixture.debugElement.query((d) => d.componentInstance instanceof TaskListViewComponent)!.componentInstance as TaskListViewComponent;
        view.phone.set(true);
        fixture.detectChanges();
        const card = (id: string) => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-task-row="${id}"]`)!;
        expect(card('pending').classList).toContain('am-tl__item--card'); // non-vacuity: a phone card
        const lines = (id: string) => Array.from(card(id).querySelectorAll('.am-tl__sub')).map(textOf);
        // The assignee is named on these lists' cards, after a spaced separator.
        expect(lines('pending').join(' | ')).toContain(`· Dr. Sara Al-Qahtani · ${ASSIGNED[lang]}`);
        expect(lines('working').join(' | ')).toContain(IN_PROGRESS[lang]);
        const held = lines('held').join(' | ');
        expect(held).toContain(HOLD[lang]);
        expect(held).not.toContain(` · ${ON_HOLD[lang]}`);
        for (const id of ['held', 'pending', 'working']) for (const l of lines(id)) expectSeparators(l);
      });
    }
  }
});
