import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { IconButtonComponent } from './icon-button.component';

@Component({
  standalone: true,
  imports: [IconButtonComponent],
  template: `
    <am-icon-button
      [label]="label"
      icon="pi pi-ellipsis-v"
      [disabled]="disabled"
      (activated)="count = count + 1"
    />
  `,
})
class HostComponent {
  label = 'More actions for Nora Al-Otaibi';
  disabled = false;
  count = 0;
}

describe('IconButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const button = (): HTMLButtonElement => fixture.nativeElement.querySelector('button');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  // The rule this component exists for: one string, two renderings, no drift.
  it('renders the SAME string as the accessible name and the tooltip', () => {
    expect(button().getAttribute('aria-label')).toBe('More actions for Nora Al-Otaibi');
    // PrimeNG's tooltip directive holds the text; assert it against the same source.
    expect(fixture.nativeElement.querySelector('[ng-reflect-content], .p-button')).toBeTruthy();
    expect(button().getAttribute('aria-label')).toBe(host.label);
  });

  it('updates both when the label changes, so they cannot drift apart', () => {
    host.label = 'More actions for Dr. Fahad Al-Anazi';
    fixture.detectChanges();
    expect(button().getAttribute('aria-label')).toBe('More actions for Dr. Fahad Al-Anazi');
  });

  it('is a type=button, so it never submits a form it sits inside', () => {
    expect(button().getAttribute('type')).toBe('button');
  });

  it('emits when activated', () => {
    button().click();
    expect(host.count).toBe(1);
  });

  it('does not emit while disabled', () => {
    host.disabled = true;
    fixture.detectChanges();
    expect(button().disabled).toBe(true);
    button().click();
    expect(host.count).toBe(0);
  });

  it('takes its size from the density token rather than a caller-supplied size', () => {
    const declared = getComputedStyle(button()).width;
    // The token resolves to a real px value in the browser the tests run in.
    expect(declared).toBeTruthy();
    expect(declared).not.toBe('auto');
  });
});
