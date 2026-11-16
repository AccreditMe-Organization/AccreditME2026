import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateLoader, provideTranslateService, TranslateNoOpLoader } from '@ngx-translate/core';
import { DataListColumn, DataListComponent } from './data-list.component';
import { clientSideSource } from './data-list.source';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { useLayoutFonts } from '../../../../testing/layout-fonts';

/**
 * ACC-309 — a list wider than its box begins at its START edge, in both
 * directions, and can be scrolled back there.
 *
 * The defect: the scroller carried `scrollbar-gutter: stable`. In right-to-left,
 * with that gutter EMPTY (a list too short to scroll down, or a browser whose
 * scrollbars do not take space), Chromium anchors the sideways scroll origin a
 * gutter's width past the start edge and will not scroll back to 0. Measured on
 * Lookups in Arabic at 390: scrollLeft -15 on load, -15 again after
 * scrollLeft = 0, and the first label 3px past the edge (its 12px padding and
 * 3px of text). English was untouched, which is why it went unseen.
 *
 * Measured, not inferred, at the page's content width on a phone (358) and on a
 * 1280 screen (988), English and Arabic, with a SHORT list (the case that
 * breaks) and a LONG one (a vertical scrollbar present):
 *   - the first row's first text starts INSIDE the scroller's content box;
 *   - scrollLeft is 0 on load;
 *   - it scrolls to the far end and back to exactly 0.
 *
 * NON-VACUITY FIRST: at 358 the list must actually overflow sideways (by more
 * than 200px; these columns overflow by about 290), or "starts inside" would hold
 * of a list that never scrolls. The columns are the Lookups values page's own
 * widths, less its row actions.
 */
@Component({
  standalone: true,
  imports: [DataListComponent],
  template: `
    <div data-frame [style.width.px]="width()" style="height: 420px; display: flex; flex-direction: column">
      <app-data-list variant="page" [source]="source" [trackBy]="trackBy" [columns]="columns" [showPager]="false">
        <ng-template #listHeader let-h>
          @for (c of columns; track c.key) {
            <span role="columnheader">{{ c.label }}</span>
          }
          <span></span>
        </ng-template>
        <ng-template #listRow let-row>
          <div class="grid items-center gap-3 px-3 py-2" style="grid-template-columns: var(--am-list-cols)" data-row>
            <span data-first-text>{{ row.name }}</span>
            <span>{{ row.key }}</span>
            <span>{{ row.layer }}</span>
            <span>{{ row.status }}</span>
            <span></span>
          </div>
        </ng-template>
      </app-data-list>
    </div>
  `,
})
class HostComponent {
  readonly width = input(358);
  readonly rowCount = input(3);
  // The Lookups values page's own column widths: 748px of tracks at 358.
  readonly columns: DataListColumn[] = [
    { key: 'name', label: 'LABEL', width: 'minmax(200px, 1.8fr)' },
    { key: 'key', label: 'KEY', width: 'minmax(160px, 1.2fr)' },
    { key: 'layer', label: 'LAYER', width: '120px' },
    { key: 'status', label: 'STATUS', width: '120px' },
  ];
  readonly trackBy = (r: { id: string }): string => r.id;
  readonly source = clientSideSource(
    () =>
      Array.from({ length: this.rowCount() }, (_, i) => ({
        id: String(i),
        name: document.documentElement.dir === 'rtl' ? `رئيس اللجنة ${i + 1}` : `Chairman ${i + 1}`,
        key: `seat_${i + 1}`,
        layer: 'System',
        status: 'Active',
      })),
    { searchFields: (r) => [r.name] },
  );
}

describe('DataListComponent — a wide list begins at its start edge, both directions (ACC-309)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HostComponent>;
  const measured: string[] = [];
  afterAll(() => console.log(`ACC-309 data-list start edge\n  ${measured.join('\n  ')}`));

  async function render(dir: 'ltr' | 'rtl', width: number, rows: number): Promise<void> {
    document.documentElement.dir = dir;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    try {
      localStorage.clear();
    } catch {
      /* none */
    }
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentRef.setInput('width', width);
    fixture.componentRef.setInput('rowCount', rows);
    document.body.appendChild(fixture.nativeElement);
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  afterEach(() => fixture?.nativeElement.remove());

  const scroller = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-data-list .overflow-y-auto')!;

  for (const dir of ['ltr', 'rtl'] as const) {
    for (const width of [358, 988] as const) {
      for (const rows of [3, 40] as const) {
        it(`${dir} at ${width}, ${rows} rows: the first label starts inside the scroller, and the list scrolls back to 0`, async () => {
          await render(dir, width, rows);
          const sc = scroller();
          const first = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-first-text]');
          // Non-vacuity: a laid-out list with its first row on screen.
          expect(sc).withContext('the scroller').not.toBeNull();
          expect(first).withContext('the first row').not.toBeNull();
          expect(sc.clientWidth).withContext('the scroller is laid out').toBeGreaterThan(200);
          if (width === 358) {
            expect(sc.scrollWidth - sc.clientWidth).withContext('at 358 the list overflows sideways').toBeGreaterThan(200);
          }
          if (rows === 40) expect(sc.scrollHeight).withContext('40 rows scroll down').toBeGreaterThan(sc.clientHeight);

          const box = sc.getBoundingClientRect();
          const start = dir === 'rtl' ? box.left + sc.clientLeft + sc.clientWidth : box.left + sc.clientLeft;
          const t = first!.getBoundingClientRect();
          // How far the text's start lies INSIDE the start edge (positive = visible).
          const inside = Math.round(dir === 'rtl' ? start - t.right : t.left - start);
          const onLoad = sc.scrollLeft;

          sc.scrollLeft = dir === 'rtl' ? -100000 : 100000;
          const end = sc.scrollLeft;
          sc.scrollLeft = 0;
          const back = sc.scrollLeft;

          measured.push(
            `${dir} ${width} ${String(rows).padStart(2)} rows: scrollLeft ${onLoad}, text ${inside}px inside the start edge, scroll range ${end}…${back} (${sc.scrollWidth} in ${sc.clientWidth})`,
          );
          expect(onLoad).withContext('scrollLeft on load').toBe(0);
          expect(inside).withContext('the first label starts inside the scroller').toBeGreaterThanOrEqual(0);
          expect(back).withContext('scrolls back to exactly 0').toBe(0);
          // The whole width is reachable: the far end is the full overflow, in the direction's sign.
          expect(Math.abs(end)).withContext('the far end').toBe(sc.scrollWidth - sc.clientWidth);
        });
      }
    }
  }
});
