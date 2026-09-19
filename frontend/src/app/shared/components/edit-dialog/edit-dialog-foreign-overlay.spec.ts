import { Component, TemplateRef, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
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
  imports: [EditDialogComponent, SelectModule, FormsModule, ConfirmDialogModule, DatePickerModule],
  template: `
    <ng-template #formTpl>
      <p-select [options]="options" optionLabel="label" optionValue="value" [(ngModel)]="picked" />
      <p-datepicker [(ngModel)]="when" />
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
  when: Date | null = null;
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

    // As the user produces it: from the FOCUSED element. PrimeNG keeps focus
    // on the select's trigger and drives the list with aria-activedescendant,
    // so that is where a real Escape lands — and where its own handler is
    // bound. Dispatching from an <li> inside the panel instead bypasses
    // PrimeNG entirely and proves nothing.
    // A REAL keystroke carries both `key` and `code`, and PrimeNG's Select
    // switches on event.CODE. A synthetic event with only `key` set sails past
    // its handler untouched — which looked exactly like the implementation
    // failing, and cost an hour of chasing the wrong thing.
    const target = document.querySelector('.p-select [role="combobox"]') as HTMLElement;
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.visible).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  // The case the defaultPrevented rule actually carries. p-select STOPS
  // propagation, so the event never reaches the dialog at all; p-datepicker
  // only calls preventDefault, so the event does arrive and the dialog has to
  // recognise that something already consumed it. Five of these sit inside
  // dialogs today.
  it('leaves Escape to an open date picker, which only preventDefaults', async () => {
    const input = document.querySelector('p-datepicker input') as HTMLElement;
    input.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(document.querySelector('.p-datepicker-panel')).toBeTruthy();

    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true } as KeyboardEventInit),
    );
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
