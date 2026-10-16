import { Component, TemplateRef, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { SIMPLE_LIST_PHONE_BELOW_PX, SimpleListComponent, SimpleListPage, SimpleListQuery } from './simple-list.component';

// ACC-120 slice 4 — am-simple-list's two opt-in options, for Add member's person
// picker: rows you can pick (`selectable`), and rows disabled with a reason
// (`rowDisabled`). Both default OFF, and off the rows are ACC-230's exactly —
// the members panel's own specs run unedited against the same component.

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: 'r1', name: 'Huda' },
  { id: 'r2', name: 'Khalid' },
  { id: 'r3', name: 'Mona' },
];

@Component({
  standalone: true,
  imports: [SimpleListComponent],
  template: `
    <ng-template #cells let-row><span class="cell">{{ row.name }}</span></ng-template>
    @if (cellsTpl(); as tpl) {
      <am-simple-list
        [load]="load"
        [columns]="[{ label: 'Name' }]"
        grid="1fr 120px"
        [row]="tpl"
        [sortOptions]="[{ value: 'name:asc', label: 'A–Z' }]"
        defaultSort="name:asc"
        searchLabel="Search"
        [countText]="countText"
        [selectable]="selectable()"
        [rowDisabled]="rowDisabled()"
        (picked)="picked.push($event)"
      />
    }
  `,
})
class HostComponent {
  readonly cellsTpl = viewChild<TemplateRef<{ $implicit: Row; phone: boolean }>>('cells');
  readonly selectable = signal(false);
  readonly rowDisabled = signal<((row: Row) => string | null) | null>(null);
  readonly picked: Row[] = [];
  readonly load = (_q: SimpleListQuery) =>
    of<SimpleListPage<Row>>({ items: ROWS, total: ROWS.length, matching: ROWS.length });
  readonly countText = (n: number) => `${n} rows`;
}

describe('am-simple-list — selectable rows and rows disabled with a reason (ACC-120 slice 4)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLElement;

  function setup(selectable: boolean, rowDisabled: ((row: Row) => string | null) | null = null): void {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting()],
    });
    loadTranslationsForTest({ en });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.selectable.set(selectable);
    fixture.componentInstance.rowDisabled.set(rowDisabled);
    el = fixture.nativeElement;
    fixture.detectChanges();
    fixture.detectChanges();
  }

  // The grid is drawn above the phone width only; below it the rows are cards.
  const grid = (): string =>
    window.matchMedia(`(max-width: ${SIMPLE_LIST_PHONE_BELOW_PX - 0.02}px)`).matches ? '' : '1fr 120px';
  const rows = () => Array.from(el.querySelectorAll<HTMLElement>('[data-testid="simple-list-row"]'));
  const picks = () => Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="simple-list-pick"]'));

  it('off by default: the rows are plain grid rows, with no button and no reason cell', () => {
    setup(false);
    expect(rows().length).withContext('rows rendered').toBe(3);
    expect(picks().length).toBe(0);
    expect(el.querySelector('[data-testid="simple-list-reason"]')).toBeNull();
    for (const row of rows()) {
      expect(row.tagName).toBe('LI');
      expect(row.classList).toContain('am-sl__row');
      expect(row.style.gridTemplateColumns).toBe(grid());
    }
  });

  it('selectable: each row is one button carrying the grid, and pressing it picks that row', () => {
    setup(true);
    expect(picks().length).withContext('one button per row').toBe(3);
    for (const b of picks()) {
      expect(b.type).toBe('button');
      expect(b.style.gridTemplateColumns).toBe(grid());
      expect(b.hasAttribute('aria-disabled')).toBeFalse();
    }
    expect(el.querySelector('[data-testid="simple-list-reason"]')).withContext('no reason cell without rowDisabled').toBeNull();
    picks()[1].click();
    expect(fixture.componentInstance.picked.map((r) => r.id)).toEqual(['r2']);
  });

  it('a row with a reason stays in the list, focusable, announced as unavailable, and cannot be picked', () => {
    setup(true, (row) => (row.id === 'r1' ? 'Already a member' : null));
    const [first, second] = picks();
    expect(first.getAttribute('aria-disabled')).toBe('true');
    // aria-disabled, never disabled: it stays reachable, so its reason is read.
    expect(first.disabled).toBeFalse();
    expect(first.textContent).toContain('Already a member');
    expect(second.hasAttribute('aria-disabled')).toBeFalse();
    const reasons = Array.from(el.querySelectorAll('[data-testid="simple-list-reason"]')).map((r) => r.textContent!.trim());
    expect(reasons).toEqual(['Already a member', '', '']);

    first.click();
    expect(fixture.componentInstance.picked).withContext('a disabled row is never picked').toEqual([]);
    second.click();
    expect(fixture.componentInstance.picked.map((r) => r.id)).toEqual(['r2']);
  });
});
