// ACC-96 — multi-select mode.
//
// Added for the New Task assignee field: Template 3 budgets it as a 75px field
// block and the inline p-listbox it replaces is ~200px, which alone put step 1
// over its 279px target.
//
// A separate file rather than more cases in overlay-select.component.spec.ts,
// because every test here needs `[multiple]="true"` on the host and the
// existing file's four hosts all deliberately do not have it — the point of
// most of them is single-select behaviour that must not change.
import { Component } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { OverlaySelectComponent } from './overlay-select.component';

interface UserOption {
  id: string;
  name: string;
}

const USERS: UserOption[] = [
  { id: 'u1', name: 'Noura Al-Ghamdi' },
  { id: 'u2', name: 'Salem Al-Hajri' },
  { id: 'u3', name: 'Huda Al-Rashidi' },
  { id: 'u4', name: 'Yousef Bin Tariq' },
];

@Component({
  standalone: true,
  imports: [OverlaySelectComponent, ReactiveFormsModule],
  template: `
    <app-overlay-select
      [options]="options"
      optionLabel="name"
      optionValue="id"
      [multiple]="true"
      [showClear]="true"
      multipleSummary="3 selected"
      [formControl]="control"
    />
  `,
})
class MultiHostComponent {
  options = USERS;
  control = new FormControl<string[]>([]);
}

describe('OverlaySelectComponent — multiple (ACC-96)', () => {
  let fixture: ComponentFixture<MultiHostComponent>;
  let host: MultiHostComponent;
  let overlayContainer: OverlayContainer;

  const trigger = (): HTMLElement =>
    fixture.nativeElement.querySelector('.am-overlay-select-trigger');

  const triggerText = (): string => trigger().textContent?.trim() ?? '';

  const optionEls = (): HTMLElement[] =>
    Array.from(
      overlayContainer
        .getContainerElement()
        .querySelectorAll<HTMLElement>('.am-overlay-select-option'),
    );

  const open = (): void => {
    trigger().click();
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [MultiHostComponent] });
    overlayContainer = TestBed.inject(OverlayContainer);
    fixture = TestBed.createComponent(MultiHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => overlayContainer.ngOnDestroy());

  it('accumulates picks instead of replacing them', fakeAsync(() => {
    open();
    optionEls()[0].click();
    fixture.detectChanges();
    tick();
    expect(host.control.value).toEqual(['u1']);

    optionEls()[2].click();
    fixture.detectChanges();
    tick();
    expect(host.control.value).toEqual(['u1', 'u3']);
  }));

  it('stays open across picks', fakeAsync(() => {
    open();
    expect(optionEls().length).toBe(4);

    optionEls()[0].click();
    fixture.detectChanges();
    tick();

    // The whole point: a multi-select that dismisses after each pick makes the
    // user reopen it once per person.
    expect(optionEls().length)
      .withContext('the panel must not close on a pick in multiple mode')
      .toBe(4);
  }));

  it('names the picks while they fit and counts them when they do not', fakeAsync(() => {
    open();
    optionEls()[0].click();
    fixture.detectChanges();
    tick();
    expect(triggerText()).toContain('Noura Al-Ghamdi');

    optionEls()[1].click();
    fixture.detectChanges();
    tick();
    expect(triggerText()).toContain('Noura Al-Ghamdi');
    expect(triggerText()).toContain('Salem Al-Hajri');

    // Third pick crosses multipleSummaryFrom, so the consumer's own summary
    // replaces the names — the trigger is one line by design.
    optionEls()[2].click();
    fixture.detectChanges();
    tick();
    expect(triggerText()).toContain('3 selected');
    expect(triggerText()).not.toContain('Noura Al-Ghamdi');
  }));

  it('writes an existing array back into the trigger and the listbox', fakeAsync(() => {
    host.control.setValue(['u2', 'u4']);
    fixture.detectChanges();
    tick();

    expect(triggerText()).toContain('Salem Al-Hajri');
    expect(triggerText()).toContain('Yousef Bin Tariq');

    open();
    const selected = optionEls().filter((el) => el.getAttribute('aria-selected') === 'true');
    expect(selected.length).toBe(2);
  }));

  it('deselects on a second pick of the same option', fakeAsync(() => {
    open();
    optionEls()[0].click();
    fixture.detectChanges();
    tick();
    expect(host.control.value).toEqual(['u1']);

    optionEls()[0].click();
    fixture.detectChanges();
    tick();
    expect(host.control.value).toEqual([]);
  }));

  it('clears to an empty array, never to null', fakeAsync(() => {
    host.control.setValue(['u1', 'u2']);
    fixture.detectChanges();
    tick();

    fixture.nativeElement.querySelector('.am-overlay-select-clear-icon').click();
    fixture.detectChanges();
    tick();

    // null would reach the API as a missing field rather than "no assignees",
    // and CreateTaskDto.assigneeUserIds is @IsArray.
    expect(host.control.value).toEqual([]);
  }));

  it('shows the clear affordance only while something is picked', fakeAsync(() => {
    const clearIcon = (): Element | null =>
      fixture.nativeElement.querySelector('.am-overlay-select-clear-icon');

    expect(clearIcon()).toBeNull();

    host.control.setValue(['u1']);
    fixture.detectChanges();
    tick();
    expect(clearIcon()).not.toBeNull();
  }));
});
