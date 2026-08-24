import { Component, ElementRef, TemplateRef, ViewChild } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { OverlayContainer } from '@angular/cdk/overlay';
import { CdkOption } from '@angular/cdk/listbox';
import { OverlaySelectComponent } from './overlay-select.component';

interface RoleOption {
  id: string;
  nameEn: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  { id: 'r1', nameEn: 'Quality Manager' },
  { id: 'r2', nameEn: 'Auditor' },
  { id: 'r3', nameEn: 'Reviewer' },
];

const SOURCE_TYPES = ['MEETING', 'DOCUMENT', 'AUDIT'];

@Component({
  standalone: true,
  imports: [OverlaySelectComponent, ReactiveFormsModule],
  template: `
    <app-overlay-select
      [options]="options"
      optionLabel="nameEn"
      optionValue="id"
      [formControl]="control"
    />
  `,
})
class ObjectOptionsHostComponent {
  options = ROLE_OPTIONS;
  control = new FormControl<string | null>(null);
}

@Component({
  standalone: true,
  imports: [OverlaySelectComponent, ReactiveFormsModule],
  template: ` <app-overlay-select [options]="options" [formControl]="control" /> `,
})
class PrimitiveOptionsHostComponent {
  options = SOURCE_TYPES;
  control = new FormControl<string | null>(null);
}

// Mirrors EditDialogComponent's own #scrollArea shape (a real overflow-y:auto
// ancestor between the select and the document) — the exact structural case
// ACC-41 confirmed CDK's ScrollDispatcher does NOT learn about on its own.
@Component({
  standalone: true,
  imports: [OverlaySelectComponent, ReactiveFormsModule],
  template: `
    <div #scrollArea class="scroll-area" style="height: 100px; overflow-y: auto;">
      <div style="height: 2000px; padding-top: 900px;">
        <app-overlay-select
          [options]="options"
          optionLabel="nameEn"
          optionValue="id"
          [formControl]="control"
        />
      </div>
    </div>
  `,
})
class ScrollAncestorHostComponent {
  @ViewChild('scrollArea', { static: true }) scrollAreaRef!: ElementRef<HTMLDivElement>;
  options = ROLE_OPTIONS;
  control = new FormControl<string | null>(null);
}

function getTrigger(fixture: ComponentFixture<unknown>): HTMLElement {
  return fixture.debugElement.query(By.css('.am-overlay-select-trigger')).nativeElement as HTMLElement;
}

// ACC-42 Phase 1 — a genuine 3-level tree, not just 2, matching
// org-unit-form's own buildCascadeOptions() shape ({label, value, items?}).
// Deliberately deeper than the demo tenant's current ~4-unit, 2-level real
// data (plan §1.5) so the flattening/keyboard-nav/selectedLabel() tests
// below exercise a realistic worst case, not the shallowest possible one.
interface TreeOption {
  label: string;
  value: string;
  items?: TreeOption[];
}

