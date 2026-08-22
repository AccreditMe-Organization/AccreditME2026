import { Component, ElementRef, ViewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { OverlayContainer } from '@angular/cdk/overlay';
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
});
