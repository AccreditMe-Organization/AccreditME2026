import { Component, signal } from '@angular/core';
import { TestBed, ComponentFixture, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { DataListColumn, DataListComponent } from './data-list.component';
import { clientSideSource } from './data-list.source';

/**
 * ACC-120 — column headings must sit over their own data.
 *
 * ## Why this measures instead of comparing strings
 *
 * The obvious assertion is "the header's grid-template-columns equals the
 * rows'". IT WOULD HAVE PASSED THROUGHOUT THE DEFECT. Both grids read one
 * `--am-list-cols`, so the strings were byte-identical while the columns
 * visibly drifted — measured on Org Positions at 0, 47, 83, 83, 83, 83px, far
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

  // THE ASSERTION THAT BITES. The one above passed throughout the defect.
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
    // trusted. If it starts passing silently, the fixed default is doing the
    // work and this test is the only thing saying why.
    expect(dataLefts(header!, columnCount)).not.toEqual(dataLefts(row!, columnCount));
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
