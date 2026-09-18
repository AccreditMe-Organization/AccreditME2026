import { Component, TemplateRef, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { SelectModule } from 'primeng/select';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { EditDialogComponent } from './edit-dialog.component';

/**
 * The rest of the ACC-41 class: a PrimeNG overlay open inside one of our
 * dialogs.
 *
 * `OverlaySelectComponent` was the sibling we found by accident. It is not the
 * only one — every PrimeNG overlay closes itself on Escape from its own
 * listener bound on `document` in the BUBBLE phase, which the dialog shell's
 * capture-phase listener now beats. There are 12 such overlays reachable
 * inside dialogs today (npm run check:dialog-overlays), and each would close
 * the dialog, or ask about unsaved work, when the user meant to close a
 * dropdown.
 *
 * We cannot register a PrimeNG overlay with LayerStackService — PrimeNG builds
 * it and we do not get a hook. So the shell DEFERS instead: if any foreign
 * overlay panel is open, Escape is not ours.
 */
@Component({
  standalone: true,
  imports: [EditDialogComponent, SelectModule, FormsModule, ConfirmDialogModule],
  template: `
    <ng-template #formTpl>
      <p-select [options]="options" optionLabel="label" optionValue="value" [(ngModel)]="picked" />
    </ng-template>
    <app-edit-dialog
      [visible]="visible"
      (visibleChange)="visible = $event"
      [content]="formTpl"
      [dirty]="true"
      header="Form with a PrimeNG select"
    />
    <!-- The app shell renders one of these permanently. If its CLOSED host
         counted as an open overlay, no dialog would ever close on Escape. -->
    <p-confirmDialog />
  `,
})
class DialogWithPrimeSelectHost {
  visible = false;
  picked: string | null = null;
  options = [
    { label: 'Quality Manager', value: 'qm' },
    { label: 'Quality Officer', value: 'qo' },
  ];
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
}

describe('EditDialogComponent with a PrimeNG overlay open (ACC-111)', () => {
  let fixture: ComponentFixture<DialogWithPrimeSelectHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DialogWithPrimeSelectHost],
      providers: [
        ConfirmationService,
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogWithPrimeSelectHost);
    fixture.componentInstance.visible = true;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const openSelect = async (): Promise<void> => {
    const trigger = document.querySelector('.p-select') as HTMLElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const selectPanel = (): HTMLElement | null => document.querySelector('.p-select-overlay');

  it('opens the PrimeNG panel', async () => {
    await openSelect();
    expect(selectPanel()).toBeTruthy();
  });

  it('leaves Escape to the open dropdown rather than asking about unsaved work', async () => {
    await openSelect();
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');

    // As the user produces it: from inside the overlay, bubbling.
    const target = (selectPanel()?.querySelector('li') ??
      document.activeElement ??
      document.body) as HTMLElement;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.visible).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  // The failure mode of the fix itself: a permanently rendered but CLOSED
  // ConfirmDialog must not read as an open overlay.
  it('is not blocked by an always-present but CLOSED confirm dialog', async () => {
    expect(document.querySelector('p-confirmdialog')).toBeTruthy();
    expect(document.querySelector('.p-confirmdialog')).toBeNull();

    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('takes Escape back once no foreign overlay is open', async () => {
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(confirmSpy).toHaveBeenCalled();
  });
});
