import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { environment } from '../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { LanguageService } from '../../../core/services/language.service';
import { AccreditMePreset } from '../../../core/theme/accreditme-preset';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { RecycleBinComponent } from './recycle-bin.component';
import { BIN_18, BIN_NOW, binItem } from './recycle-bin-fixtures';

// ACC-260, PR D — the Recycle bin laid out: EN and AR at 988, 358 and 328px of
// content (the page specs' widths), nothing sideways at any depth, the header
// cells over their columns, and the Restore and Purge dialogs measured against
// the 420 cap at desktop width (phones may stack and scroll, Ahmad, 26 Oct).
//
// The viewport is Karma's iframe, narrowed or widened for each case, so the
// phone breakpoint (768) applies exactly as in the app.

const URL = `${environment.apiUrl}/tenant/recycle-bin`;
const ROWS = [...BIN_18.slice(0, 9), binItem({ id: 'f-gone', name: 'A very long file name that has to be cut short somewhere.pdf', mimeType: 'application/pdf', record: { type: 'TASK', id: 't-x', name: null }, daysAgo: 27 })];

@Component({
  selector: 'am-test-frame',
  standalone: true,
  imports: [RecycleBinComponent],
  template: `<div data-frame [style.width.px]="width()" style="height:900px;overflow:auto;box-sizing:border-box;padding:0"><app-recycle-bin /></div>`,
})
class FrameComponent {
  readonly width = input(988);
}

// Measured (ACC-260 PR D). Body heights of the two dialogs at desktop width,
// against the 420 cap: Restore one file (its one sentence), Restore several
// with one skipped (the sentence and the two pairs: 94 / 104, as drawn), and
// Purge several with the tick (127 / 140; drawn 130 / 142 with a 24 / 26px
// checkbox row, PrimeNG's checkbox row is 21 / 24).
const DIALOG_HEIGHTS: Record<'en' | 'ar', Record<'restoreOne' | 'restoreMany' | 'purge', number>> = {
  en: { restoreOne: 21, restoreMany: 94, purge: 127 },
  ar: { restoreOne: 24, restoreMany: 104, purge: 140 },
};

