import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { FieldComponent } from './field.component';

// ACC-313 — a field in a matrix whose column header already says it: the label
// is read but not drawn, and stays the control's accessible name. Opt-in.

@Component({
  standalone: true,
  imports: [FieldComponent, ReactiveFormsModule],
  template: `
    <am-field label="High · Manager told after" inputId="cell" [control]="hours" [labelVisuallyHidden]="hidden()">
      <input id="cell" type="number" [formControl]="hours" />
    </am-field>
  `,
})
class HostComponent {
  readonly hours = new FormControl(8);
  readonly hidden = signal(false);
}

describe('FieldComponent — labelVisuallyHidden (ACC-313)', () => {
  async function setup(hidden?: boolean) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) })],
    });
    const fixture = TestBed.createComponent(HostComponent);
    if (hidden !== undefined) fixture.componentInstance.hidden.set(hidden);
    fixture.detectChanges();
    // The wrapper learns the control's id after its first render.
    await fixture.whenStable();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('label.am-field__label') as HTMLLabelElement;
  }

  it('defaults to off: the label is drawn', async () => {
    expect((await setup()).classList).not.toContain('sr-only');
  });

  it('on: the label is visually hidden, still names the control', async () => {
    const label = await setup(true);
    expect(label.classList).toContain('sr-only');
    expect(label.getAttribute('for')).toBe('cell');
    expect(label.textContent?.trim()).toBe('High · Manager told after');
  });
});
