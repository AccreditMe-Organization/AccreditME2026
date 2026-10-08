import { Component, signal } from '@angular/core';
import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { DataListColumn, DataListComponent } from './data-list.component';
import { clientSideSource } from './data-list.source';
import { preserveDocumentLanguage } from '../../../../testing/document-language';

/**
 * ACC-120 — column headings must sit over their own data.
 *
 * ## Why this measures instead of comparing strings
 *
 * The obvious assertion is "the header's grid-template-columns equals the
 * rows'", and — CORRECTING WHAT AN EARLIER VERSION OF THIS COMMENT CLAIMED — it
 * is NOT blind. Karma runs a real headless Chrome, so getComputedStyle returns
 * RESOLVED track sizes rather than the var() as authored. That is exactly the
 * reading that found the bug in the browser: 0.015625px against 68px for the
 * trailing track. The test below proves it, by asserting the strings differ in
 * the broken configuration.
 *
 * Both are kept, and the order is the point. The offsets state the REQUIREMENT
 * — a heading sits over its own data — and the track list states one MECHANISM
 * for meeting it. A future layout that meets the requirement another way should
 * not be failed for it, which is why the geometry leads.
 *
 * The defect itself measured 0, 47, 83, 83, 83, 83px on Org Positions, far
 * enough that the GRADE heading sat over the SINGLE ASSIGNEE data.
 *
 * Two causes, neither visible in the string:
 *
 *   1. The trailing actions track was `auto`, which resolves against each
 *      grid's OWN content. A row holds action buttons there; the header holds
 *      an empty span. The header's last track collapsed to ~0 and handed its
 *      ~68px back to the fr columns.
 *   2. The header sat OUTSIDE the rows' scroll container, so the two grids had
 *      different content-box widths — by the scrollbar when scrolling, and by
 *      the reserved gutter when not — and every fr track resolved differently.
 *
 * So this asserts the string AND the rendered geometry. The string assertion is
 * kept because it is cheap and names the intent; the geometry is what bites.
 *
 * ## It compares DATA columns only
 *
 * The trailing cell is excluded deliberately. A row's last cell is commonly
 * end-aligned — Lookup categories put a right-pointing chevron there with
 * `justify-self: end` — so comparing its left offset to the header's empty span
 * reports ~72px of "drift" that is the alignment working as drawn. What must
 * line up is each heading over its own data.
 */
@Component({
  standalone: true,
  imports: [DataListComponent],
  template: `
    <div style="height: 300px; width: 900px; display: flex">
      <app-data-list
        variant="page"
        [source]="source"
        [trackBy]="trackBy"
        [columns]="columns"
        [gridSuffix]="suffix()"
      >
        <ng-template #listHeader let-h>
          @for (c of columns; track c.key) {
            <span>{{ c.label }}</span>
          }
          <span></span>
        </ng-template>
        <ng-template #listRow let-row>
          <div
            class="grid items-center gap-3 px-3 py-2"
            style="grid-template-columns: var(--am-list-cols)"
          >
            <span>{{ row.name }}</span>
            <span>{{ row.code }}</span>
            <span>{{ row.kind }}</span>
            <!-- A realistic actions cell: content-sized, and WIDER than the
                 header's empty span. This is the asymmetry auto could not
                 survive. -->
            <div class="flex justify-end gap-1">
              <button type="button">Edit</button>
              <button type="button">More</button>
            </div>
          </div>
        </ng-template>
      </app-data-list>
    </div>
  `,
})
class HostComponent {
  readonly columns: DataListColumn[] = [
    { key: 'name', label: 'NAME', width: 'minmax(120px, 2fr)' },
    { key: 'code', label: 'CODE', width: 'minmax(80px, 1fr)' },
    { key: 'kind', label: 'KIND', width: '120px' },
  ];
  // The component's own default, repeated here ON PURPOSE. Binding
  // [gridSuffix]="undefined" does NOT fall back to the default — Angular treats
  // an explicit undefined as the value, gridTemplate() then appends no trailing
  // track at all, and the geometry assertions below never exercised the actions
  // column. Caught by mutating the component's default to 'auto' and watching
  // this file still pass 6/6.
  //
  // Because it is a copy, the default itself is pinned separately below, by
  // reading the component rather than by geometry.
  readonly suffix = signal<string>('var(--am-list-actions, 88px)');
  readonly trackBy = (r: { id: string }): string => r.id;
  // Enough rows to overflow a 300px box, so the scrollbar case is exercised.
  readonly rows = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    name: `Row ${i}`,
    code: `C-${i}`,
    kind: 'kind',
  }));
  readonly source = clientSideSource(() => this.rows, { searchFields: (r) => [r.name] });
}

