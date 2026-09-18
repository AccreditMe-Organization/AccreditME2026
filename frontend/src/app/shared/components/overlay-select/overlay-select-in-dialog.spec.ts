import { Component, TemplateRef, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EditDialogComponent } from '../edit-dialog/edit-dialog.component';
import { OverlaySelectComponent } from './overlay-select.component';

/**
 * A dropdown open INSIDE a dirty dialog — the collision ACC-111's Escape
 * contract created and this spec exists to keep closed.
 *
 * ACC-41 made `OverlaySelectComponent` swallow Escape by calling
 * stopPropagation() inside CDK's `body` listener, which beat PrimeNG's own
 * `document` listener because body comes first in the BUBBLE chain. ACC-111
 * then gave the dialog shell a `document` listener in the CAPTURE phase — and
 * capture runs before any bubble listener anywhere, so that reasoning stopped
 * holding the moment the shell landed. Escape on an open dropdown asked
 * "Discard changes?" about the form behind it.
 *
 * The fix is the layer stack, not another ordering trick: the dropdown is a
 * dismissable layer, so it registers like one, and the dialog defers to it.
 */
@Component({
  standalone: true,
  imports: [EditDialogComponent, OverlaySelectComponent, FormsModule],
  template: `
    <ng-template #formTpl>
      <app-overlay-select
        [options]="options"
        optionLabel="label"
        optionValue="value"
        [(ngModel)]="picked"
        placeholder="Pick one"
      />
    </ng-template>
    <app-edit-dialog
      [visible]="visible"
      (visibleChange)="visible = $event"
      [content]="formTpl"
      [dirty]="true"
      header="Form with a dropdown"
    />
  `,
})
class DialogWithSelectHost {
  visible = false;
  picked: string | null = null;
  options = [
    { label: 'Quality Manager', value: 'qm' },
    { label: 'Quality Officer', value: 'qo' },
  ];
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
}

describe('OverlaySelectComponent inside a dialog (ACC-111 Escape contract)', () => {
  let fixture: ComponentFixture<DialogWithSelectHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DialogWithSelectHost],
      providers: [
        ConfirmationService,
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogWithSelectHost);
    fixture.componentInstance.visible = true;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  const openDropdown = async (): Promise<void> => {
    const trigger = fixture.nativeElement.querySelector(
      'app-overlay-select [role="combobox"], app-overlay-select button, app-overlay-select div[tabindex]',
    ) as HTMLElement;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const panel = (): HTMLElement | null =>
    document.querySelector('.am-overlay-select-overlay-panel');

  /**
   * Escape as a USER produces it: from the focused element inside the overlay,
   * bubbling. Dispatching on `document` instead would skip CDK's body listener
   * entirely and quietly prove nothing.
   */
  const escapeFromOverlay = (): void => {
    const target = (panel()?.querySelector('[tabindex], input') ??
      document.activeElement ??
      document.body) as HTMLElement;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
  };

  it('opens its panel inside the dialog', async () => {
    await openDropdown();
    expect(panel()).toBeTruthy();
  });

  it('Escape closes the DROPDOWN, not the dialog, and asks nothing about unsaved work', async () => {
    await openDropdown();
    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');

    escapeFromOverlay();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(panel()).toBeNull();
    expect(fixture.componentInstance.visible).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('hands Escape back to the dialog once the dropdown is closed', async () => {
    await openDropdown();
    escapeFromOverlay();
    await fixture.whenStable();
    fixture.detectChanges();

    const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(confirmSpy).toHaveBeenCalled();
  });
});
