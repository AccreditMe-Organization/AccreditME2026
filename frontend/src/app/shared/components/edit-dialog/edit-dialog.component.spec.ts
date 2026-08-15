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
