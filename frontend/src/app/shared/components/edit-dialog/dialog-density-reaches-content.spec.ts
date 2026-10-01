// ACC-120 slice 5 — does the density SETTING ARRIVE, not does the field obey it.
//
// field-density.spec.ts already proves the second, by providing DIALOG_DENSITY
// straight to TestBed. That is a useful test and it cannot catch this bug: it
// skips the only path that ships. In the real app the token is provided by
// EditDialogComponent, and the field sits inside a TemplateRef declared in the
// HOST's template — so the embedded view resolved against the host's injector,
// where nothing provides the token, and every field quietly fell back to form
// density however the dialog was configured.
//
// So this spec does it the long way round, deliberately: a real host declaring a
// real <ng-template>, handed to a real EditDialogComponent, rendered for real.
// Nothing is provided at TestBed level. If the wiring regresses, these fail.
//
// MUTATION-TESTED, which is the only thing that makes them worth having:
// removing `injector: injector` from the content outlet in
// edit-dialog.component.ts turns the compact expectations red and leaves the
// form-density ones green — exactly the asymmetry the bug had.
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import {
  TranslateNoOpLoader,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { EditDialogComponent } from './edit-dialog.component';
import { FieldComponent } from '../field/field.component';
import type { DialogDensity } from './dialog-density';

@Component({
  standalone: true,
  imports: [EditDialogComponent, FieldComponent, ReactiveFormsModule],
  template: `
    <!-- Declared HERE, in the host, which is the whole point: this is the
         injector the embedded view used to resolve against. -->
    <ng-template #formTpl>
      <am-field label="Name" [control]="control">
        <input id="probe" type="text" [formControl]="control" />
      </am-field>
    </ng-template>

    <app-edit-dialog
      [visible]="true"
      header="Probe"
      [content]="formTpl"
      [density]="density()"
    />
  `,
})
class HostComponent {
  readonly control = new FormControl('');
  readonly density = signal<DialogDensity>('form');
}

function setup(density: DialogDensity): ComponentFixture<HostComponent> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostComponent],
    // DELIBERATELY NOT PROVIDING DIALOG_DENSITY. If this spec provided it, it
    // would pass against the broken code and prove nothing — which is precisely
    // how the gap survived. The dialog must supply it on its own.
    providers: [
      provideTranslateService({
        lang: 'en',
        loader: provideTranslateLoader(TranslateNoOpLoader),
      }),
      // Infrastructure the dialog needs to construct at all (its discard
      // prompt), not part of what is under test here.
      ConfirmationService,
    ],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.density.set(density);
  fixture.detectChanges();
  return fixture;
}

// The dialog appends to the body, so the field is not under the fixture's own
// element. Querying the document is what the real DOM looks like.
const field = (): HTMLElement | null => document.querySelector('.am-field');

describe('EditDialogComponent — density reaches projected content (ACC-120 slice 5)', () => {
  afterEach(() => {
    document.querySelectorAll('.p-dialog, .p-dialog-mask').forEach((n) => n.remove());
  });

  it('renders a field inside a host-declared template at all', () => {
    setup('form');
    expect(field())
      .withContext('the probe field never rendered — the rest of this spec would be vacuous')
      .not.toBeNull();
  });

  it('a field in projected content is COMPACT when the dialog asks for compact', () => {
    setup('compact');
    // THE ASSERTION THIS SPEC EXISTS FOR. Against the unfixed component the
    // class is absent, because the token never reached the field.
    expect(field()!.classList.contains('am-field--compact'))
      .withContext('density did not reach the projected field — the outlet injector is not wired')
      .toBe(true);
  });

  it('a field in projected content stays FORM density when the dialog does not ask', () => {
    setup('form');
    expect(field()!.classList.contains('am-field--compact'))
      .withContext('form density must remain the default, so existing dialogs do not move')
      .toBe(false);
  });

  it('switching the dialog back to form density returns the field to form density', () => {
    const fixture = setup('compact');
    expect(field()!.classList.contains('am-field--compact')).toBe(true);

    fixture.componentInstance.density.set('form');
    fixture.detectChanges();

    // The token carries a SIGNAL, so this must follow without re-creating the
    // dialog. A one-shot read would pass the test above and fail here.
    expect(field()!.classList.contains('am-field--compact'))
      .withContext('density is a signal and must track, not be read once at construction')
      .toBe(false);
  });
});
