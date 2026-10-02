import { Component, inject } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { FieldComponent } from './field.component';

/**
 * ACC-120 — a submit reveals a field's errors with NOTHING passed by the caller.
 *
 * `forceShowErrors` was opt-in and nothing enforced it. Two forms missed it and
 * the symptom was a dead button: Next enabled, clicking it did nothing, the
 * field reporting aria-invalid="false" and no error element anywhere. A third
 * form would have missed it.
 *
 * The wrapper now reads the enclosing form's own `submitted` state, which
 * Angular already tracks on FormGroupDirective. The host below passes NO
 * forceShowErrors — that absence is the assertion.
 */
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, InputTextModule, FieldComponent],
  template: `
    <form [formGroup]="form" (ngSubmit)="submitted = true">
      <am-field label="Name" [control]="form.controls.name" inputId="name" [errorMessages]="errors">
        <input pInputText id="name" formControlName="name" />
      </am-field>
      <button type="submit">Save</button>
    </form>
  `,
})
class SubmittingHost {
  private readonly fb = inject(FormBuilder);
  readonly form = this.fb.group({ name: ['', Validators.required] });
  readonly errors = { required: 'This field is required.' };
  submitted = false;
}

/** The legitimate controlless case: a note standing in for a control. */
@Component({
  standalone: true,
  imports: [FieldComponent],
  template: `
    <am-field label="Org unit" message="none">
      <div>No org units yet.</div>
    </am-field>
  `,
})
class ControllessHost {}

describe('FieldComponent — reveal on submit (ACC-120)', () => {
  function render<T>(host: new () => T): ComponentFixture<T> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [host as never],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    const fixture = TestBed.createComponent(host);
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: ComponentFixture<unknown>, sel: string): HTMLElement | null =>
    (f.nativeElement as HTMLElement).querySelector<HTMLElement>(sel);

  const text = (f: ComponentFixture<unknown>): string =>
    (f.nativeElement as HTMLElement).textContent ?? '';

  it('shows nothing before the form is submitted', () => {
    const fixture = render(SubmittingHost);
    // Not toBe('false'): the aria attribute is written by an afterNextRender
    // effect, so before it runs the attribute is absent — which is equally
    // "not marked invalid". Asserting the exact string here would be asserting
    // the timing of an effect, not the behaviour.
    expect(el(fixture, '#name')?.getAttribute('aria-invalid')).not.toBe('true');
    expect(text(fixture)).not.toContain('This field is required.');
  });

  // THE POINT. No forceShowErrors is bound anywhere in the host above.
  it('reveals the error on submit, with no forceShowErrors passed', () => {
    const fixture = render(SubmittingHost);
    el(fixture, 'button[type=submit]')!.click();
    fixture.detectChanges();

    expect(el(fixture, '#name')?.getAttribute('aria-invalid')).toBe('true');
    expect(text(fixture)).toContain('This field is required.');
  });

  it('stops showing it once the field is filled', () => {
    const fixture = render(SubmittingHost);
    el(fixture, 'button[type=submit]')!.click();
    fixture.detectChanges();
    expect(text(fixture)).toContain('This field is required.');

    fixture.componentInstance.form.controls.name.setValue('Something');
    fixture.detectChanges();

    expect(text(fixture)).not.toContain('This field is required.');
  });

  // The optional injection is not an escape hatch for a form that forgot
  // [formGroup] — it is for a field that legitimately has no form at all.
  // Rendering one must not throw.
  it('renders outside a form, for a field standing in for a control', () => {
    const fixture = render(ControllessHost);
    expect(text(fixture)).toContain('No org units yet.');
  });
});
