import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { Directionality } from '@angular/cdk/bidi';
import { signal } from '@angular/core';
import { DOWN_ARROW, ENTER } from '@angular/cdk/keycodes';
import { OverlaySelectComponent } from './overlay-select.component';

// ACC-120 slice 11 — optionDisabled / optionDisabledReason: an option SHOWN and
// not CHOSEN, with the reason in its accessible name. The unit dialog's parent
// picker is the first consumer: the unit being edited and its own sub-units are
// listed, greyed, and cannot be picked by pointer or keyboard.

interface Node {
  label: string;
  value: string;
  items?: Node[];
  unavailable?: boolean;
  unavailableReason?: string;
}

const TREE: Node[] = [
  {
    label: 'Hospital',
    value: 'root',
    items: [
      {
        label: 'Pharmacy',
        value: 'pharm',
        unavailable: true,
        unavailableReason: 'this is the unit you are editing',
        items: [{ label: 'Inpatient', value: 'ip', unavailable: true, unavailableReason: 'one of its sub-units' }],
      },
      { label: 'Radiology', value: 'rad' },
    ],
  },
];

@Component({
  standalone: true,
  imports: [OverlaySelectComponent, ReactiveFormsModule],
  template: `
    <app-overlay-select
      [options]="options"
      optionLabel="label"
      optionValue="value"
      optionGroupLabel="label"
      optionGroupChildren="items"
      [optionDisabled]="disabledField"
      optionDisabledReason="unavailableReason"
      [formControl]="control"
    />
  `,
})
class HostComponent {
  options = TREE;
  disabledField: string | undefined = 'unavailable';
  control = new FormControl<string | null>(null);
}

function keydown(target: HTMLElement, key: string, keyCode: number): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit));
}

function open(disabledField: string | undefined) {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.disabledField = disabledField;
  fixture.detectChanges();
  (fixture.nativeElement.querySelector('.am-overlay-select-trigger') as HTMLElement).click();
  fixture.detectChanges();
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.am-overlay-select-option'));
  const row = (label: string) => rows.find((el) => el.textContent?.trim() === label)!;
  return { fixture, rows, row };
}

describe('OverlaySelectComponent — options shown but not choosable (ACC-120 slice 11)', () => {
  afterEach(() => TestBed.inject(OverlayContainer).ngOnDestroy());

  it('still lists the unavailable options, in place', () => {
    const { rows } = open('unavailable');
    expect(rows.map((el) => el.textContent?.trim())).toEqual(['Hospital', 'Pharmacy', 'Inpatient', 'Radiology']);
  });

  it('marks them disabled and greyed, and puts the reason in the accessible name', () => {
    const { row } = open('unavailable');
    expect(row('Pharmacy').getAttribute('aria-disabled')).toBe('true');
    expect(row('Pharmacy').classList).toContain('am-overlay-select-option-unavailable');
    expect(row('Pharmacy').getAttribute('aria-label')).toBe('Pharmacy, this is the unit you are editing');
    expect(row('Inpatient').getAttribute('aria-label')).toBe('Inpatient, one of its sub-units');
    // An available option keeps its own text as its name: no aria-label added.
    expect(row('Radiology').getAttribute('aria-label')).toBeNull();
    expect(row('Radiology').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('joins the reason with the Arabic comma in a right-to-left session', () => {
    TestBed.overrideProvider(Directionality, { useValue: { value: 'rtl', valueSignal: signal('rtl'), change: { subscribe: () => ({ unsubscribe: () => undefined }) } } });
    const { row } = open('unavailable');
    expect(row('Pharmacy').getAttribute('aria-label')).toBe('Pharmacy، this is the unit you are editing');
  });

  it('a click on an unavailable option chooses nothing', () => {
    const { fixture, row } = open('unavailable');
    row('Inpatient').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBeNull();
  });

  it('the keyboard skips them', () => {
    const { fixture } = open('unavailable');
    const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
    // Hospital is active first; one ArrowDown jumps Pharmacy and Inpatient.
    keydown(panel, 'ArrowDown', DOWN_ARROW);
    fixture.detectChanges();
    expect(panel.querySelector('.cdk-option-active')?.textContent?.trim()).toBe('Radiology');
    keydown(panel, 'Enter', ENTER);
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBe('rad');
  });

  it('opt-in: without optionDisabled every option behaves as before', () => {
    const { fixture, row } = open(undefined);
    expect(row('Pharmacy').getAttribute('aria-disabled')).not.toBe('true');
    expect(row('Pharmacy').getAttribute('aria-label')).toBeNull();
    row('Pharmacy').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBe('pharm');
  });
});
