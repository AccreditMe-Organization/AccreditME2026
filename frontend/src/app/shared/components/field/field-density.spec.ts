// ACC-120 slice 2 — compact density, and the two things about it that are
// structural rather than stylistic.
//
// Nine more ACC-120 slices will copy whatever this establishes, so the tests
// that matter most here are not "does compact look smaller" but:
//
//   1. a field OUTSIDE a dialog cannot become compact, whatever anyone writes;
//   2. a field that declared it can never message, and then messages, fails
//      loudly instead of silently growing a slot back.
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  TranslateNoOpLoader,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { FieldComponent } from './field.component';
import { DIALOG_DENSITY, DialogDensity } from '../edit-dialog/dialog-density';

@Component({
  standalone: true,
  imports: [FieldComponent, ReactiveFormsModule],
  template: `
    <am-field label="Acting head" [control]="control" [message]="message">
      <input id="probe" type="text" [formControl]="control" />
    </am-field>
  `,
})
class HostComponent {
  readonly control = new FormControl('');
  message: 'reserved' | 'none' = 'reserved';
}

function setup(density?: DialogDensity): ComponentFixture<HostComponent> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostComponent],
    // Only EditDialogComponent provides this in the real app. Supplying it here
    // is how a test stands in for "this field is inside a dialog"; OMITTING it
    // is what a field on a page actually experiences.
    providers: [
      provideTranslateService({
        lang: 'en',
        loader: provideTranslateLoader(TranslateNoOpLoader),
      }),
      ...(density ? [{ provide: DIALOG_DENSITY, useValue: signal(density) }] : []),
    ],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

const fieldEl = (f: ComponentFixture<HostComponent>): HTMLElement =>
  f.nativeElement.querySelector('.am-field');

describe('am-field — compact density (ACC-120 slice 2)', () => {
  it('is form density inside a dialog that did not ask for compact', () => {
    const fixture = setup('form');

    expect(fieldEl(fixture).classList).not.toContain('am-field--compact');
  });

  it('is compact inside a dialog that declared it', () => {
    const fixture = setup('compact');

    expect(fieldEl(fixture).classList).toContain('am-field--compact');
  });

  // THE STRUCTURAL GUARANTEE, and the reason density travels by DI rather than
  // by a data- attribute anyone could write. Artboard 13 forbids compact on
  // pages, record panels and settings sections — they are read far more than
  // edited and have no 420px cap to defend. A field with no dialog above it
  // cannot inject the token, so it cannot be compact even by mistake.
  //
  // This is what the workflow stage and transition editors depend on: they are
  // page panels, not dialogs, and so is the permissions matrix.
  it('CANNOT be compact outside a dialog, because nothing else provides the token', () => {
    const fixture = setup(undefined);

    expect(fieldEl(fixture).classList).not.toContain('am-field--compact');
  });

  describe('the message slot', () => {
    it('is reserved by default, so an appearing message never moves the form', () => {
      const fixture = setup('compact');

      expect(
        fixture.nativeElement.querySelector('.am-field__message'),
      ).not.toBeNull();
    });

    // The largest single saving in compact density (a block drops 79 -> 52
    // rather than 79 -> 71) and it costs nothing: a slot reserved for a message
    // that cannot happen is pure whitespace.
    it('is absent entirely when the field declared it can never message', () => {
      const fixture = setup('compact');
      fixture.componentInstance.message = 'none';
      fixture.detectChanges();

      expect(
        fixture.nativeElement.querySelector('.am-field__message'),
      ).toBeNull();
    });

    // Artboard 13's added clause, enforced rather than written down. Without
    // it, removing the slot moves the layout jump from every form to the rare
    // one — which is worse, because it happens exactly when the user is already
    // being told something went wrong.
    it('THROWS in development if a field that declared none produces a message', () => {
      const fixture = setup('compact');
      fixture.componentInstance.message = 'none';
      fixture.detectChanges();

      // The real user path, not a synthetic flag: type, then leave the field.
      // showError() deliberately needs dirty + blurred, because a dialog
      // focusing its first field must not accuse the user of leaving it empty.
      const control = fixture.componentInstance.control;
      control.setErrors({ required: true });
      control.markAsDirty();
      fixture.nativeElement
        .querySelector('.am-field')
        .dispatchEvent(new Event('focusout', { bubbles: true }));

      expect(() => fixture.detectChanges()).toThrowError(
        /declared message="none" but produced an error message/,
      );
    });
  });
});
