import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { PasswordInputComponent } from './password-input.component';

@Component({
  standalone: true,
  imports: [PasswordInputComponent, ReactiveFormsModule],
  template: `<am-password-input inputId="pw" [formControl]="control" autocomplete="new-password" />`,
})
class HostComponent {
  readonly control = new FormControl('', { nonNullable: true, validators: Validators.required });
}

// ACC-120 slice 9e — the show/hide control is a real button.
describe('PasswordInputComponent (ACC-120 slice 9e)', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => fixture.nativeElement.remove());

  const input = (): HTMLInputElement => fixture.nativeElement.querySelector('input');
  const toggle = (): HTMLElement => fixture.nativeElement.querySelector('.am-password__toggle');

  it('is a native button in the tab order, named, and not pressed', () => {
    const t = toggle();
    expect(t.tagName).toBe('BUTTON');
    expect(t.getAttribute('type')).toBe('button');
    expect(t.tabIndex).toBe(0);
    expect(t.getAttribute('aria-label')).toBe('common.showPassword');
    expect(t.getAttribute('aria-pressed')).toBe('false');
    expect(t.getAttribute('aria-controls')).toBe('pw');
    expect(input().type).toBe('password');
  });

  it('Tab reaches it straight after the input', () => {
    // Native tab order: the input, then the toggle, with nothing in between.
    const host = fixture.nativeElement as HTMLElement;
    const focusable = Array.from(
      host.querySelectorAll<HTMLElement>('input, button, [tabindex]'),
    ).filter((el) => el.tabIndex >= 0);
    expect(focusable).toEqual([input(), toggle()]);
  });

  it('toggles from the keyboard and keeps focus on the same button', () => {
    const t = toggle();
    t.focus();
    expect(document.activeElement).toBe(t);

    // Enter and Space on a native <button> are delivered as `click` by the
    // browser itself; that is the keyboard path a span with (click) lacks.
    t.click();
    fixture.detectChanges();

    expect(toggle()).toBe(t); // one element that changes, never two that swap
    expect(document.activeElement).toBe(t);
    expect(input().type).toBe('text');
    expect(t.getAttribute('aria-pressed')).toBe('true');
    expect(t.getAttribute('aria-label')).toBe('common.hidePassword');

    t.click();
    fixture.detectChanges();
    expect(input().type).toBe('password');
    expect(t.getAttribute('aria-pressed')).toBe('false');
    expect(t.getAttribute('aria-label')).toBe('common.showPassword');
  });

  it('never submits the form it sits in', () => {
    expect(toggle().getAttribute('type')).toBe('button');
  });

  it('writes and reads the control value', () => {
    fixture.componentInstance.control.setValue('initial value');
    fixture.detectChanges();
    expect(input().value).toBe('initial value');

    input().value = 'typed';
    input().dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.control.value).toBe('typed');
  });

  it('disables the input and the button together', () => {
    fixture.componentInstance.control.disable();
    fixture.detectChanges();
    expect(input().disabled).toBeTrue();
    expect((toggle() as HTMLButtonElement).disabled).toBeTrue();
  });
});
