import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { FieldComponent } from './field.component';

// ACC-120 slice 11 — the character counter at the end of the message line
// (OS L387, L390): "8 / 10" beside the hint, amber from a threshold. Opt-in;
// a field with no counter renders its message line exactly as before.

@Component({
  standalone: true,
  imports: [FieldComponent, ReactiveFormsModule],
  template: `
    <am-field label="Code" hint="Up to 10" [control]="code" [counter]="counter()" [hintVisuallyHidden]="hidden()">
      <input type="text" [formControl]="code" />
    </am-field>
  `,
})
class HostComponent {
  readonly code = new FormControl('', [Validators.maxLength(10)]);
  readonly counter = signal<{ value: number; max: number; warnFrom?: number } | null>(null);
  readonly hidden = signal(false);
}

describe('FieldComponent — counter (ACC-120 slice 11)', () => {
  function setup(counter: { value: number; max: number; warnFrom?: number } | null) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) })],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.counter.set(counter);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, counterEl: () => el.querySelector<HTMLElement>('[data-testid="field-counter"]') };
  }

  it('shows "value / max" beside the hint', () => {
    const { el, counterEl } = setup({ value: 8, max: 10 });
    expect(counterEl()?.textContent?.trim()).toBe('8 / 10');
    expect(el.querySelector('.am-field__message-text')?.textContent?.trim()).toBe('Up to 10');
    // Numbers read left to right in both languages, and the count is not
    // announced on every keystroke.
    expect(counterEl()?.getAttribute('dir')).toBe('ltr');
    expect(counterEl()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('turns amber only from warnFrom', () => {
    const below = setup({ value: 899, max: 1000, warnFrom: 900 });
    expect(below.counterEl()?.classList).not.toContain('am-field__counter--warn');
    below.fixture.componentInstance.counter.set({ value: 900, max: 1000, warnFrom: 900 });
    below.fixture.detectChanges();
    expect(below.counterEl()?.classList).toContain('am-field__counter--warn');
  });

  it('with no warnFrom, never amber', () => {
    const { counterEl } = setup({ value: 10, max: 10 });
    expect(counterEl()?.classList).not.toContain('am-field__counter--warn');
  });

  it('opt-in: no counter, no counter element and the plain message line', () => {
    const { el, counterEl } = setup(null);
    expect(counterEl()).toBeNull();
    expect(el.querySelector('.am-field__message--counted')).toBeNull();
    expect(el.querySelector('.am-field__message')?.textContent?.trim()).toBe('Up to 10');
  });

  it('hintVisuallyHidden: the hint is sr-only but still the described-by message; an error is drawn', () => {
    const { fixture, el, counterEl } = setup({ value: 3, max: 10 });
    fixture.componentInstance.hidden.set(true);
    fixture.detectChanges();
    const text = () => el.querySelector<HTMLElement>('.am-field__message-text')!;
    expect(text().classList).toContain('sr-only');
    expect(text().textContent?.trim()).toBe('Up to 10');
    const message = el.querySelector<HTMLElement>('.am-field__message')!;
    expect((el.querySelector('input')!.getAttribute('aria-describedby') ?? '').split(' ')).toContain(message.id);
    expect(counterEl()).not.toBeNull();

    // An error is never hidden.
    const code = fixture.componentInstance.code;
    code.setValue('ABCDEFGHIJK');
    code.markAsDirty();
    el.querySelector('input')!.dispatchEvent(new Event('focusout', { bubbles: true }));
    fixture.detectChanges();
    expect(message.classList).toContain('am-field__message--error');
    expect(text().classList).not.toContain('sr-only');
  });

  it('hintVisuallyHidden defaults to off', () => {
    const { el } = setup({ value: 3, max: 10 });
    expect(el.querySelector('.am-field__message-text')!.classList).not.toContain('sr-only');
  });
});

