import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { environment } from '../../../../environments/environment';
import { AccreditMePreset } from '../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { LanguageService } from '../../../core/services/language.service';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { ITaskRecordRowDto } from '../services/task.service';
import { RecordTasksPanelComponent } from './record-tasks-panel/record-tasks-panel.component';
import { TaskListViewComponent } from './task-list-view/task-list-view.component';
import { NO_ACTIONS, listPage, recordRow } from './record-tasks-panel/record-tasks.fixtures';
import { useLayoutFonts } from '../../../../testing/layout-fonts';

// CC-338 — LINE 2, as every task row reads it: the record panel, a person's panel,
// and the phone cards of the record list and /tasks/all.
//   1. A held task's due label already starts with the hold part ("⏸ On hold to …"),
//      so its status word is left out (TaskRowText.lineStatus(), the one rule);
//      every other status still shows.
//   2. Every "·" has a space on both sides, none doubled, none at a line's start or
//      end ("…2026· name" was the record list's and /tasks/all's phone card).
// Both languages.
//
// CC-339 — and a held phone card NAMES its assignee where the card shows one: the
// card's due line wraps between parts, so the long hold label beside "Resume now"
// no longer squeezes the name to nothing. Measured in the real font and theme.

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

/** A line as read: a phone card's due line is parts, each after a CSS "·" (CC-339). */
function lineText(el: Element): string {
  const parts = el.querySelectorAll('.am-tl__part');
  return parts.length ? Array.from(parts).map(textOf).join(' · ') : textOf(el);
}

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
        const lines = (id: string) => Array.from(card(id).querySelectorAll('.am-tl__sub')).map(lineText);
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

const NAME = 'Dr. Sara Al-Qahtani';

@Component({
  standalone: true,
  imports: [TaskListViewComponent],
  template: `<div class="flex flex-col" [style.width.px]="width()" [style.height.px]="700">
    @if (all()) {
      <app-task-list-view view="all" variant="page" />
    } @else {
      <app-task-list-view sourceType="COMMITTEE" sourceId="c-1" />
    }
  </div>`,
})
class PhoneHost {
  readonly all = input(false);
  readonly width = input(390);
}

/** Where an element can be seen: its own box cut by every clipping ancestor up to the card. */
function visibleBox(el: Element, card: Element): { left: number; right: number; top: number; bottom: number } {
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getBoundingClientRect();
  const box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  for (let a: Element | null = el; a && a !== card.parentElement; a = a.parentElement) {
    if (getComputedStyle(a).overflowX === 'visible') continue;
    const c = a.getBoundingClientRect();
    box.left = Math.max(box.left, c.left);
    box.right = Math.min(box.right, c.right);
  }
  return box;
}

