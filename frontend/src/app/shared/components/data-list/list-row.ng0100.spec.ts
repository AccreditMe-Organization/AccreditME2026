import { Component } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { DataListColumn, DataListComponent } from './data-list.component';
import { clientSideSource } from './data-list.source';
import { ListRowDirective } from './list-row.directive';

/**
 * ACC-269 — a search or a page that drops the first row must not throw NG0100.
 *
 * With animations on, the renderer removes a row at the END of change
 * detection, so while the rows are checked the departing first row is still
 * the DOM's first sibling. A row that asked the DOM "am I first?" therefore got
 * one answer in the check and another in the dev-mode re-check. The row now
 * takes its place from the list's index, which is the same in both.
 *
 * This renders the real list, with real (not noop) animations, and searches
 * the way a reader does: through the search box.
 */
@Component({
  standalone: true,
  imports: [DataListComponent, ListRowDirective],
  template: `
    <app-data-list variant="page" [source]="source" [trackBy]="trackBy" [columns]="columns">
      <ng-template #listHeader>
        <span>NAME</span>
        <span></span>
      </ng-template>
      <ng-template #listRow let-row let-i="index">
        <div
          amListRow
          [amListRowKey]="row.id"
          [amListRowIndex]="i"
          class="grid items-center gap-3 px-3 py-2"
          style="grid-template-columns: var(--am-list-cols)"
        >
          <span class="name">{{ row.name }}</span>
          <span></span>
        </div>
      </ng-template>
    </app-data-list>
  `,
})
class SearchHost {
  readonly columns: DataListColumn[] = [{ key: 'name', label: 'NAME', width: 'minmax(120px, 1fr)' }];
  readonly trackBy = (r: { id: string }): string => r.id;
  readonly rows = [
    { id: 'a', name: 'Aisha Al-Balawi' },
    { id: 'b', name: 'Nora Al-Otaibi' },
    { id: 'c', name: 'Omar Siddiqui' },
  ];
  readonly source = clientSideSource(() => this.rows, { searchFields: (r) => [r.name] });
}

describe('ListRowDirective inside a data list, with animations on (ACC-269)', () => {
  let fixture: ComponentFixture<SearchHost>;
  let consoleErrors: string[];

  const rows = (): HTMLElement[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.am-list-row'));
  const names = (): string[] => rows().map((r) => r.querySelector('.name')?.textContent?.trim() ?? '');

  beforeEach(() => {
    consoleErrors = [];
    spyOn(console, 'error').and.callFake((...args: unknown[]) => {
      consoleErrors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    });
    TestBed.configureTestingModule({
      imports: [SearchHost],
      providers: [
        provideAnimations(),
        provideRouter([]),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    fixture = TestBed.createComponent(SearchHost);
  });

  it('a search that drops the first row throws no NG0100, and the new first row is the tab stop', fakeAsync(() => {
    // Every detectChanges() here runs the dev-mode re-check (checkNoChanges).
    fixture.detectChanges();
    tick(500);
    fixture.detectChanges();

    // Non-vacuity guard: three rows, the first of them the tab stop, so the
    // search below really does drop the row that held tabindex 0.
    expect(names()).toEqual(['Aisha Al-Balawi', 'Nora Al-Otaibi', 'Omar Siddiqui']);
    expect(rows().map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);

    const search = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="search"], input');
    expect(search).withContext('the list has a search box').not.toBeNull();
    // "r" matches Nora and Omar, not Aisha: the search drops the first row.
    search!.value = 'r';
    search!.dispatchEvent(new Event('input'));

    let thrown: unknown = null;
    try {
      for (let i = 0; i < 4; i++) {
        tick(500);
        fixture.detectChanges();
      }
    } catch (e) {
      thrown = e;
    }

    expect(thrown instanceof Error ? thrown.message : thrown).toBeNull();
    expect(consoleErrors.filter((m) => m.includes('NG0100'))).toEqual([]);
    expect(names()).toEqual(['Nora Al-Otaibi', 'Omar Siddiqui']);
    expect(rows().map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1']);
  }));
});