describe('RecycleBinComponent layout (ACC-260, PR D)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<FrameComponent>;
  const measured: string[] = [];
  afterAll(() => console.log(`ACC-260 PR D recycle bin layout\n${measured.join('\n')}`));

  function setViewport(width: number | null): void {
    const frame = window.frameElement as HTMLElement | null;
    if (width === null) {
      if (frame) frame.style.width = '';
      return;
    }
    if (!frame) throw new Error("These specs size the viewport through Karma's iframe, and there is none");
    frame.style.width = `${width}px`;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  async function render(lang: 'en' | 'ar', width: number, viewport: number): Promise<HTMLElement> {
    setViewport(viewport);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FrameComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    try {
      localStorage.clear();
    } catch {
      /* none */
    }
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(FrameComponent);
    fixture.componentRef.setInput('width', width);
    document.body.appendChild(fixture.nativeElement);
    const page = fixture.debugElement.children[0]!.children[0]!.componentInstance as RecycleBinComponent;
    page.now = () => BIN_NOW;
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(URL).flush(ROWS);
    await settle();
    return fixture.nativeElement.querySelector('[data-frame]') as HTMLElement;
  }

  const page = (): RecycleBinComponent => fixture.debugElement.children[0]!.children[0]!.componentInstance as RecycleBinComponent;

  afterEach(() => {
    fixture?.nativeElement.remove();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    setViewport(null);
  });

  const box = (el: Element): DOMRect => el.getBoundingClientRect();
  function pastFrame(frame: HTMLElement): string[] {
    const f = box(frame);
    return Array.from(frame.querySelectorAll<HTMLElement>('*'))
      .filter((e) => {
        const r = box(e);
        return r.width > 0 && (r.right > f.right + 1 || r.left < f.left - 1);
      })
      .map((e) => e.getAttribute('data-testid') || e.getAttribute('data-cell') || e.className.toString().slice(0, 40) || e.tagName);
  }

  for (const lang of ['en', 'ar'] as const) {
    for (const [width, viewport] of [
      [988, 1280],
      [358, 390],
      [328, 360],
    ] as const) {
      it(`${lang} at ${width}: rows, the bulk bar and a gone row laid out, nothing sideways`, async () => {
        const frame = await render(lang, width, viewport);
        // Non-vacuity: the list rendered, at the layout this width gets.
        const rows = frame.querySelectorAll<HTMLElement>('[data-file]');
        expect(rows.length).toBe(10);
        expect(page().phone()).withContext('phone layout').toBe(width < 768);
        for (const id of ['f-01', 'f-03', 'f-gone']) {
          frame.querySelector<HTMLInputElement>(`[data-file="${id}"] [data-testid="bin-select"]`)!.click();
        }
        await settle();
        expect(frame.querySelector('[data-testid="bin-bulk"]')).withContext('bulk bar').not.toBeNull();
        expect(frame.querySelector('[data-file="f-gone"] [data-testid="bin-gone"]')).withContext('gone line').not.toBeNull();

        expect(frame.scrollWidth).withContext('sideways').toBeLessThanOrEqual(frame.clientWidth);
        expect(pastFrame(frame)).withContext('past the frame').toEqual([]);

        // The long name is cut inside its cell, never past the row.
        const name = frame.querySelector<HTMLElement>('[data-file="f-gone"] [data-testid="bin-name"]')!;
        expect(name.scrollWidth).withContext('the long name is long').toBeGreaterThan(name.clientWidth);
        expect(box(name).right).toBeLessThanOrEqual(box(frame).right + 1);

        if (width >= 768) {
          // Headers over their columns: the same start offsets in the header and a row.
          const header = frame.querySelector<HTMLElement>('app-data-list [role="row"]')!;
          const heads = Array.from(header.children) as HTMLElement[];
          const cells = Array.from(rows[0]!.children).filter((c) => !c.classList.contains('am-bin__gone')) as HTMLElement[];
          const starts = (els: HTMLElement[]) => els.map((e) => Math.round(lang === 'ar' ? box(e).right : box(e).left));
          expect(new Set(starts(heads)).size).withContext('distinct header offsets').toBe(heads.length);
          expect(starts(cells)).toEqual(starts(heads));
          // A row's Restore and Purge… sit on one line, in both languages.
          const live = Array.from(rows).find((r) => !r.hasAttribute('data-gone'))!;
          const buttons = Array.from(live.querySelectorAll<HTMLElement>('[data-cell="actions"] p-button'));
          expect(buttons.length).withContext('both actions').toBe(2);
          expect(Math.round(box(buttons[0]!).top)).withContext('one line').toBe(Math.round(box(buttons[1]!).top));
        } else {
          // On a phone the row is the file cell, with its actions under the
          // file's lines (never over the name), and Days left beside it.
          const actions = rows[0]!.querySelector<HTMLElement>('[data-cell="actions"]')!;
          expect(box(actions).width).toBeGreaterThan(0);
          expect(box(actions).right).toBeLessThanOrEqual(box(frame).right + 1);
          const firstName = rows[0]!.querySelector<HTMLElement>('[data-testid="bin-name"]')!;
          expect(box(actions).top).withContext('actions below the name').toBeGreaterThanOrEqual(box(firstName).bottom - 0.5);
          // The rows have their room: with an outcome AND the bulk bar above
          // the list, the page grows rather than squeezing the list into a
          // sliver that scrolls on its own (found in the browser).
          page().outcome.set({ kind: 'restoreMixed', restored: 2, lines: ['a: restored', 'b: refused', 'c: restored'] });
          await settle();
          const host = frame.querySelector<HTMLElement>('app-data-list')!;
          for (let n: HTMLElement | null = rows[9]!.parentElement; n && n !== host.parentElement; n = n.parentElement) {
            expect(n.scrollHeight).withContext(`no inner scroll: ${n.className.toString().slice(0, 40) || n.tagName}`).toBeLessThanOrEqual(n.clientHeight + 1);
          }
          // Two sortable headers stay: the file, and how soon it goes.
          const sortable = Array.from(frame.querySelectorAll('app-data-list [role="row"] am-sort-header')).map((h) => h.getAttribute('data-sort-key'));
          expect(sortable).toEqual(['file', 'daysLeft']);
        }
        measured.push(`  ${lang} ${width}: rows ${rows.length}, page ${frame.scrollHeight}, sideways ${frame.scrollWidth - frame.clientWidth}`);
      });
    }

    it(`${lang}: the Restore and Purge dialogs at desktop width, under the 420 cap`, async () => {
      await render(lang, 988, 1280);
      const p = page();
      const body = (testid: string): number => document.body.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.offsetHeight;

      p.openRestore([ROWS[0]!]);
      await settle();
      const restoreOne = body('restore-body');
      p.restoreOpen.set(false);
      await settle();

      p.openRestore([ROWS[0]!, ROWS[1]!, ROWS[2]!, ROWS.at(-1)!]);
      await settle();
      const restoreMany = body('restore-body');
      expect(document.body.querySelector('[data-testid="restore-skipped"]')).withContext('the skipped pair').not.toBeNull();
      p.restoreOpen.set(false);
      await settle();

      p.openPurge([ROWS[0]!, ROWS[1]!, ROWS[2]!]);
      await settle();
      const purge = body('purge-body');
      expect(document.body.querySelector('[data-testid="purge-tick"]')).withContext('the tick').not.toBeNull();

      measured.push(`  ${lang} dialogs: restore one ${restoreOne}, restore many ${restoreMany}, purge ${purge} (cap 420)`);
      for (const h of [restoreOne, restoreMany, purge]) {
        expect(h).withContext('non-vacuity').toBeGreaterThan(20);
        expect(h).toBeLessThanOrEqual(420);
      }
      expect({ restoreOne, restoreMany, purge }).toEqual(DIALOG_HEIGHTS[lang]);
    });
  }
});
