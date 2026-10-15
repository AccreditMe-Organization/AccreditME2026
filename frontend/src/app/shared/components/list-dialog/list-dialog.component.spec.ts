import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { LayerStackService } from '../../overlay/layer-stack.service';
import { RowMenuComponent } from '../row-menu/row-menu.component';
import { ListDialogComponent } from './list-dialog.component';

// ACC-229 — the list dialog shell and the row menu inside it. ESCAPE BELONGS
// TO THE TOP LAYER ONLY: an open ⋯ menu inside the popup takes the first
// Escape, the popup the second. The menu closes itself on Escape before the
// event bubbles, so a popup listening in the bubble phase would ALSO close on
// that same keypress — which is why it listens in the capture phase.

@Component({
  standalone: true,
  imports: [ListDialogComponent, RowMenuComponent],
  template: `
    <button type="button" id="opener" (click)="open.set(true)">See all</button>
    <ng-template #body>
      <input id="search" type="search" />
      <am-row-menu [groups]="[[{ id: 'open', label: 'Open task' }]]" label="Actions for Task 1" (picked)="picked = $event" />
    </ng-template>
    <am-list-dialog [visible]="open()" [size]="size()" heading="All tasks · Quality" closeLabel="Close all tasks" [body]="body" (closeRequested)="closes = closes + 1; open.set(false)" />
  `,
})
class HostComponent {
  readonly open = signal(false);
  readonly size = signal<'list' | 'compact'>('list');
  closes = 0;
  picked = '';
}

describe('ListDialogComponent and the row menu inside it (ACC-229)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let layers: LayerStackService;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' })] });
    layers = TestBed.inject(LayerStackService);
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.autoDetectChanges(true);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.componentInstance.open.set(false);
    fixture.nativeElement.remove();
    document.querySelectorAll('.p-dialog-mask, .cdk-overlay-container').forEach((n) => n.remove());
  });

  const escape = (target: EventTarget) =>
    // keyCode too: the CDK menu reads keyCode, not key.
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));

  async function openDialog(): Promise<void> {
    (document.getElementById('opener') as HTMLButtonElement).focus();
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
  }

  it('is a named dialog and a LAYER while open', async () => {
    await openDialog();
    const frame = document.querySelector('[data-testid="list-dialog"]')!;
    expect(frame.getAttribute('role')).toBe('dialog');
    expect(frame.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(frame.getAttribute('aria-labelledby')!)!.textContent).toBe('All tasks · Quality');
    expect(layers.depth()).toBe(1);
  });

  it('Escape with the row menu open closes the MENU, not the popup; the next Escape closes the popup', async () => {
    await openDialog();
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="row-menu-trigger"]')!;
    trigger.click();
    await fixture.whenStable();
    const menu = document.querySelector('[data-testid="row-menu"]')!;
    expect(menu).withContext('the menu did not open').not.toBeNull();
    expect(layers.depth()).withContext('the menu is a layer above the popup').toBe(2);

    escape(menu.querySelector('button')!);
    await fixture.whenStable();
    expect(document.querySelector('[data-testid="row-menu"]')).withContext('the menu closed').toBeNull();
    expect(fixture.componentInstance.closes).withContext('the popup stayed open').toBe(0);
    expect(layers.depth()).toBe(1);

    escape(document.activeElement ?? document.body);
    await fixture.whenStable();
    expect(fixture.componentInstance.closes).toBe(1);
  });

  // ACC-229, found live: the list focused its search box on its first render,
  // before the dialog was in the page, so nothing held focus once it opened and
  // the shell fell back to its frame. The shell now focuses the search box
  // itself, when the dialog has finished opening.
  it('once open, focus is in the search box — not on the frame', async () => {
    // PrimeNG says "shown" only after its own enter motion, so wait for that —
    // up to two seconds — rather than for a guessed delay.
    const dialog = fixture.debugElement.query((d) => d.componentInstance instanceof ListDialogComponent)!
      .componentInstance as ListDialogComponent;
    const shown = spyOn(dialog, 'shown').and.callThrough();
    await openDialog();
    for (let i = 0; i < 40 && shown.calls.count() === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(shown).withContext('the dialog never finished opening').toHaveBeenCalled();
    expect(document.activeElement?.id).withContext(`focus is on ${document.activeElement?.tagName}`).toBe('search');
  });

  it("focus the body already placed (a deep link's row) is left where it is", async () => {
    await openDialog();
    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="row-menu-trigger"]')!;
    trigger.focus();
    const dialog = fixture.debugElement.query((d) => d.componentInstance instanceof ListDialogComponent)!
      .componentInstance as ListDialogComponent;
    dialog.shown();
    expect(document.activeElement).toBe(trigger);
  });

  it('the body is rebuilt on every open, so it opens on its defaults', async () => {
    await openDialog();
    (document.getElementById('search') as HTMLInputElement).value = 'ventilator';
    fixture.componentInstance.open.set(false);
    await fixture.whenStable();
    await openDialog();
    expect((document.getElementById('search') as HTMLInputElement).value).toBe('');
  });

  it('below 760px wide it is a full-screen sheet; above, 1040 × 760 or the window less 96', () => {
    const dialog = fixture.debugElement.query((d) => d.componentInstance instanceof ListDialogComponent)!
      .componentInstance as ListDialogComponent;
    dialog.sheet.set(true);
    expect(dialog.frameStyle()).toEqual(jasmine.objectContaining({ width: '100vw', height: '100vh' }));
    dialog.sheet.set(false);
    expect(dialog.frameStyle()).toEqual(
      jasmine.objectContaining({ width: 'min(1040px, calc(100vw - 96px))', height: 'min(760px, calc(100vh - 96px))' }),
    );
    // ACC-230 — the compact size, for a plain searchable list (All members).
    fixture.componentInstance.size.set('compact');
    fixture.detectChanges();
    expect(dialog.frameStyle()).toEqual(
      jasmine.objectContaining({ width: 'min(720px, calc(100vw - 96px))', height: 'min(560px, calc(100vh - 96px))' }),
    );
  });
});
