import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { SecretFieldComponent } from './secret-field.component';

// ACC-181 — the write-once rule: once set, a secret is a state, never a value.
@Component({
  standalone: true,
  imports: [SecretFieldComponent],
  template: `<am-secret-field
    label="Password"
    inputId="pw"
    [control]="control"
    [isSet]="isSet()"
    [setAt]="setAt()"
    [forceShowErrors]="force()"
    [errorMessages]="{ required: 'storage.setup.secretRequired' }"
    (replaceClicked)="replaced = replaced + 1"
  />`,
})
class HostComponent {
  readonly force = signal(false);
  replaced = 0;
  readonly control = new FormControl<string>('', { nonNullable: true });
  readonly isSet = signal(true);
  readonly setAt = signal<string | null>('2026-09-29T08:00:00.000Z');
}

describe('SecretFieldComponent (ACC-181)', () => {
  let fixture: ComponentFixture<HostComponent>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting()],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  // Test 1
  it('when set: the "set" pair and Replace, and NO input at all', () => {
    expect(el().querySelector('input')).toBeNull();
    expect(el().querySelector('[data-secret-state="set"]')).not.toBeNull();
    expect(el().textContent).toContain('●●●●●●●●');
    expect(el().querySelector('[data-secret-set-on]')?.textContent?.trim()).toBe('set 29 Sep 2026');
    expect(el().textContent).toContain('Never shown again');
    const buttons = Array.from(el().querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['Replace']);
  });

  it('Replace opens an EMPTY password input, with no reveal control', async () => {
    (el().querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const input = el().querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    expect(input.autocomplete).toBe('new-password');
    expect(el().querySelectorAll('button').length).toBe(0);
    expect(fixture.componentInstance.control.value).toBe('');
  });

  it('when not set: an empty password input', () => {
    fixture.componentInstance.isSet.set(false);
    fixture.componentInstance.setAt.set(null);
    fixture.detectChanges();
    const input = el().querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(el().textContent).not.toContain('●●●●●●●●');
  });

  it('a new set date closes the input and drops what was typed', async () => {
    (el().querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    fixture.componentInstance.control.setValue('typed-new-value');
    fixture.componentInstance.setAt.set('2026-10-12T08:00:00.000Z');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el().querySelector('input')).toBeNull();
    expect(fixture.componentInstance.control.value).toBe('');
  });

  // ACC-260 — two secrets replaced together (MinIO's keys) open as one.
  it('Replace tells the caller, so it can reopen a paired secret', () => {
    (el().querySelector('button') as HTMLButtonElement).click();
    expect(fixture.componentInstance.replaced).toBe(1);
  });

  it('forceShowErrors reveals the error without a blur (an advance that is not a submit)', () => {
    fixture.componentInstance.isSet.set(false);
    fixture.componentInstance.control.addValidators(Validators.required);
    fixture.componentInstance.control.updateValueAndValidity();
    fixture.detectChanges();
    expect(el().textContent).not.toContain('Enter the secret key.');
    fixture.componentInstance.force.set(true);
    fixture.detectChanges();
    expect(el().textContent).toContain('Enter the secret key.');
  });

  it('Arabic: Replace and the hint are translated', () => {
    TestBed.inject(TranslateService).use('ar');
    fixture.detectChanges();
    expect(el().textContent).toContain('استبدال');
    expect(el().textContent).toContain('لا تُعرض مرة أخرى');
  });
});