const TREE_OPTIONS: TreeOption[] = [
  {
    label: 'Org 1',
    value: 'o1',
    items: [
      {
        label: 'Dept A',
        value: 'o1a',
        items: [
          { label: 'Team A1', value: 'o1a1' },
          { label: 'Team A2', value: 'o1a2' },
        ],
      },
      { label: 'Dept B', value: 'o1b' },
    ],
  },
  { label: 'Org 2', value: 'o2' },
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
      [formControl]="control"
    />
  `,
})
class HierarchyOptionsHostComponent {
  options = TREE_OPTIONS;
  control = new FormControl<string | null>(null);
}

// ACC-42 Phase 2 — shape mirrors every one of the 4 real affected fields'
// own data exactly (otherUsers()/pickableUsers()/managers(): {id, name,
// primaryOrgUnitId}-like), with the same two-line name+org-unit
// <ng-template #item> pattern all 4 currently use via p-select. One shared
// fixture — the underlying mechanism under test is genuinely identical
// across all 4 real fields — but each field gets its own named test below
// (plan §2.4's own requirement), not one generic test standing in for all
// four.
interface PickableUser {
  id: string;
  name: string;
  orgUnit: string;
}

const PICKABLE_USERS: PickableUser[] = [
  { id: 'u1', name: 'Ahmad Al-Najjar', orgUnit: 'Quality Department' },
  { id: 'u2', name: 'Sarah Ibrahim', orgUnit: 'Radiology' },
  { id: 'u3', name: 'Reem Al-Fahad', orgUnit: 'Human Resources' },
];

@Component({
  standalone: true,
  imports: [OverlaySelectComponent, ReactiveFormsModule],
  template: `
    <app-overlay-select
      [options]="options"
      optionLabel="name"
      optionValue="id"
      [itemTemplate]="itemTpl"
      [formControl]="control"
    />
    <ng-template #itemTpl let-user>
      <div class="flex flex-col">
        <span>{{ user.name }}</span>
        <span class="text-xs">{{ user.orgUnit }}</span>
      </div>
    </ng-template>
  `,
})
class PickableUserHostComponent {
  @ViewChild('itemTpl', { static: true }) itemTpl!: TemplateRef<unknown>;
  options = PICKABLE_USERS;
  control = new FormControl<string | null>(null);
}

// ACC-42 Phase 5 §5.5 — the first two real consumers (user-role-assignment,
// calendar-config) bind via plain [(ngModel)], not formControlName/
// [formControl]. Every other host component above uses ReactiveFormsModule;
// this one deliberately does not, to prove NgModel's own
// ControlValueAccessor wiring end-to-end rather than assuming it from the
// interface being implemented (plan §5.5).
@Component({
  standalone: true,
  imports: [OverlaySelectComponent, FormsModule],
  template: `
    <app-overlay-select [options]="options" optionLabel="nameEn" optionValue="id" [(ngModel)]="value" />
  `,
})
class NgModelHostComponent {
  options = ROLE_OPTIONS;
  value: string | null = null;
}

describe('OverlaySelectComponent', () => {
  afterEach(() => {
    // Standard CDK testing pattern: OverlayContainer is providedIn: 'root',
    // so its .cdk-overlay-container DOM node would otherwise persist across
    // tests in this file, letting one test's leftover state contaminate the
    // next. Explicit teardown keeps every test's overlay-container reads
    // (used throughout this suite, including the leak-regression test)
    // trustworthy in isolation.
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  describe('OverlayRef reuse (no DOM leak across repeated open/close cycles)', () => {
    it('does not accumulate .cdk-overlay-container children across 5 open/close cycles', () => {
      const fixture = TestBed.createComponent(ObjectOptionsHostComponent);
      fixture.detectChanges();
      const trigger = getTrigger(fixture);

      for (let cycle = 0; cycle < 5; cycle++) {
        trigger.click();
        fixture.detectChanges();
        expect(document.querySelector('.cdk-overlay-container')?.children.length)
          .withContext(`cycle ${cycle + 1}: open`)
          .toBe(1);

        const select = fixture.debugElement.query(By.directive(OverlaySelectComponent))
          .componentInstance as OverlaySelectComponent;
        select.close();
        fixture.detectChanges();
        expect(document.querySelector('.cdk-overlay-container')?.children.length)
          .withContext(`cycle ${cycle + 1}: closed`)
          .toBe(0);
      }
    });

    it('reuses the same OverlayRef instance across cycles rather than recreating it', () => {
      const fixture = TestBed.createComponent(ObjectOptionsHostComponent);
      fixture.detectChanges();
      const select = fixture.debugElement.query(By.directive(OverlaySelectComponent))
        .componentInstance as OverlaySelectComponent;

      select.open();
      const firstRef = (select as unknown as { overlayRef: unknown }).overlayRef;
      select.close();
      select.open();
      const secondRef = (select as unknown as { overlayRef: unknown }).overlayRef;

      expect(secondRef).toBe(firstRef);
    });
  });

  describe('scroll-chaining (repositions instead of closing on a genuine registered-ancestor scroll)', () => {
    it('stays open when its real scrollable ancestor fires a scroll event', () => {
      const fixture = TestBed.createComponent(ScrollAncestorHostComponent);
      fixture.detectChanges();
      const trigger = getTrigger(fixture);

      trigger.click();
      fixture.detectChanges();
      expect(document.querySelector('.am-overlay-select-panel')).not.toBeNull();

      const scrollArea = fixture.componentInstance.scrollAreaRef.nativeElement;
      scrollArea.scrollTop = 400;
      // The 'scroll' event itself (not the native default action a wheel
      // gesture would trigger) is the complete signal CDK's ScrollDispatcher
      // reacts to — register()/RepositionScrollStrategy's subscriber neither
      // inspect isTrusted nor scrollTop, only that a scroll Event arrived on
      // a registered element (verified against scrolling.mjs /
      // _overlay-module-chunk.mjs). Dispatching it directly exercises the
      // real, complete mechanism — unlike wheel/native-scroll gestures,
      // there is no further browser default action this needs to trigger.
      scrollArea.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();

      const select = fixture.debugElement.query(By.directive(OverlaySelectComponent))
        .componentInstance as OverlaySelectComponent;
      expect(select.isOpen()).toBe(true);
      expect(document.querySelector('.am-overlay-select-panel')).not.toBeNull();
    });

    it('deregisters the scrollable ancestor on close — a later scroll no longer reaches it', () => {
      const fixture = TestBed.createComponent(ScrollAncestorHostComponent);
      fixture.detectChanges();
      const trigger = getTrigger(fixture);
      const scrollArea = fixture.componentInstance.scrollAreaRef.nativeElement;

      trigger.click();
      fixture.detectChanges();
      const select = fixture.debugElement.query(By.directive(OverlaySelectComponent))
        .componentInstance as OverlaySelectComponent;
      select.close();
      fixture.detectChanges();

      // Closed — a scroll now should have nothing listening on the CDK side
      // (no attached overlay to reposition or close), and must not throw.
      expect(() => scrollArea.dispatchEvent(new Event('scroll'))).not.toThrow();
      expect(select.isOpen()).toBe(false);
    });
  });

  // CDK's own ListKeyManager (backing ActiveDescendantKeyManager) branches
  // on the legacy numeric event.keyCode, not the modern event.key string
  // (verified live: tests using only `key` left every option stuck on the
  // first item, since a manually constructed KeyboardEvent does not
  // auto-derive keyCode from key the way a real browser-generated one
  // does). keyCode values below match @angular/cdk/keycodes exactly.
  const UP_ARROW = 38;
  const DOWN_ARROW = 40;
  const HOME = 36;
  const END = 35;
  const ENTER = 13;

  function keydown(target: HTMLElement, key: string, keyCode: number): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit));
  }

  describe('keyboard navigation (@angular/cdk/listbox — ActiveDescendantKeyManager)', () => {
    it('ArrowDown/ArrowUp move the active option', () => {
      const fixture = TestBed.createComponent(ObjectOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      // Read the active option via CdkOption's own cdk-option-active class,
      // not document.activeElement — Karma's headless iframe doesn't
      // reliably reflect real focus tracking even when .focus() genuinely
      // succeeds (a test-environment quirk, independently confirmed
      // unrelated to the component's real focus behavior — already
      // verified correct against the live running app).
      const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
      const activeText = () => panel.querySelector('.cdk-option-active')?.textContent?.trim();

      keydown(panel, 'ArrowDown', DOWN_ARROW);
      fixture.detectChanges();
      expect(activeText()).toBe('Auditor');

      keydown(panel, 'ArrowUp', UP_ARROW);
      fixture.detectChanges();
      expect(activeText()).toBe('Quality Manager');
    });

    it('Home/End jump to the first/last option', () => {
      const fixture = TestBed.createComponent(ObjectOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
      const activeText = () => panel.querySelector('.cdk-option-active')?.textContent?.trim();

      keydown(panel, 'End', END);
      fixture.detectChanges();
      expect(activeText()).toBe('Reviewer');

      keydown(panel, 'Home', HOME);
      fixture.detectChanges();
      expect(activeText()).toBe('Quality Manager');
    });

    it('Enter selects the active option, updates the bound FormControl, and closes', () => {
      const fixture = TestBed.createComponent(ObjectOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
      keydown(panel, 'ArrowDown', DOWN_ARROW);
      fixture.detectChanges();
      keydown(panel, 'Enter', ENTER);
      fixture.detectChanges();

      expect(fixture.componentInstance.control.value).toBe('r2');
      expect(document.querySelector('.am-overlay-select-panel')).toBeNull();
    });

    it(
      'typeahead jumps to the option starting with the typed letter',
      fakeAsync(() => {
        const fixture = TestBed.createComponent(ObjectOptionsHostComponent);
        fixture.detectChanges();
        getTrigger(fixture).click();
        fixture.detectChanges();

        const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
        keydown(panel, 'r', 82);
        fixture.detectChanges();
        // CDK's Typeahead debounces keystrokes (default 200ms,
        // _typeahead-chunk.mjs) before matching — genuinely asynchronous,
        // not a synchronous side effect of the keydown itself.
        tick(250);
        fixture.detectChanges();
        expect(panel.querySelector('.cdk-option-active')?.textContent?.trim()).toBe('Reviewer');
      }),
    );
  });

  describe('Escape isolation (closes only the dropdown, never a parent listener)', () => {
    it('stops a real bubbled Escape from reaching a document-level listener while open', () => {
      const fixture = TestBed.createComponent(ObjectOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();
      expect(document.querySelector('.am-overlay-select-panel')).not.toBeNull();

      let documentEscapeFired = false;
      const documentListener = (event: KeyboardEvent) => {
        if (event.key === 'Escape') documentEscapeFired = true;
      };
      // Mirrors PrimeNG's own bindDocumentEscapeListener() (primeng-dialog.mjs)
      // — a plain bubble-phase document keydown listener, standing in for a
      // parent dialog's own close-on-Escape behavior.
      document.addEventListener('keydown', documentListener);
      try {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
        fixture.detectChanges();
      } finally {
        document.removeEventListener('keydown', documentListener);
      }

      expect(documentEscapeFired).toBe(false);
      expect(document.querySelector('.am-overlay-select-panel')).toBeNull();
    });

    it('still lets a document-level Escape listener fire normally once the dropdown is closed', () => {
      const fixture = TestBed.createComponent(ObjectOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();
      const select = fixture.debugElement.query(By.directive(OverlaySelectComponent))
        .componentInstance as OverlaySelectComponent;
      select.close();
      fixture.detectChanges();

      let documentEscapeFired = false;
      const documentListener = (event: KeyboardEvent) => {
        if (event.key === 'Escape') documentEscapeFired = true;
      };
      document.addEventListener('keydown', documentListener);
      try {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      } finally {
        document.removeEventListener('keydown', documentListener);
      }

      expect(documentEscapeFired).toBe(true);
    });
  });

  describe('option shapes', () => {
    it('resolves label/value via property lookup for an object-array option list', () => {
      const fixture = TestBed.createComponent(ObjectOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const labels = Array.from(document.querySelectorAll('.am-overlay-select-option')).map((el) =>
        el.textContent?.trim(),
      );
      expect(labels).toEqual(['Quality Manager', 'Auditor', 'Reviewer']);

      (document.querySelectorAll('.am-overlay-select-option')[1] as HTMLElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.control.value).toBe('r2');
    });

    it('treats a primitive-array option list as its own label and value — matches p-select default', () => {
      const fixture = TestBed.createComponent(PrimitiveOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const labels = Array.from(document.querySelectorAll('.am-overlay-select-option')).map((el) =>
        el.textContent?.trim(),
      );
      expect(labels).toEqual(SOURCE_TYPES);

      (document.querySelectorAll('.am-overlay-select-option')[2] as HTMLElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.control.value).toBe('AUDIT');
    });
  });

  // ACC-42 Phase 1 exit criteria (plan §1.5) — hierarchy mode, verified
  // against a genuine 3-level tree, not the shallowest possible case.
  describe('hierarchy mode (ACC-42 Phase 1 — optionGroupLabel/optionGroupChildren)', () => {
    it('flattens a 3-level tree into the correct depth-ordered, indented list', () => {
      const fixture = TestBed.createComponent(HierarchyOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const rows = Array.from(document.querySelectorAll('.am-overlay-select-option'));
      expect(rows.map((el) => el.textContent?.trim())).toEqual([
        'Org 1',
        'Dept A',
        'Team A1',
        'Team A2',
        'Dept B',
        'Org 2',
      ]);

      // depth-based indentation — paddingInlineStart = 0.75rem + depth*1rem
      const depths = [0, 1, 2, 2, 1, 0];
      rows.forEach((el, i) => {
        const expectedRem = 0.75 + depths[i] * 1;
        expect((el as HTMLElement).style.paddingInlineStart).toBe(`${expectedRem}rem`);
      });
    });

    it('every node is individually selectable regardless of depth or branch/leaf status', () => {
      const fixture = TestBed.createComponent(HierarchyOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      // "Dept A" (index 1) is a branch node (has items) — must still be
      // directly selectable, matching p-cascadeSelect's current actual
      // behavior for org-unit-form (pick any unit at any level as parent,
      // not "drill down to a leaf only").
      (document.querySelectorAll('.am-overlay-select-option')[1] as HTMLElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.control.value).toBe('o1a');
    });

    it("selectedLabel() resolves a value nested at depth 2, not just top-level", () => {
      const fixture = TestBed.createComponent(HierarchyOptionsHostComponent);
      fixture.componentInstance.control.setValue('o1a1');
      fixture.detectChanges();

      const label = fixture.debugElement.query(By.css('.am-overlay-select-label'))
        .nativeElement as HTMLElement;
      expect(label.textContent?.trim()).toBe('Team A1');
    });

    it('keyboard nav (ArrowDown) moves through the flattened list in the same visual order rendered', () => {
      const fixture = TestBed.createComponent(HierarchyOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
      const activeText = () => panel.querySelector('.cdk-option-active')?.textContent?.trim();

      const expectedOrder = ['Dept A', 'Team A1', 'Team A2', 'Dept B', 'Org 2'];
      for (const expected of expectedOrder) {
        keydown(panel, 'ArrowDown', DOWN_ARROW);
        fixture.detectChanges();
        expect(activeText()).toBe(expected);
      }
    });

    it('Enter selects a non-top-level node correctly and updates the bound FormControl', () => {
      const fixture = TestBed.createComponent(HierarchyOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
      // Org 1 -> Dept A -> Team A1 (2 ArrowDowns from the initial top item)
      keydown(panel, 'ArrowDown', DOWN_ARROW);
      keydown(panel, 'ArrowDown', DOWN_ARROW);
      fixture.detectChanges();
      keydown(panel, 'Enter', ENTER);
      fixture.detectChanges();

      expect(fixture.componentInstance.control.value).toBe('o1a1');
      expect(document.querySelector('.am-overlay-select-panel')).toBeNull();
    });
  });

  // ACC-42 Phase 2 exit criteria (plan §2.4). Two review-round additions:
  // 1) an explicit regression check that the two ACC-41 fields
  //    (task-form.sourceType, position-form.roleId — no itemTemplate set)
  //    are genuinely undisturbed by adding the itemTemplate code path, not
  //    inferred from "suite is green"; 2) one specific, named typeahead
  //    test per affected field, not one generic case standing in for all
  //    four.
  describe('item-template projection (ACC-42 Phase 2 — itemTemplate + cdkOptionTypeaheadLabel)', () => {
    it('renders a custom itemTemplate instead of the plain label, and click-selection still resolves the correct optionValue', () => {
      const fixture = TestBed.createComponent(PickableUserHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const firstRow = document.querySelector('.am-overlay-select-option') as HTMLElement;
      // Proves projection genuinely happened, not just that the input was
      // accepted: the custom template's own two-line structure is present.
      expect(firstRow.textContent?.trim()).toBe('Ahmad Al-NajjarQuality Department');
      expect(firstRow.querySelectorAll('span').length).toBe(2);

      (document.querySelectorAll('.am-overlay-select-option')[1] as HTMLElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.control.value).toBe('u2');
    });

    it('binds cdkOptionTypeaheadLabel to the plain name — not the two-line custom template\'s concatenated textContent', () => {
      const fixture = TestBed.createComponent(PickableUserHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const optionDebugEls = fixture.debugElement.queryAll(By.directive(CdkOption));
      const labels = optionDebugEls.map((el) => el.injector.get(CdkOption).typeaheadLabel);
      // Direct proof the fix is wired, not inferred from behavior alone:
      // if unbound, typeaheadLabel would be null (CdkOption's own default),
      // and typeahead would fall back to the corrupted concatenated
      // textContent instead.
      expect(labels).toEqual(['Ahmad Al-Najjar', 'Sarah Ibrahim', 'Reem Al-Fahad']);
    });

    // Named per field, per plan §2.4 — same shared mechanism/fixture, but
    // each stands alone as evidence for that specific real field, not one
    // generic case covering all four (matching this whole plan's own
    // "passing on one field is not evidence for an untested one" standard,
    // §5.2).
    it('invite-user.managerId: typing a letter jumps to the matching NAME, not broken by the org-unit subtitle', fakeAsync(() => {
      const fixture = TestBed.createComponent(PickableUserHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
      keydown(panel, 's', 83); // "Sarah Ibrahim"
      fixture.detectChanges();
      tick(250);
      fixture.detectChanges();
      expect(panel.querySelector('.cdk-option-active')?.textContent?.trim()).toBe('Sarah IbrahimRadiology');
    }));

    it('committee-member-form.userId: typing a letter jumps to the matching NAME, not broken by the org-unit subtitle', fakeAsync(() => {
      const fixture = TestBed.createComponent(PickableUserHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
      keydown(panel, 'r', 82); // "Reem Al-Fahad"
      fixture.detectChanges();
      tick(250);
      fixture.detectChanges();
      expect(panel.querySelector('.cdk-option-active')?.textContent?.trim()).toBe('Reem Al-FahadHuman Resources');
    }));

    it('user-profile.managerId: typing a letter jumps to the matching NAME, not broken by the org-unit subtitle', fakeAsync(() => {
      const fixture = TestBed.createComponent(PickableUserHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
      keydown(panel, 'a', 65); // "Ahmad Al-Najjar"
      fixture.detectChanges();
      tick(250);
      fixture.detectChanges();
      expect(panel.querySelector('.cdk-option-active')?.textContent?.trim()).toBe('Ahmad Al-NajjarQuality Department');
    }));

    it('user-profile.actingUserId: typing a letter jumps to the matching NAME, not broken by the org-unit subtitle', fakeAsync(() => {
      const fixture = TestBed.createComponent(PickableUserHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const panel = document.querySelector('.am-overlay-select-panel') as HTMLElement;
      keydown(panel, 's', 83); // "Sarah Ibrahim"
      fixture.detectChanges();
      tick(250);
      fixture.detectChanges();
      expect(panel.querySelector('.cdk-option-active')?.textContent?.trim()).toBe('Sarah IbrahimRadiology');
    }));
  });

  // Regression exit criterion (plan §2.4, added after review): the two
  // fields already migrated in ACC-41 — no itemTemplate set at all — must
  // still render and behave exactly as before adding the itemTemplate code
  // path. Dedicated, named tests distinct from the general option-shapes
  // coverage above, so this specific guarantee is traceable on its own.
  describe('item-template regression — the two ACC-41 fields remain undisturbed (plan §2.4)', () => {
    it('position-form.roleId shape (object array, no itemTemplate): renders the exact plain label, unchanged', () => {
      const fixture = TestBed.createComponent(ObjectOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const labels = Array.from(document.querySelectorAll('.am-overlay-select-option')).map((el) =>
        el.textContent?.trim(),
      );
      expect(labels).toEqual(['Quality Manager', 'Auditor', 'Reviewer']);

      (document.querySelectorAll('.am-overlay-select-option')[0] as HTMLElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.control.value).toBe('r1');
    });

    it('task-form.sourceType shape (primitive array, no itemTemplate): renders the exact plain label, unchanged', () => {
      const fixture = TestBed.createComponent(PrimitiveOptionsHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      const labels = Array.from(document.querySelectorAll('.am-overlay-select-option')).map((el) =>
        el.textContent?.trim(),
      );
      expect(labels).toEqual(SOURCE_TYPES);

      (document.querySelectorAll('.am-overlay-select-option')[1] as HTMLElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.control.value).toBe('DOCUMENT');
    });
  });

  // ACC-42 Phase 5 §5.5 exit criterion — first real proof of the ngModel
  // binding path (user-role-assignment, calendar-config), not assumed from
  // ControlValueAccessor being implemented. Two distinct directions:
  // component→template (selecting an option updates the bound property) and
  // the classic hand-rolled-CVA gap class, template←external (a
  // programmatic, non-UI-driven change to the bound property — exactly what
  // user-role-assignment.onAssign() does when it resets selectedRoleId to
  // null after a successful assign — must still reach writeValue() and
  // re-render the displayed selection).
  describe('ngModel binding path (plan §5.5 — first real proof, not assumed)', () => {
    it('selecting an option via the real DOM updates the ngModel-bound property', () => {
      const fixture = TestBed.createComponent(NgModelHostComponent);
      fixture.detectChanges();
      getTrigger(fixture).click();
      fixture.detectChanges();

      (document.querySelectorAll('.am-overlay-select-option')[1] as HTMLElement).click();
      fixture.detectChanges();

      expect(fixture.componentInstance.value).toBe('r2');
    });

    it(
      'an external (non-UI) write to the bound property re-syncs the displayed selection via writeValue()',
      fakeAsync(() => {
        const fixture = TestBed.createComponent(NgModelHostComponent);
        fixture.componentInstance.value = 'r1';
        fixture.detectChanges();
        // NgModel's model→view sync (NgModel._updateValue()) is itself
        // wrapped in a resolved-Promise microtask, not applied synchronously
        // within the triggering detectChanges() — standard NgModel behavior
        // (avoids ExpressionChangedAfterItHasBeenCheckedError), not specific
        // to OverlaySelectComponent. tick() flushes it; a real running app
        // sees this resolve on the next microtask/render pass regardless.
        tick();
        fixture.detectChanges();

        const label = () => fixture.debugElement.query(By.css('.am-overlay-select-label')).nativeElement.textContent.trim();
        expect(label()).toBe('Quality Manager');

        // Simulates user-role-assignment's own onAssign() success handler:
        // `this.selectedRoleId = null` set directly on the component, not
        // through any form API or UI interaction — the exact path a
        // hand-rolled writeValue() can silently fail to react to if NgModel's
        // own change-detection wiring isn't genuinely exercised.
        fixture.componentInstance.value = null;
        fixture.detectChanges();
        tick();
        fixture.detectChanges();

        expect(label()).toBe('');
        expect(fixture.debugElement.query(By.css('.am-overlay-select-placeholder'))).not.toBeNull();
      }),
    );
  });
});
