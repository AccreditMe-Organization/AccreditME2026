import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { USER_PANEL_GRID } from './user-panel-grid';

// ACC-232 — the user record's panel grid at 320px, narrower than its 330px
// minimum. The host reads the page's own constant, never a copy.
//
// NON-VACUITY FIRST (ACC-120): the host is laid out at the width asked for,
// and every panel is drawn, before "nothing scrolls sideways" means anything.

@Component({
  standalone: true,
  template: `<div class="grid gap-3" [style.width.px]="width()" [style.grid-template-columns]="grid" data-user-panels>
    <div class="min-w-0"><div style="width: 230px; height: 40px"></div></div>
    <div class="min-w-0"><div style="width: 230px; height: 40px"></div></div>
  </div>`,
})
class PanelsHost {
  readonly width = input(320);
  protected readonly grid = USER_PANEL_GRID;
}

describe('the user record panel grid (ACC-232)', () => {
  async function measure(width: number) {
    TestBed.configureTestingModule({ imports: [PanelsHost] });
    const fixture = TestBed.createComponent(PanelsHost);
    fixture.componentRef.setInput('width', width);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    const grid = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-user-panels]')!;
    const out = {
      width: grid.getBoundingClientRect().width,
      scrollWidth: grid.scrollWidth,
      clientWidth: grid.clientWidth,
      panels: (Array.from(grid.children) as HTMLElement[]).map((c) => c.getBoundingClientRect().width),
    };
    fixture.nativeElement.remove();
    return out;
  }

  it('at 320px every panel fits and nothing scrolls sideways', async () => {
    const m = await measure(320);
    expect(m.width).withContext('host not laid out at 320').toBe(320);
    expect(m.panels.length).toBe(2);
    for (const w of m.panels) {
      expect(w).withContext('a panel not drawn').toBeGreaterThan(0);
      expect(w).withContext('a panel wider than the page').toBeLessThanOrEqual(320);
    }
    expect(m.scrollWidth).withContext('sideways scroll at 320').toBeLessThanOrEqual(m.clientWidth);
  });

  it('wide enough, the panels still sit side by side', async () => {
    const m = await measure(900);
    expect(m.width).toBe(900);
    // Two 330px columns fit in 900, so neither panel takes the whole row.
    for (const w of m.panels) expect(w).toBeLessThan(900);
  });
});
