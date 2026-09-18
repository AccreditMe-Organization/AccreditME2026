import { Component, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { FieldComponent } from './field.component';

@Component({
  standalone: true,
  imports: [FieldComponent, ReactiveFormsModule],
  template: `
    <am-field
      label="Committee name"
      hint="Shown in lists and reports."
      [control]="name"
      [readonly]="readonly"
      [loading]="loading"
      [errorMessages]="{ minlength: 'committee.nameTooShort' }"
    >
      <input type="text" [formControl]="name" />
    </am-field>
  `,
})
class HostComponent {
  readonly name = new FormControl('', [Validators.required, Validators.minLength(8)]);
  readonly = false;
  loading = false;
  readonly field = viewChild.required(FieldComponent);
}

describe('FieldComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const input = (): HTMLInputElement => fixture.nativeElement.querySelector('input');
  const message = (): HTMLElement => fixture.nativeElement.querySelector('.am-field__message');
  const label = (): HTMLLabelElement => fixture.nativeElement.querySelector('.am-field__label');

  const type = (value: string): void => {
    const el = input();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  };

  const blur = (): void => {
    input().dispatchEvent(new Event('focusout', { bubbles: true }));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('labels the control, linking the label to the input it names', () => {
    expect(label().textContent).toContain('Committee name');
    expect(input().id).toBeTruthy();
    expect(label().getAttribute('for')).toBe(input().id);
  });

  it('marks a required control as required for a screen reader', () => {
    expect(input().getAttribute('aria-required')).toBe('true');
  });

  // The rule this component exists to enforce. See its class comment.
  describe('validation timing', () => {
    it('says nothing while the user is typing their first attempt', () => {
      type('IPC');
      expect(message().classList).not.toContain('am-field__message--error');
      expect(message().textContent).toContain('Shown in lists and reports.');
      expect(input().getAttribute('aria-invalid')).toBe('false');
    });

    it('shows the error on blur', () => {
      type('IPC');
      blur();
      expect(message().classList).toContain('am-field__message--error');
      expect(input().getAttribute('aria-invalid')).toBe('true');
    });

    it('re-validates on every keystroke AFTER the first error, so recovery is visible', () => {
      type('IPC');
      blur();
      expect(message().classList).toContain('am-field__message--error');

      // Still invalid, still typing — the message must stay live, not wait for blur.
      type('IPC Comm');
      expect(message().classList).not.toContain('am-field__message--error');
      expect(host.name.valid).toBe(true);

      // And back again, without another blur.
      type('IPC');
      expect(message().classList).toContain('am-field__message--error');
    });
  });

  it('replaces the hint with the error rather than stacking them', () => {
    type('IPC');
    blur();
    expect(message().textContent).not.toContain('Shown in lists and reports.');
    expect(message().textContent).toContain('committee.nameTooShort');
  });

  it('uses the caller message for the failing validator', () => {
    type('IPC');
    blur();
    expect(message().textContent).toContain('committee.nameTooShort');

    type('');
    // required has no override, so the default key shows
    expect(message().textContent).toContain('validation.required');
  });

  it('keeps the message slot in the layout at all times, so an error cannot move the form', () => {
    const before = message().getBoundingClientRect().height;
    expect(message()).toBeTruthy();
    type('IPC');
    blur();
    const after = message().getBoundingClientRect().height;
    expect(after).toBe(before);
  });

  it('points aria-describedby at the message slot whether or not it holds an error', () => {
    const described = input().getAttribute('aria-describedby');
    expect(described).toBe(message().id);
    type('IPC');
    blur();
    expect(input().getAttribute('aria-describedby')).toBe(message().id);
  });

  it('announces an error politely rather than only colouring the border', () => {
    type('IPC');
    blur();
    expect(message().getAttribute('role')).toBe('alert');
    // Colour is never the only carrier (artboard 3): a glyph accompanies it.
    expect(fixture.nativeElement.querySelector('.am-field__glyph')).toBeTruthy();
  });

  it('marks the control busy while an async check runs, and shows a spinner', () => {
    host.loading = true;
    fixture.detectChanges();
    expect(input().getAttribute('aria-busy')).toBe('true');
    expect(fixture.nativeElement.querySelector('.am-field__spinner')).toBeTruthy();

    host.loading = false;
    fixture.detectChanges();
    expect(input().hasAttribute('aria-busy')).toBe(false);
  });

  it('renders a read-only field as a value, with no control to invite editing', () => {
    host.name.setValue('Infection Prevention & Control');
    host.readonly = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.am-field__value').textContent).toContain(
      'Infection Prevention & Control',
    );
    expect(fixture.nativeElement.querySelector('.am-field__control')).toBeNull();
  });

  it('renders an em dash for a read-only field with no value', () => {
    host.readonly = true;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.am-field__value').textContent).toContain('—');
  });

  it('never shows an error on a disabled control', () => {
    type('IPC');
    blur();
    host.name.disable();
    fixture.detectChanges();
    expect(message().classList).not.toContain('am-field__message--error');
  });

  // ONE focus indicator per element, never two. The preset gives every
  // interactive element a 2px ring at a 2px offset (artboard 9); a field
  // signals focus with a primary border plus the 3px halo (artboard 6).
  // Both are right alone — drawing both is what happens by default, and only
  // via the keyboard, the path least likely to be found by accident.
  it('renders the halo and suppresses the ring on a keyboard-focused control', () => {
    const el = input();
    el.focus();
    fixture.detectChanges();

    expect(el.matches(':focus-visible')).toBe(true);
    const styles = getComputedStyle(el);
    expect(styles.outlineStyle).toBe('none');
    expect(styles.boxShadow).not.toBe('none');
    expect(styles.boxShadow).toContain('rgb');
  });

  it('focuses its control on request, for a form moving to the first invalid field', () => {
    host.field().focusControl();
    expect(document.activeElement).toBe(input());
  });
});
