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
      removeLabel="Remove"
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

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const chipLabels = (): string[] =>
    Array.from(root().querySelectorAll<HTMLElement>('.am-overlay-select-chip-label')).map(
      (el) => el.textContent?.trim() ?? '',
    );

  const removeButtons = (): HTMLElement[] =>
    Array.from(root().querySelectorAll<HTMLElement>('.am-overlay-select-chip-remove'));

  const removeLabels = (): string[] =>
    removeButtons().map((el) => el.getAttribute('aria-label') ?? '');

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

  it('shows one chip per pick, each naming its own remove button', fakeAsync(() => {
    open();
    optionEls()[0].click();
    optionEls()[1].click();
    fixture.detectChanges();
    tick();

    expect(chipLabels()).toEqual(['Noura Al-Ghamdi', 'Salem Al-Hajri']);
    expect(removeLabels()).toEqual(['Remove Noura Al-Ghamdi', 'Remove Salem Al-Hajri']);
  }));

  // THE DEFECT THIS REPLACES: a joined label with one clear icon, so the only
  // way to drop one person was to drop them all. Ahmad hit it in a live test.
  it('removes ONE of three and keeps the other two', fakeAsync(() => {
    open();
    optionEls()[0].click();
    optionEls()[1].click();
    optionEls()[2].click();
    fixture.detectChanges();
    tick();
    expect(host.control.value).toEqual(['u1', 'u2', 'u3']);

    // The MIDDLE one, so a bug that drops the first or the last still fails.
    removeButtons()[1].click();
    fixture.detectChanges();
    tick();

    expect(host.control.value).toEqual(['u1', 'u3']);
    expect(chipLabels()).toEqual(['Noura Al-Ghamdi', 'Huda Al-Rashidi']);
  }));

  it('each remove button is a real, focusable button', fakeAsync(() => {
    host.control.setValue(['u1', 'u2']);
    fixture.detectChanges();
    tick();

    for (const button of removeButtons()) {
      // A <span> with a click handler is not keyboard reachable; a <button> is,
      // with no tabindex of its own.
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('aria-label')).toContain('Remove');
      button.focus();
      expect(document.activeElement).toBe(button);
    }
  }));

  it('removing a chip does not open the panel underneath', fakeAsync(() => {
    host.control.setValue(['u1', 'u2']);
    fixture.detectChanges();
    tick();
    expect(optionEls().length).withContext('closed to begin with').toBe(0);

    removeButtons()[0].click();
    fixture.detectChanges();
    tick();

    // The remove button sits inside the trigger, whose own click toggles the
    // panel — so the handler has to stop the event.
    expect(optionEls().length).toBe(0);
    expect(host.control.value).toEqual(['u2']);
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

  it('removing the last chip leaves an empty array, never null', fakeAsync(() => {
    host.control.setValue(['u1']);
    fixture.detectChanges();
    tick();

    removeButtons()[0].click();
    fixture.detectChanges();
    tick();

    // null would reach the API as a missing field rather than "no assignees",
    // and CreateTaskDto.assigneeUserIds is @IsArray.
    expect(host.control.value).toEqual([]);
    expect(chipLabels()).toEqual([]);
  }));

  it('offers no whole-set clear icon in multiple mode', fakeAsync(() => {
    host.control.setValue(['u1', 'u2']);
    fixture.detectChanges();
    tick();

    // Chips ARE the affordance now. Keeping a single clear icon beside them
    // would put the destructive action next to the precise one.
    expect(fixture.nativeElement.querySelector('.am-overlay-select-clear-icon')).toBeNull();
  }));
});
