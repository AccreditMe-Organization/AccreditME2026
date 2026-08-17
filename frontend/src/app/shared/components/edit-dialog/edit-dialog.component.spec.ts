import { Component, Input, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EditDialogComponent } from './edit-dialog.component';

let probeInstanceCounter = 0;

// Mirrors the throwaway spec's "one-shot ngOnInit pre-fill" pattern used by
// ACC-29's confirmed-broken forms — this is the exact shape a fresh instance
// must correctly re-run on every reopen.
@Component({
  selector: 'probe-child',
  standalone: true,
  template: `probe:{{ initValue }}`,
})
class ProbeChildComponent implements OnInit {
  @Input() value = '';
  initValue = '';
  readonly id = ++probeInstanceCounter;

  ngOnInit(): void {
    this.initValue = this.value;
  }
}

@Component({
  standalone: true,
  imports: [EditDialogComponent, ProbeChildComponent],
  template: `
    <ng-template #formTpl>
      <probe-child [value]="value" />
    </ng-template>
    <app-edit-dialog
      [visible]="visible"
      (visibleChange)="visible = $event"
      header="Test"
      [content]="formTpl"
    />
  `,
})
class InstanceIdentityHostComponent {
  visible = false;
  value = 'first';
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
}

@Component({
  standalone: true,
  imports: [EditDialogComponent],
  template: `
    <ng-template #shortTpl>
      <p>a short form with one field</p>
    </ng-template>
    <ng-template #tallTpl>
      <div class="h-[2000px]">a very tall form that must scroll</div>
    </ng-template>
    <app-edit-dialog
      [visible]="visible"
      (visibleChange)="visible = $event"
      [content]="tall ? tallTpl : shortTpl"
    />
  `,
})
class ScrollAffordanceHostComponent {
  visible = false;
  tall = false;
  @ViewChild('shortTpl', { read: TemplateRef, static: true }) shortTpl!: TemplateRef<unknown>;
  @ViewChild('tallTpl', { read: TemplateRef, static: true }) tallTpl!: TemplateRef<unknown>;
}

