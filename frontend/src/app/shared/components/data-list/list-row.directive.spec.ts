import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ListRowDirective } from './list-row.directive';

/**
 * Driven entirely by KEYS. The Escape collision earlier in ACC-111 was
 * invisible to every mouse test, and so is this one: two keyboard models on
 * one element look identical until something is pressed.
 */
@Component({
  standalone: true,
  imports: [ListRowDirective],
  template: `
    <div class="rows" [attr.dir]="dir">
      @for (row of rows; track row.id) {
        <div
          amListRow
          [amListRowSelected]="selected.has(row.id)"
          [amListRowDisabled]="row.id === 'c'"
          (rowOpen)="opened.push(row.id)"
          (rowToggleSelect)="toggle(row.id)"
        >
          <span>{{ row.name }}</span>
          <button type="button" class="edit" (click)="edited.push(row.id)">Edit</button>
          <button type="button" class="more">More</button>
        </div>
      }
    </div>
  `,
})
class RowsHost {
  dir: 'ltr' | 'rtl' = 'ltr';
  rows = [
    { id: 'a', name: 'Aisha Al-Balawi' },
    { id: 'b', name: 'Nora Al-Otaibi' },
    { id: 'c', name: 'Omar Siddiqui' },
  ];
  selected = new Set<string>();
  opened: string[] = [];
  edited: string[] = [];
  toggle(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
  }
}

describe('ListRowDirective (ACC-111)', () => {
  let fixture: ComponentFixture<RowsHost>;
  let host: RowsHost;

  const rowEls = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.am-list-row'));

  /** A real keystroke: `code` is what both this directive and PrimeNG read. */
  const press = (el: Element, code: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', {
      key: code,
      code,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RowsHost] }).compileComponents();
    fixture = TestBed.createComponent(RowsHost);
    host = fixture.componentInstance;
    fixture.nativeElement.style.position = 'relative';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('makes the table ONE tab stop: the first row only', () => {
    const [first, second, third] = rowEls();
    expect(first.getAttribute('tabindex')).toBe('0');
    expect(second.getAttribute('tabindex')).toBe('-1');
    expect(third.getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus between rows with the arrows, without selecting anything', () => {
    const rows = rowEls();
    rows[0].focus();
    press(rows[0], 'ArrowDown');
    expect(document.activeElement).toBe(rows[1]);

    press(rows[1], 'ArrowDown');
    expect(document.activeElement).toBe(rows[2]);

    press(rows[2], 'ArrowUp');
    expect(document.activeElement).toBe(rows[1]);

    // Focus is not selection — this is where pSelectableRow differs.
    expect(host.selected.size).toBe(0);
    expect(host.opened).toEqual([]);
  });

  it('stops at the ends rather than wrapping, and Home/End jump', () => {
    const rows = rowEls();
    rows[0].focus();
    press(rows[0], 'ArrowUp');
    expect(document.activeElement).toBe(rows[0]);

    press(rows[0], 'End');
    expect(document.activeElement).toBe(rows[2]);
    press(rows[2], 'ArrowDown');
    expect(document.activeElement).toBe(rows[2]);
    press(rows[2], 'Home');
    expect(document.activeElement).toBe(rows[0]);
  });

  it('opens on Enter and selects on Space', () => {
    const rows = rowEls();
    rows[1].focus();
    press(rows[1], 'Enter');
    expect(host.opened).toEqual(['b']);

    press(rows[1], 'Space');
    expect(host.selected.has('b')).toBe(true);
    press(rows[1], 'Space');
    expect(host.selected.has('b')).toBe(false);
  });

  it('prevents the default on Space, so selecting does not scroll the page', () => {
    const rows = rowEls();
    rows[0].focus();
    const event = press(rows[0], 'Space');
    expect(event.defaultPrevented).toBe(true);
  });

  it('marks the selected row for assistive tech, not only with colour', () => {
    const rows = rowEls();
    rows[0].focus();
    press(rows[0], 'Space');
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
    expect(rows[1].getAttribute('aria-selected')).toBe('false');
  });

  // The failure this component exists to avoid: the design records today's row
  // menus as unreachable by keyboard.
  describe('the row actions are reachable', () => {
    it('takes the row controls OUT of the tab order', () => {
      const rows = rowEls();
      rows[0].focus();
      const buttons = rows[0].querySelectorAll('button');
      expect(buttons[0].getAttribute('tabindex')).toBe('-1');
      expect(buttons[1].getAttribute('tabindex')).toBe('-1');
    });

    it('reaches them with ArrowRight, in order, and comes back with ArrowLeft', () => {
      const rows = rowEls();
      rows[0].focus();

      press(rows[0], 'ArrowRight');
      expect(document.activeElement).toBe(rows[0].querySelector('.edit'));

      press(document.activeElement!, 'ArrowRight');
      expect(document.activeElement).toBe(rows[0].querySelector('.more'));

      press(document.activeElement!, 'ArrowLeft');
      expect(document.activeElement).toBe(rows[0].querySelector('.edit'));

      press(document.activeElement!, 'ArrowLeft');
      expect(document.activeElement).toBe(rows[0]);
    });

    it('leaves Enter to the focused control rather than opening the record', () => {
      const rows = rowEls();
      rows[0].focus();
      press(rows[0], 'ArrowRight');
      press(document.activeElement!, 'Enter');
      expect(host.opened).toEqual([]);
    });
  });

  it('mirrors the arrows in RTL, because "next" follows reading order', () => {
    host.dir = 'rtl';
    fixture.detectChanges();
    const rows = rowEls();
    rows[0].focus();

    press(rows[0], 'ArrowLeft');
    expect(document.activeElement).toBe(rows[0].querySelector('.edit'));

    press(document.activeElement!, 'ArrowRight');
    expect(document.activeElement).toBe(rows[0]);
  });

  // A row that cannot be acted on still RECEIVES focus and says so, rather
  // than being skipped — a reader scanning the list must still meet it.
  it('focuses a disabled row but neither opens nor selects it', () => {
    const rows = rowEls();
    const disabled = rows[2];
    disabled.focus();
    expect(document.activeElement).toBe(disabled);

    press(disabled, 'Enter');
    press(disabled, 'Space');

    expect(host.opened).toEqual([]);
    expect(host.selected.size).toBe(0);
    expect(disabled.classList).toContain('am-list-row--disabled');
  });
});