describe('DataListComponent — header/row column alignment (ACC-120)', () => {
  let fixture: ComponentFixture<HostComponent>;

  // ACC-184 — LEFT TO RIGHT IS THE PREMISE OF EVERY OFFSET BELOW, so it is set
  // here rather than assumed. CI failed this file once with the offsets in
  // mirror order (593 against 369) because an earlier spec in that random order
  // had left <html dir="rtl">. Setting it in this spec's own beforeEach means
  // no order can do that again; the helper puts back what was there after.
  preserveDocumentLanguage();
  beforeEach(() => {
    document.documentElement.dir = 'ltr';
  });

  function render(suffix?: string): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    if (suffix !== undefined) fixture.componentInstance.suffix.set(suffix);
    fixture.detectChanges();
    tick(500);
    fixture.detectChanges();
  }

  const grids = (): HTMLElement[] =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '[style*="grid-template-columns"]',
      ),
    ).filter((el) => getComputedStyle(el).display === 'grid');

  /** Left offsets of the DATA cells only — the trailing cell is excluded. */
  const dataLefts = (el: HTMLElement, count: number): number[] =>
    Array.from(el.children)
      .slice(0, count)
      .map((c) => Math.round(c.getBoundingClientRect().left));

  // Pins the DEFAULT itself, by reading the component. The geometry tests use a
  // copy of it, so without this a change to the default would go unnoticed by
  // every one of them.
  it('defaults the actions track to a fixed width, never a content-sized one', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    const bare = TestBed.createComponent(DataListComponent).componentInstance;
    const suffix = bare.gridSuffix();

    expect(suffix).not.toBe('');
    // Any of these resolves against each grid's own content, and the header can
    // never hold what a row holds in this cell.
    for (const unsafe of ['auto', 'min-content', 'max-content', 'fit-content']) {
      expect(suffix).not.toContain(unsafe);
    }
  });

  it('renders a header and at least one row to compare', fakeAsync(() => {
    render();
    expect(grids().length).toBeGreaterThan(1);
  }));

  it('gives the header and the rows the same track list', fakeAsync(() => {
    render();
    const [header, row] = grids();
    expect(getComputedStyle(header!).gridTemplateColumns).toBe(
      getComputedStyle(row!).gridTemplateColumns,
    );
  }));

  /**
   * THE GUARD AGAINST A VACUOUS PASS, and it comes first on purpose.
   *
   * "drift === 0" passes perfectly when every number is zero, which is what a
   * layout-less environment reports for every getBoundingClientRect. Karma runs
   * a real headless Chrome so layout does run — but that is a property of how
   * the suite happens to be configured today, not something the assertion below
   * states. Without this, moving to a DOM emulator would turn the whole file
   * green and silent.
   *
   * So: the offsets must be real, distinct and increasing before "they match"
   * means anything.
   */
  it('measures real geometry, so a match is not a match of zeroes', fakeAsync(() => {
    render();
    const [header, row] = grids();
    const columnCount = fixture.componentInstance.columns.length;
    const h = dataLefts(header!, columnCount);
    const r = dataLefts(row!, columnCount);

    expect(h.length).toBe(columnCount);
    expect(h.every((v) => v > 0)).toBe(true);
    expect(r.every((v) => v > 0)).toBe(true);
    // Strictly increasing: columns laid out left to right, not all stacked at 0.
    expect(h).toEqual([...h].sort((a, b) => a - b));
    expect(new Set(h).size).toBe(columnCount);
  }));

  // THE ASSERTION THAT BITES. The string comparison above passed throughout the
  // defect — in a BROWSER the computed value is resolved track sizes, which is
  // how the bug was found (0.015625px against 68px), but in a spec both sides
  // read back the same unresolved var() and it matches by construction.
  it('puts every heading at the same offset as its own data column', fakeAsync(() => {
    render();
    const [header, row] = grids();
    const columnCount = fixture.componentInstance.columns.length;
    expect(dataLefts(header!, columnCount)).toEqual(dataLefts(row!, columnCount));
  }));

  // Cause 1, pinned on its own so a future default change is caught by name.
  it('drifts when the actions track is content-sized, which is why auto is refused', fakeAsync(() => {
    render('auto');
    const [header, row] = grids();
    const columnCount = fixture.componentInstance.columns.length;
    // Not an endorsement — a guard. If this ever stops drifting, `auto` became
    // safe and the comment on gridSuffix should be revisited rather than
    // trusted.
    expect(dataLefts(header!, columnCount)).not.toEqual(dataLefts(row!, columnCount));

    // AND THE COMPUTED TRACK LISTS DIFFER TOO, which settles a thing both of us
    // got wrong about this file. Karma runs a real headless Chrome, so
    // getComputedStyle().gridTemplateColumns is RESOLVED pixel sizes, not the
    // var() as authored — the same reading that found the bug in the browser
    // (0.015625px against 68px for the trailing track). So a string comparison
    // is not blind here, and the original suggestion to use one was sound.
    //
    // It is kept as the SECOND assertion rather than the only one because it
    // states a mechanism, where the offsets state the requirement: a heading
    // sits over its own data. A future layout that satisfies the requirement by
    // some other means should not be failed for it.
    expect(getComputedStyle(header!).gridTemplateColumns).not.toBe(
      getComputedStyle(row!).gridTemplateColumns,
    );
  }));

  // Cause 2: the header must share the rows' content box, which is what makes
  // the scrollbar irrelevant rather than something to keep in step with.
  it('keeps the header inside the scroll container, stuck to the top', fakeAsync(() => {
    render();
    const host = fixture.nativeElement as HTMLElement;
    const scroller = Array.from(host.querySelectorAll<HTMLElement>('div')).find(
      (d) => getComputedStyle(d).overflowY === 'auto',
    );
    const header = grids()[0]!;
    expect(scroller).toBeDefined();
    expect(scroller!.contains(header)).toBe(true);
    expect(getComputedStyle(header).position).toBe('sticky');
  }));

  it('still aligns once the rows actually overflow', fakeAsync(() => {
    render();
    const host = fixture.nativeElement as HTMLElement;
    const scroller = Array.from(host.querySelectorAll<HTMLElement>('div')).find(
      (d) => getComputedStyle(d).overflowY === 'auto',
    )!;
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);

    const [header, row] = grids();
    const columnCount = fixture.componentInstance.columns.length;
    expect(dataLefts(header!, columnCount)).toEqual(dataLefts(row!, columnCount));
  }));
});
