import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { FieldComponent } from './field.component';
import { PasswordInputComponent } from '../password-input/password-input.component';

@Component({
  standalone: true,
  imports: [FieldComponent, PasswordInputComponent, ReactiveFormsModule],
  template: `
    <div [attr.dir]="dir()" style="width: 340px">
      <form [formGroup]="form">
        <am-field label="Password" inputId="pw" [control]="form.controls.password">
          <am-password-input inputId="pw" formControlName="password" />
        </am-field>
      </form>
    </div>
  `,
})
class HostComponent {
  readonly dir = input<'ltr' | 'rtl'>('ltr');
  readonly form = new FormGroup({
    password: new FormControl('', { nonNullable: true, validators: Validators.required }),
  });
}

// ACC-120 slice 9e — the error glyph must not sit on the show/hide button.
// Found in the browser: the eye ended at x 773 and the "!" started at 772.8.
describe('am-field with a trailing control (ACC-120 slice 9e)', () => {
  let fixture: ComponentFixture<HostComponent>;

  function render(dir: 'ltr' | 'rtl'): void {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentRef.setInput('dir', dir);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    // Submit the empty form, so the required error — and its glyph — shows.
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  afterEach(() => fixture.nativeElement.remove());

  const rect = (selector: string): DOMRect =>
    (fixture.nativeElement.querySelector(selector) as HTMLElement).getBoundingClientRect();

  function measured() {
    const glyph = rect('.am-field__glyph');
    const toggle = rect('.am-password__toggle');
    const box = rect('.am-password__input');
    // Non-vacuity guard, FIRST: in a layout-less run every rect is zero and
    // "no overlap" would pass with nothing measured.
    expect(box.width).toBeGreaterThan(200);
    expect(toggle.width).toBeGreaterThan(20);
    expect(glyph.width).toBeGreaterThan(0);
    // Both sit inside the input's box.
    for (const r of [glyph, toggle]) {
      expect(r.left).toBeGreaterThanOrEqual(box.left - 0.5);
      expect(r.right).toBeLessThanOrEqual(box.right + 0.5);
    }
    return { glyph, toggle, box };
  }

  it('in English, the glyph sits before the button, with space between', () => {
    render('ltr');
    const { glyph, toggle } = measured();
    expect(toggle.right).toBeCloseTo(rect('.am-password__input').right, 0);
    expect(glyph.right).toBeLessThanOrEqual(toggle.left - 2);
  });

  it('in Arabic, the same layout mirrored', () => {
    render('rtl');
    const { glyph, toggle, box } = measured();
    expect(toggle.left).toBeCloseTo(box.left, 0);
    expect(glyph.left).toBeGreaterThanOrEqual(toggle.right + 2);
  });

  it('typed text stops short of the glyph while the error shows', () => {
    render('ltr');
    const input = fixture.nativeElement.querySelector('.am-password__input') as HTMLInputElement;
    const { glyph, box } = measured();
    const paddingEnd = parseFloat(getComputedStyle(input).paddingInlineEnd);
    expect(box.right - paddingEnd).toBeLessThanOrEqual(glyph.left);
  });
});
