import { Component, Type, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { COMMITTEE_HEADER_GRID, COMMITTEE_PANEL_GRID } from './committee-panel-grid';

// ACC-232 — the committee page's two grids at 320px, a phone narrower than any
// column's minimum. Each host reads the page's own constant, never a copy, and
// sits in a stand-in for the shell's <main>: 16px of padding, scrolling on
// overflow, as the page does. "Scrolls sideways" is that <main> scrolling.
//
// NON-VACUITY FIRST (ACC-120): the host is laid out at the width asked for,
// and its cards are drawn, before "nothing scrolls sideways" means anything.

const MAIN = 'display: block; box-sizing: border-box; padding: 16px; overflow: auto';

@Component({
  standalone: true,
  template: `<main [style]="main" [style.width.px]="width()">
    <section class="grid gap-3" [style.grid-template-columns]="grid">
      <div class="min-w-0" style="grid-column: span 2"><div style="width: 260px; height: 40px"></div></div>
      <div class="min-w-0"><div style="width: 260px; height: 40px"></div></div>
    </section>
  </main>`,
})
class HeaderHost {
  readonly width = input(320);
  protected readonly main = MAIN;
  protected readonly grid = COMMITTEE_HEADER_GRID;
}

@Component({
  standalone: true,
  template: `<main [style]="main" [style.width.px]="width()">
    <section class="grid gap-3" [style.grid-template-columns]="grid">
      <div class="min-w-0"><div style="width: 230px; height: 40px"></div></div>
      <div class="min-w-0"><div style="width: 230px; height: 40px"></div></div>
    </section>
  </main>`,
})
class PanelHost {
  readonly width = input(320);
  protected readonly main = MAIN;
  protected readonly grid = COMMITTEE_PANEL_GRID;
}

async function measure(host: Type<HeaderHost | PanelHost>, width: number) {
  TestBed.configureTestingModule({ imports: [host] });
  const fixture = TestBed.createComponent(host);
  fixture.componentRef.setInput('width', width);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  const main = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('main')!;
  const grid = main.querySelector<HTMLElement>('section')!;
  const result = {
    main: { width: main.getBoundingClientRect().width, scrollWidth: main.scrollWidth, clientWidth: main.clientWidth },
    grid: grid.getBoundingClientRect(),
    cards: (Array.from(grid.children) as HTMLElement[]).map((c) => c.getBoundingClientRect()),
  };
  fixture.nativeElement.remove();
  return result;
}

describe('the committee page grids at 320px (ACC-232)', () => {
  it('the header grid: the page does not scroll sideways', async () => {
    const m = await measure(HeaderHost, 320);
    expect(m.main.width).withContext('the stand-in <main> not laid out at 320').toBe(320);
    expect(m.grid.width).withContext('the grid is the page less its padding').toBe(288);
    expect(m.cards.length).toBe(2);
    for (const c of m.cards) expect(c.width).withContext('a card not drawn').toBeGreaterThan(0);
    expect(m.main.scrollWidth).withContext('sideways scroll at 320').toBeLessThanOrEqual(m.main.clientWidth);
    // Known, not changed (reported in SYSTEM-REFERENCE §10.11): with one
    // column, the stepper's span 2 adds a second, empty track, so the card
    // reaches one gap (12px) past the grid, into <main>'s 16px padding. It
    // stays inside the padding, which is why nothing scrolls.
    expect(m.cards[1].right).withContext('the history card fits the grid').toBeLessThanOrEqual(m.grid.right + 0.5);
    expect(m.cards[0].right - m.grid.right).withContext("the stepper's bleed stays inside the padding").toBeLessThanOrEqual(16);
  });

  it('the panel grid: every panel fits, and the page does not scroll sideways', async () => {
    const m = await measure(PanelHost, 320);
    expect(m.main.width).withContext('the stand-in <main> not laid out at 320').toBe(320);
    expect(m.grid.width).toBe(288);
    for (const c of m.cards) {
      expect(c.width).withContext('a panel not drawn').toBeGreaterThan(0);
      expect(c.right).withContext('a panel past the grid').toBeLessThanOrEqual(m.grid.right + 0.5);
    }
    expect(m.main.scrollWidth).withContext('sideways scroll at 320').toBeLessThanOrEqual(m.main.clientWidth);
  });

  it('wide enough, the header still lays the stepper across two columns', async () => {
    const m = await measure(HeaderHost, 1100);
    expect(m.main.width).toBe(1100);
    expect(m.cards[0].width).withContext('the stepper spans two columns').toBeGreaterThan(m.cards[1].width);
    expect(m.main.scrollWidth).toBeLessThanOrEqual(m.main.clientWidth);
  });
});
