import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { FieldComponent } from './field.component';

// ACC-240 — an action after the hint, in the hint's own slot ("Couldn't load
// the list. Retry"). Opt-in: a field without it renders its message exactly as
// before. An error replaces the hint, and its action with it.

@Component({
  standalone: true,
  imports: [FieldComponent, ReactiveFormsModule],
  template: `
    <am-field label="Type" [hint]="hint()" [control]="type" [hintAction]="action()" [counter]="counter()" [forceShowErrors]="force()">
      <input type="text" [formControl]="type" />
    </am-field>
  `,
})
class HostComponent {
  readonly type = new FormControl('', [Validators.required]);
  readonly hint = signal("Couldn't load the list.");
  readonly action = signal<{ label: string; run: () => void } | null>(null);
  readonly counter = signal<{ value: number; max: number } | null>(null);
  readonly force = signal(false);
}

describe('FieldComponent — hintAction (ACC-240)', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) })],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, button: () => el.querySelector<HTMLButtonElement>('[data-testid="field-hint-action"]') };
  }

  it('opt-in: with no action the message line is the hint alone', () => {
    const { el, button } = setup();
    expect(button()).toBeNull();
    expect(el.querySelector('.am-field__message')?.textContent?.trim()).toBe("Couldn't load the list.");
  });

  it('draws a real button after the hint, inside the described-by message, and runs it', () => {
    const { fixture, el, button } = setup();
    const run = jasmine.createSpy('run');
    fixture.componentInstance.action.set({ label: 'Retry', run });
    fixture.detectChanges();

    expect(button()?.textContent?.trim()).toBe('Retry');
    expect(button()?.getAttribute('type')).toBe('button');
    const message = el.querySelector<HTMLElement>('.am-field__message')!;
    expect(message.contains(button())).toBeTrue();
    expect((el.querySelector('input')!.getAttribute('aria-describedby') ?? '').split(' ')).toContain(message.id);
    button()!.click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('an error replaces the hint, and its action with it', () => {
    const { fixture, el, button } = setup();
    fixture.componentInstance.action.set({ label: 'Retry', run: () => undefined });
    fixture.detectChanges();
    expect(button()).withContext('the action shows before the error').not.toBeNull();
    fixture.componentInstance.force.set(true);
    fixture.detectChanges();
    expect(el.querySelector('.am-field__message--error')).not.toBeNull();
    expect(button()).toBeNull();
  });

  it('beside a counter too', () => {
    const { fixture, button } = setup();
    fixture.componentInstance.counter.set({ value: 1, max: 10 });
    fixture.componentInstance.action.set({ label: 'Retry', run: () => undefined });
    fixture.detectChanges();
    expect(button()?.textContent?.trim()).toBe('Retry');
  });
});
