import { Component, Input, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ConfirmationService } from 'primeng/api';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
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


// ACC-111 — the dialog shell: sizes, a fixed footer, focus and the Escape
// contract.
@Component({
  standalone: true,
  imports: [EditDialogComponent],
  template: `
    <button id="trigger" (click)="visible = true">Open</button>
    <ng-template #formTpl>
      <label for="field-a">A</label>
      <input id="field-a" type="text" />
    </ng-template>
    <ng-template #footerTpl>
      <button id="save-btn">Save</button>
    </ng-template>
    <app-edit-dialog
      [visible]="visible"
      (visibleChange)="visible = $event"
      [content]="formTpl"
      [footer]="withFooter ? footerTpl : null"
      [size]="size"
      [dirty]="dirty"
      [saving]="saving"
    />
  `,
})
class ShellHostComponent {
  visible = false;
  withFooter = true;
  dirty = false;
  saving = false;
  size: 'confirm' | 'form' | 'picker' = 'form';
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
  @ViewChild('footerTpl', { read: TemplateRef, static: true }) footerTpl!: TemplateRef<unknown>;
}

describe('EditDialogComponent', () => {
  // ACC-111 — the dialog now asks before discarding unsaved work and reads its
  // discard wording from the translation files, so both services are real
  // dependencies rather than test scaffolding.
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ConfirmationService,
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
  });

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

  // ACC-111 — the dialog shell.
  describe('the shell (ACC-111)', () => {
    const open = async (setup: (h: ShellHostComponent) => void = () => {}) => {
      const fixture = TestBed.createComponent(ShellHostComponent);
      setup(fixture.componentInstance);
      fixture.componentInstance.visible = true;
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      return fixture;
    };

    const escape = (): void => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };

    it('takes its width from the size, not from the caller', async () => {
      const fixture = await open((h) => (h.size = 'confirm'));
      const dialog = document.querySelector('.p-dialog') as HTMLElement;
      expect(dialog.style.width).toContain('--am-dialog-confirm');
    });

    it('renders the footer OUTSIDE the scrolling body, so it cannot scroll away', async () => {
      const fixture = await open();
      const body = document.querySelector('.am-dialog__body');
      const save = document.querySelector('#save-btn');
      expect(save).toBeTruthy();
      expect(body?.contains(save!)).toBe(false);
    });

    it('moves focus to the first field, never the close button', async () => {
      const fixture = await open();
      expect((document.activeElement as HTMLElement)?.id).toBe('field-a');
    });

    it('closes on Escape when there is nothing to lose', async () => {
      const fixture = await open();
      escape();
      fixture.detectChanges();
      expect(fixture.componentInstance.visible).toBe(false);
    });

    it('asks before discarding unsaved work rather than closing on Escape', async () => {
      const fixture = await open((h) => (h.dirty = true));
      const confirmations: unknown[] = [];
      spyOn(TestBed.inject(ConfirmationService), 'confirm').and.callFake((c: unknown) => {
        confirmations.push(c);
        return TestBed.inject(ConfirmationService);
      });

      escape();
      fixture.detectChanges();

      expect(confirmations.length).toBe(1);
      expect(fixture.componentInstance.visible).toBe(true);
    });

    it('DISARMS Escape while a save is in flight — there is no outcome to return to yet', async () => {
      const fixture = await open((h) => {
        h.dirty = true;
        h.saving = true;
      });
      const confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');

      escape();
      fixture.detectChanges();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(fixture.componentInstance.visible).toBe(true);
    });

    it('hides the close button while saving, so the X cannot do what Escape refuses', async () => {
      const fixture = await open((h) => (h.saving = true));
      expect(document.querySelector('.p-dialog-header-close')).toBeNull();
    });

    it('returns focus to whatever opened it', async () => {
      const fixture = TestBed.createComponent(ShellHostComponent);
      fixture.detectChanges();
      const trigger = fixture.nativeElement.querySelector('#trigger') as HTMLButtonElement;
      trigger.focus();
      trigger.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect((document.activeElement as HTMLElement)?.id).toBe('field-a');

      escape();
      fixture.detectChanges();
      await fixture.whenStable();
      expect((document.activeElement as HTMLElement)?.id).toBe('trigger');
    });
  });
});
