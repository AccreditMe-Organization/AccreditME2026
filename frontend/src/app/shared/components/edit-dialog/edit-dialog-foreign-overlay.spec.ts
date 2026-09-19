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


/**
 * The INLINE case, and the third time on this branch that a spec passed while
 * the screen was broken: the suite above exercises the four preventDefault
 * components in OVERLAY mode, where deferring is correct. An inline datepicker
 * marks Escape handled, closes nothing (it has no overlay), and refocuses its
 * own grid — so the layer that owns the keystroke never answered it, and the
 * calendar dialog could not be closed from inside the date cells.
 *
 * Two stacked dialogs, exactly as Add Holiday builds them.
 */
@Component({
  standalone: true,
  imports: [EditDialogComponent, DatePickerModule, FormsModule],
  template: `
    <ng-template #formTpl><input id="form-field" /></ng-template>
    <ng-template #calendarTpl>
      <p-datepicker [inline]="true" [(ngModel)]="when" />
    </ng-template>
    <app-edit-dialog
      [visible]="formVisible"
      (visibleChange)="formVisible = $event"
      [content]="formTpl"
      header="Add holiday"
    />
    <app-edit-dialog
      [visible]="calendarVisible"
      (visibleChange)="calendarVisible = $event"
      [content]="calendarTpl"
      size="picker"
      appendTo="body"
      header="Choose a date"
    />
  `,
})
class StackedInlineCalendarHost {
  formVisible = false;
  calendarVisible = false;
  when: Date | null = null;
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
  @ViewChild('calendarTpl', { read: TemplateRef, static: true }) calendarTpl!: TemplateRef<unknown>;
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

  /**
   * PINS A PREMISE WE DO NOT OWN. See SYSTEM-REFERENCE §10.12.
   *
   * Since the `defaultPrevented` guard was removed, `p-select` and
   * `p-multiselect` are kept from closing the dialog behind them by ONE thing:
   * PrimeNG's own `stopPropagation` on Escape. Nothing in our code depends on
   * it, nothing enforces it, and the day an upgrade drops it every select in
   * every dialog starts closing the dialog too — silently, with a green suite.
   *
   * NOT REDUNDANT with "leaves Escape to the open dropdown" above, which
   * asserts only that the dialog SURVIVES. A dialog also survives if the
   * keystroke reached nobody at all. This asserts the other half — the panel
   * genuinely closed — so the two together say the event was consumed by
   * PrimeNG and stopped there. Deleting either leaves the premise unpinned.
   *
   * It is meant to fail on an upgrade PR, which is the only day anyone can act
   * on it. A future reader seeing it go red should read §10.12 before touching
   * this file: the fix is in the dialog shell, not in this expectation.
   *
   * MUTATION-PROVEN, and the result matters for which line survives edits.
   * Neutering `KeyboardEvent.prototype.stopPropagation` — what an upgrade that
   * drops it looks like from here — fails this spec on the CONFIRM assertion,
   * not on `visible`. The dialog stays visible in that run only because
   * `confirm` is stubbed and never answers; in the real app the user gets a
   * discard prompt they did not ask for. So the confirm line is the one doing
   * the work, and dropping it as noise disarms the pin.
   */
  it('lets p-select close its own list and stop there: panel gone, dialog open', async () => {
    await openSelect();
    expect(selectPanel()).toBeTruthy();

    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    const target = document.querySelector('.p-select [role="combobox"]') as HTMLElement;
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(selectPanel()).toBeNull();
    expect(fixture.componentInstance.visible).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  // CHANGED DELIBERATELY. A floating panel inside a dialog is the
  // configuration artboard 7 forbids and check:dialog-overlays counts down to
  // zero; while one remains, Escape closes both it and the dialog. That is
  // accepted as the lesser defect: the alternative — trusting defaultPrevented
  // — left the Add Holiday calendar dialog unclosable from inside its own
  // date cells, because an INLINE component marks Escape handled without
  // having anything to close. p-select is unaffected either way: it stops
  // propagation, so the event never reaches the dialog at all.
  it('closes the dialog as well when a floating panel inside it consumes Escape', async () => {
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

    // The panel closed itself; the dialog asked about its unsaved work.
    expect(confirmSpy).toHaveBeenCalled();
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


describe('EditDialogComponent with an INLINE datepicker stacked above it (ACC-111)', () => {
  let fixture: ComponentFixture<StackedInlineCalendarHost>;

  const escapeFrom = (el: Element): void => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true } as KeyboardEventInit),
    );
    fixture.detectChanges();
  };

  const dialogCount = (): number => document.querySelectorAll('.p-dialog').length;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StackedInlineCalendarHost],
      providers: [
        ConfirmationService,
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StackedInlineCalendarHost);
    fixture.componentInstance.formVisible = true;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.calendarVisible = true;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('opens both layers, with the inline calendar in the top one', () => {
    expect(dialogCount()).toBe(2);
    expect(document.querySelector('.p-datepicker-panel')).toBeTruthy();
  });

  // The reported defect: Escape from inside the date grid did nothing, because
  // the inline datepicker had marked the event handled.
  it('closes the calendar on Escape pressed INSIDE the date grid', async () => {
    const dateCell =
      document.querySelector('.p-datepicker-panel td span') ??
      document.querySelector('.p-datepicker-panel');
    expect(dateCell).toBeTruthy();

    escapeFrom(dateCell!);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.calendarVisible).toBe(false);
    expect(fixture.componentInstance.formVisible).toBe(true);
  });

  it('closes exactly ONE layer per press: the form dialog survives, then closes', async () => {
    const dateCell = document.querySelector('.p-datepicker-panel td span')!;
    escapeFrom(dateCell);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.formVisible).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.formVisible).toBe(false);
  });
});
