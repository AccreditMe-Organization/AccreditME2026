import { Component, TemplateRef, ViewChild, inject, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { EditDialogComponent } from '../edit-dialog/edit-dialog.component';
import { LayerStackService } from '../../overlay/layer-stack.service';
import { AmConfirmService } from './am-confirm.service';
import { ConfirmHostComponent } from './confirm-host.component';

/**
 * ACC-120 slice 10 — ONE ESCAPE CLOSES ONLY THE CONFIRM, never the dialog it
 * was asked from.
 *
 * The Vacate Head case, measured before this slice: the Head panel is an edit
 * dialog, its Vacate Head button opened a confirm that held no layer, so the
 * panel was still the top layer and one Escape closed the confirm AND the
 * panel. Only edit-dialog's own discard confirm pushed a layer. ask() now
 * pushes one for every confirm.
 *
 * The panel here is a plain edit dialog with a Vacate button, NOT dirty, so a
 * regression shows as the dialog closing (a dirty one would ask "Discard
 * changes?" instead, which hides the defect behind a second confirm).
 */
@Component({
  standalone: true,
  imports: [EditDialogComponent, ConfirmHostComponent],
  template: `
    <ng-template #panelTpl>
      <button id="vacate" type="button" (click)="vacate()">Vacate Head</button>
    </ng-template>
    <app-edit-dialog [(visible)]="panelOpen" header="Head of Cardiology" [content]="panelTpl" />
    <am-confirm-host />
  `,
})
class HeadPanelHost {
  @ViewChild('panelTpl', { read: TemplateRef, static: true }) panelTpl!: TemplateRef<unknown>;
  private readonly confirm = inject(AmConfirmService);
  readonly panelOpen = signal(true);
  readonly vacated = signal(false);

  vacate(): void {
    this.confirm.ask({
      tone: 'destructive',
      header: 'Vacate the Head of Cardiology?',
      message: 'The unit will have no Head until one is appointed.',
      acceptLabel: 'Vacate Head',
      accept: () => this.vacated.set(true),
    });
  }
}

describe('a confirm over an edit dialog — the Vacate Head case (ACC-120 slice 10)', () => {
  let fixture: ComponentFixture<HeadPanelHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HeadPanelHost],
      providers: [provideTranslateService({ lang: 'en' }), providePrimeNG({}), ConfirmationService],
    });
    TestBed.inject(TranslateService).setTranslation('en', { common: { cancel: 'Cancel', close: 'Close' } });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(HeadPanelHost);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.querySelectorAll('.p-confirmdialog, .p-dialog, .p-dialog-mask').forEach((n) => n.remove());
  });

  const confirmEl = (): Element | null => document.querySelector('.p-confirmdialog');
  const panelContent = (): Element | null => document.getElementById('vacate');

  // ACC-248 — bounded by polling TURNS, not by the wall clock. What this waits
  // for (PrimeNG's enter and leave motion, then focus) runs on CSS time, and
  // a loaded machine stretched it past the old 2 s budget: "timed out waiting
  // for the confirm to open" (20 Oct). Counting turns still catches a hang,
  // but a slow machine is no longer mistaken for one.
  async function until(condition: () => boolean, what: string, turns = 100): Promise<void> {
    for (let turn = 0; !condition(); turn++) {
      if (turn >= turns) throw new Error(`timed out waiting for ${what}`);
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  function escape(): void {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  }

  async function openConfirm(): Promise<void> {
    await until(() => !!panelContent(), 'the Head panel to render');
    // A real click focuses the button first; a scripted one does not.
    (panelContent() as HTMLElement).focus();
    (panelContent() as HTMLElement).click();
    await until(() => !!confirmEl() && confirmEl()!.contains(document.activeElement), 'the confirm to open');
  }

  // NON-VACUITY FIRST: the panel is open and is the top layer before the
  // confirm, and Escape on its own does close it — otherwise "the panel is
  // still open" below would prove nothing.
  it('without a confirm, one Escape does close the panel', async () => {
    await until(() => !!panelContent(), 'the Head panel to render');
    expect(TestBed.inject(LayerStackService).depth()).toBe(1);
    (panelContent() as HTMLElement).focus();
    escape();
    await until(() => !fixture.componentInstance.panelOpen(), 'the panel to close');
    expect(fixture.componentInstance.panelOpen()).toBeFalse();
  });

  it('with the confirm open, one Escape closes only the confirm', async () => {
    await openConfirm();
    expect(TestBed.inject(LayerStackService).depth()).toBe(2);

    escape();
    await until(() => !confirmEl(), 'the confirm to close');
    await new Promise((r) => setTimeout(r, 50));
    fixture.detectChanges();

    expect(fixture.componentInstance.panelOpen()).withContext('the Head panel stays open').toBeTrue();
    expect(panelContent()).withContext('its content is still rendered').not.toBeNull();
    expect(fixture.componentInstance.vacated()).withContext('Escape is a cancel, not a vacate').toBeFalse();
    expect(TestBed.inject(LayerStackService).depth()).toBe(1);
    expect(document.activeElement).withContext('focus is back on Vacate Head').toBe(panelContent());
  });

  it('and the next Escape then closes the panel', async () => {
    await openConfirm();
    escape();
    await until(() => !confirmEl(), 'the confirm to close');
    await new Promise((r) => setTimeout(r, 50));
    escape();
    await until(() => !fixture.componentInstance.panelOpen(), 'the panel to close');
    expect(fixture.componentInstance.panelOpen()).toBeFalse();
  });
});
