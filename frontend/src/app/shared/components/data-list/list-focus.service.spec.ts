import { TestBed } from '@angular/core/testing';
import { ListFocusService } from './list-focus.service';

/**
 * Where focus goes when the rows change under a keyboard user.
 *
 * Every assertion here is about something NO MOUSE TEST CAN SEE: focus falling
 * to <body> looks identical to a working list in a screenshot.
 */
describe('ListFocusService (ACC-111)', () => {
  let service: ListFocusService;
  let container: HTMLElement;

  const buildRows = (count: number): HTMLElement[] => {
    container.innerHTML = '';
    const rows: HTMLElement[] = [];
    for (let i = 0; i < count; i++) {
      const row = document.createElement('div');
      row.className = 'am-list-row';
      row.tabIndex = i === 0 ? 0 : -1;
      row.textContent = `row ${i}`;
      container.appendChild(row);
      rows.push(row);
    }
    return rows;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ListFocusService);
    container = document.createElement('div');
    container.tabIndex = -1;
    document.body.appendChild(container);
  });

  afterEach(() => container.remove());

  describe('a removed row', () => {
    it('focuses whatever takes its place, so work continues where it was', () => {
      buildRows(5);
      service.noteRowRemoved(2);
      const rows = buildRows(4); // the row at index 2 is gone
      expect(service.restore(container)).toBe('row');
      expect(document.activeElement).toBe(rows[2]);
    });

    it('falls back to the LAST row when the removed one was last', () => {
      buildRows(3);
      service.noteRowRemoved(2);
      const rows = buildRows(2);
      service.restore(container);
      expect(document.activeElement).toBe(rows[1]);
    });
  });

  describe('a replaced set', () => {
    it('focuses the FIRST row — row 7 of a new sort is an unrelated record', () => {
      buildRows(5);
      service.noteSetReplaced();
      const rows = buildRows(5);
      expect(service.restore(container)).toBe('row');
      expect(document.activeElement).toBe(rows[0]);
    });
  });

  it('focuses the container when the new set is empty, never <body>', () => {
    buildRows(3);
    service.noteSetReplaced();
    buildRows(0);
    expect(service.restore(container)).toBe('container');
    expect(document.activeElement).toBe(container);
  });

  it('does nothing when the user has since focused something outside the list', () => {
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    buildRows(3);
    service.noteRowRemoved(0);
    buildRows(3);
    elsewhere.focus();

    expect(service.restore(container)).toBe('none');
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('does nothing at all when the rows changed with no one in the list', () => {
    buildRows(3);
    expect(service.restore(container)).toBe('none');
  });

  it('announces the change, because a silent focus jump is its own defect', (done) => {
    service.announce('List re-sorted.');
    setTimeout(() => {
      expect(service.announcement()).toBe('List re-sorted.');
      done();
    });
  });

  it('re-announces an identical message, which a live region otherwise swallows', (done) => {
    service.announce('Page changed.');
    setTimeout(() => {
      expect(service.announcement()).toBe('Page changed.');
      service.announce('Page changed.');
      // cleared first, so the region sees a change and speaks again
      expect(service.announcement()).toBe('');
      setTimeout(() => {
        expect(service.announcement()).toBe('Page changed.');
        done();
      });
    });
  });
});