describe('EditDialogComponent', () => {
  describe('fresh instance on reopen (ACC-29 fix mechanism)', () => {
    it('creates a genuinely new content instance every time it reopens, re-running one-shot pre-fill with the current value', () => {
      const fixture = TestBed.createComponent(InstanceIdentityHostComponent);
      fixture.componentInstance.visible = true;
      fixture.detectChanges();

      const probe1 = fixture.debugElement.query(By.directive(ProbeChildComponent))
        .componentInstance as ProbeChildComponent;
      expect(probe1.initValue).toBe('first');
      const id1 = probe1.id;

      // close, change the underlying record (simulate "edit a different row"), reopen
      fixture.componentInstance.visible = false;
      fixture.detectChanges();
      fixture.componentInstance.value = 'second';
      fixture.componentInstance.visible = true;
      fixture.detectChanges();

      const probe2 = fixture.debugElement.query(By.directive(ProbeChildComponent))
        .componentInstance as ProbeChildComponent;

      expect(probe2).not.toBe(probe1);
      expect(probe2.id).not.toBe(id1);
      expect(probe2.initValue).toBe('second');
    });

    it('renders nothing for the content template while closed', () => {
      const fixture = TestBed.createComponent(InstanceIdentityHostComponent);
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.directive(ProbeChildComponent))).toBeNull();
    });
  });

  describe('visibleChange forwarding', () => {
    it('forwards p-dialog close interactions through its own visibleChange output', () => {
      const fixture = TestBed.createComponent(InstanceIdentityHostComponent);
      fixture.componentInstance.visible = true;
      fixture.detectChanges();

      const dialog = fixture.debugElement.query(By.directive(EditDialogComponent))
        .componentInstance as EditDialogComponent;
      dialog.visibleChange.emit(false);

      expect(fixture.componentInstance.visible).toBe(false);
    });
  });

  describe('scroll-boundary wheel guard (ACC-36)', () => {
    // overscroll-behavior: contain alone was measured live to still leak a
    // few px of scroll to this dialog's own scroll area on some wheel
    // ticks, closing the overlay via PrimeNG's scroll-based auto-hide.
    // onWheel() is the targeted fix: only ever calls preventDefault() when
    // the listbox has genuinely exhausted its own scroll room in the
    // gesture's direction — every other tick must be left untouched.
    function makeListContainer(
      cls: string,
      { scrollTop, clientHeight, scrollHeight }: { scrollTop: number; clientHeight: number; scrollHeight: number },
    ): HTMLElement {
      const el = document.createElement('div');
      el.className = cls;
      Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
      Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
      return el;
    }

    function fireWheel(dialog: EditDialogComponent, target: HTMLElement, deltaY: number): boolean {
      const event = new WheelEvent('wheel', { deltaY, cancelable: true });
      Object.defineProperty(event, 'target', { value: target, configurable: true });
      dialog.onWheel(event);
      return event.defaultPrevented;
    }

    let dialog: EditDialogComponent;

    beforeEach(() => {
      dialog = TestBed.createComponent(EditDialogComponent).componentInstance;
    });

    it('ignores wheel events whose target is outside any listbox container', () => {
      const outsider = document.createElement('div');
      expect(fireWheel(dialog, outsider, 100)).toBe(false);
    });

    it('does NOT preventDefault mid-list (not yet at either boundary) — every non-boundary tick is untouched', () => {
      const list = makeListContainer('p-multiselect-list-container', {
        scrollTop: 120,
        clientHeight: 200,
        scrollHeight: 636,
      });
      expect(fireWheel(dialog, list, 120)).toBe(false); // scrolling down, not at bottom
      expect(fireWheel(dialog, list, -120)).toBe(false); // scrolling up, not at top
    });

    it('preventDefaults scrolling further down once genuinely at the bottom boundary', () => {
      const list = makeListContainer('p-multiselect-list-container', {
        scrollTop: 436,
        clientHeight: 200,
        scrollHeight: 636,
      });
      expect(fireWheel(dialog, list, 120)).toBe(true);
    });

    it('preventDefaults scrolling further up once genuinely at the top boundary', () => {
      const list = makeListContainer('p-select-list-container', {
        scrollTop: 0,
        clientHeight: 200,
        scrollHeight: 636,
      });
      expect(fireWheel(dialog, list, -120)).toBe(true);
    });

    it('does NOT preventDefault scrolling down from the top boundary — only the opposite direction is blocked there', () => {
      const list = makeListContainer('p-multiselect-list-container', {
        scrollTop: 0,
        clientHeight: 200,
        scrollHeight: 636,
      });
      expect(fireWheel(dialog, list, 120)).toBe(false);
    });

    it('covers both p-select and p-multiselect list-container class names', () => {
      const selectList = makeListContainer('p-select-list-container', {
        scrollTop: 0,
        clientHeight: 200,
        scrollHeight: 400,
      });
      const multiList = makeListContainer('p-multiselect-list-container', {
        scrollTop: 0,
        clientHeight: 200,
        scrollHeight: 400,
      });
      expect(fireWheel(dialog, selectList, -50)).toBe(true);
      expect(fireWheel(dialog, multiList, -50)).toBe(true);
    });
  });

  describe('scroll affordance', () => {
    it('stays absent for a short form that never needs to scroll', () => {
      const fixture = TestBed.createComponent(ScrollAffordanceHostComponent);
      fixture.componentInstance.tall = false;
      fixture.componentInstance.visible = true;
      fixture.detectChanges();

      const dialog = fixture.debugElement.query(By.directive(EditDialogComponent))
        .componentInstance as EditDialogComponent;
      expect(dialog.canScrollMore()).toBe(false);
    });

    it('appears for a tall form whose content exceeds the scroll area', () => {
      const fixture = TestBed.createComponent(ScrollAffordanceHostComponent);
      fixture.componentInstance.tall = true;
      fixture.componentInstance.visible = true;
      fixture.detectChanges();

      const dialog = fixture.debugElement.query(By.directive(EditDialogComponent))
        .componentInstance as EditDialogComponent;
      expect(dialog.canScrollMore()).toBe(true);
    });
  });
});