describe('A held phone card names its assignee, measured (CC-339)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let http: HttpTestingController;

  function configure(lang: 'en' | 'ar'): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PhoneHost],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    http = TestBed.inject(HttpTestingController);
  }

  for (const lang of ['en', 'ar'] as const) {
    for (const all of [false, true]) {
      it(`${lang} · ${all ? '/tasks/all' : "a record's list"} at 390: the held card beside "Resume now" shows its assignee, uncut, and no status word`, async () => {
        configure(lang);
        const fixture = TestBed.createComponent(PhoneHost);
        fixture.componentRef.setInput('all', all);
        fixture.componentRef.setInput('width', all ? 358 : 390); // the page's 16px gutters; the sheet is the screen
        document.body.appendChild(fixture.nativeElement);
        fixture.autoDetectChanges(true);
        const view = fixture.debugElement.query((d) => d.componentInstance instanceof TaskListViewComponent)!.componentInstance as TaskListViewComponent;
        view.phone.set(true);
        http.expectOne((r) => r.url === `${API}/record-list`).flush(
          listPage([
            recordRow('held', {
              status: 'ON_HOLD',
              onHoldUntil: '2099-11-22T05:00:00.000Z',
              dueAt: '2099-11-24T05:00:00.000Z',
              record: { type: 'COMMITTEE', id: 'c-1', nameEn: 'Infection Control Committee', nameAr: 'لجنة مكافحة العدوى' },
              actions: { ...NO_ACTIONS, resume: true, primary: 'RESUME' },
            }),
            recordRow('pending', { status: 'PENDING' }),
          ]),
        );
        await fixture.whenStable();
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

        const el = fixture.nativeElement as HTMLElement;
        const card = el.querySelector<HTMLElement>('[data-task-row="held"]')!;
        // Non-vacuity: a phone card, laid out, with the next step drawn beside it.
        expect(card.classList).toContain('am-tl__item--card');
        const cardBox = card.getBoundingClientRect();
        expect(cardBox.width).toBeGreaterThan(300);
        const button = card.querySelector<HTMLElement>('.am-tl__btn--primary')!;
        expect(button).withContext('the Resume now button').not.toBeNull();
        const buttonBox = button.getBoundingClientRect();
        expect(buttonBox.width).toBeGreaterThan(40);

        // The held card says the hold, and no status word.
        expect(lineText(card)).toContain(HOLD[lang]);
        const line = Array.from(card.querySelectorAll('.am-tl__sub')).map(lineText).join(' | ');
        expect(line).not.toContain(` · ${ON_HOLD[lang]}`);

        // The assignee: ONE element holds the name, and all of it can be seen.
        const holders = Array.from(card.querySelectorAll<HTMLElement>('*')).filter(
          (e) => e.textContent!.includes(NAME) && !Array.from(e.children).some((c) => c.textContent!.includes(NAME)),
        );
        expect(holders.length).withContext('one element names the assignee').toBe(1);
        const holder = holders[0]!;
        expect(holder.scrollWidth).withContext(`"${textOf(holder)}" is cut (${holder.scrollWidth} > ${holder.clientWidth})`).toBeLessThanOrEqual(holder.clientWidth);
        const text = document.createRange();
        text.selectNodeContents(holder);
        const textBox = text.getBoundingClientRect();
        const seen = visibleBox(holder, card);
        expect(textBox.width).toBeGreaterThan(60); // non-vacuity: the name has width
        expect(seen.right - seen.left).withContext('the part of the name that can be seen').toBeGreaterThanOrEqual(textBox.width - 1);
        // Not painted under the button either.
        const overlaps = seen.left < buttonBox.right && seen.right > buttonBox.left && seen.top < buttonBox.bottom && seen.bottom > buttonBox.top;
        expect(overlaps).withContext('the name under "Resume now"').toBeFalse();
        expect(seen.left).toBeGreaterThanOrEqual(cardBox.left - 1);
        expect(seen.right).toBeLessThanOrEqual(cardBox.right + 1);

        // Every "·" is clipped at the start of a line and shown after a part on it:
        // a part starting a row sits 1em before the line's start, every other part after it.
        const lineEl = card.querySelector<HTMLElement>('[data-testid="task-list-card-line"]')!;
        const lineBox = lineEl.getBoundingClientRect();
        const em = parseFloat(getComputedStyle(lineEl).fontSize);
        const rtl = lang === 'ar';
        let lastTop = -Infinity;
        for (const part of Array.from(lineEl.querySelectorAll<HTMLElement>('.am-tl__part'))) {
          const b = part.getBoundingClientRect();
          const offset = rtl ? lineBox.right - b.right : b.left - lineBox.left;
          const startsRow = b.top > lastTop + 1;
          lastTop = Math.max(lastTop, b.top);
          if (startsRow) expect(offset).withContext(`"${textOf(part)}" starts a row: its "·" is clipped`).toBeCloseTo(-em, 0);
          else expect(offset).withContext(`"${textOf(part)}" follows a part: its "·" shows`).toBeGreaterThanOrEqual(0);
        }
        fixture.nativeElement.remove();
      });
    }
  }
});
