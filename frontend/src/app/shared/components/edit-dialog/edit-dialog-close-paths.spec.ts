// ACC-96 — every close path asks the same question.
//
// "Unsaved changes are confirmed" is one of template 3's settled promises, and
// it was kept on ONE of the three ways out. Escape and the header's ✕ both
// arrive at requestClose(); a caller's Cancel went straight to visible=false
// and discarded a part-filled task without a word — found by Ahmad in a
// browser, on the New Task dialog.
//
// BOTH DIRECTIONS on each path, because a dialog that always asks is its own
// defect: a user who opened a form, changed nothing and pressed Cancel should
// not be interrogated about work they did not do.
import { Component, TemplateRef, ViewChild } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ConfirmationService, Confirmation } from 'primeng/api';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { EditDialogComponent } from './edit-dialog.component';

@Component({
  standalone: true,
  imports: [EditDialogComponent],
  template: `
    <ng-template #formTpl>
      <p>a form</p>
    </ng-template>
    <!-- Cancel routed the way the task form routes it: through the dialog,
         not straight to the visible flag. -->
    <button type="button" class="host-cancel" (click)="dialog.requestClose()">Cancel</button>
    <app-edit-dialog
      #dialog
      [visible]="visible"
      (visibleChange)="visible = $event"
      header="Test"
      [dirty]="dirty"
      [content]="formTpl"
    />
  `,
})
class CloseHostComponent {
  visible = true;
  dirty = false;
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
  @ViewChild(EditDialogComponent) dialog!: EditDialogComponent;
}

describe('EditDialogComponent — close paths (ACC-96)', () => {
  let fixture: ComponentFixture<CloseHostComponent>;
  let host: CloseHostComponent;
  let confirmSpy: jasmine.Spy;

  const cancel = (): void => {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.host-cancel')!.click();
    fixture.detectChanges();
  };

  const closeButton = (): HTMLElement =>
    document.querySelector<HTMLElement>('.p-dialog-header button')!;

  const escape = (): void => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  };

  /** Runs whatever the confirm was asked to do when the user accepts. */
  const acceptDiscard = (): void => {
    const request = confirmSpy.calls.mostRecent().args[0] as Confirmation;
    request.accept?.();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CloseHostComponent],
      providers: [
        ConfirmationService,
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CloseHostComponent);
    host = fixture.componentInstance;
    confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    fixture.detectChanges();
  });

  // ── Clean: nothing to lose, so nothing to ask ───────────────────────────

  it('Cancel closes a CLEAN form immediately', () => {
    cancel();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(host.visible).toBe(false);
  });

  it('the header ✕ closes a CLEAN form immediately', () => {
    closeButton().click();
    fixture.detectChanges();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(host.visible).toBe(false);
  });

  it('Escape closes a CLEAN form immediately', () => {
    escape();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(host.visible).toBe(false);
  });

  // ── Dirty: all three ask, and none closes until the answer ──────────────

  it('Cancel ASKS on a dirty form, and does not close until discard is chosen', () => {
    host.dirty = true;
    fixture.detectChanges();

    cancel();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(host.visible)
      .withContext('still open while the question is on screen')
      .toBe(true);

    acceptDiscard();
    expect(host.visible).toBe(false);
  });

  it('the header ✕ ASKS on a dirty form', () => {
    host.dirty = true;
    fixture.detectChanges();

    closeButton().click();
    fixture.detectChanges();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(host.visible).toBe(true);
  });

  it('Escape ASKS on a dirty form', () => {
    host.dirty = true;
    fixture.detectChanges();

    escape();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(host.visible).toBe(true);
  });

  // The spec that would have caught the ✕ defect: p-dialog's own close button
  // hides it internally, so asserting the HOST flag alone said "still open"
  // while the form had already vanished from the page.
  it('leaves the form RENDERED while the question is on screen, whichever path asked', () => {
    host.dirty = true;
    fixture.detectChanges();

    const rendered = (): boolean =>
      !!document.querySelector('.p-dialog-content') || !!document.querySelector('.p-dialog');

    closeButton().click();
    fixture.detectChanges();
    expect(rendered())
      .withContext('the ✕ must not close the dialog before the answer')
      .toBe(true);

    (confirmSpy.calls.mostRecent().args[0] as Confirmation).reject?.();
    fixture.detectChanges();
    expect(rendered()).toBe(true);
    expect(host.visible).toBe(true);
  });

  it('keeps the form open when the user chooses to keep editing', () => {
    host.dirty = true;
    fixture.detectChanges();

    cancel();
    const request = confirmSpy.calls.mostRecent().args[0] as Confirmation;
    request.reject?.();
    fixture.detectChanges();

    expect(host.visible).toBe(true);
  });

  it('asks the SAME question whichever way out was taken', () => {
    host.dirty = true;
    fixture.detectChanges();

    cancel();
    const fromCancel = confirmSpy.calls.mostRecent().args[0] as Confirmation;
    // Release it before trying the next path. While a confirm is open it owns
    // the top layer, so Escape is correctly ignored — which is itself the
    // one-layer-per-press rule, and is why this cannot simply press twice.
    fromCancel.reject?.();
    fixture.detectChanges();

    confirmSpy.calls.reset();
    escape();
    const fromEscape = confirmSpy.calls.mostRecent().args[0] as Confirmation;

    // One wording, because there is one question. Three paths that each
    // phrased it themselves is how they drift.
    expect(fromCancel.header).toBe(fromEscape.header);
    expect(fromCancel.message).toBe(fromEscape.message);
    expect(fromCancel.acceptLabel).toBe(fromEscape.acceptLabel);
  });
});
