import { Component, TemplateRef, ViewChild, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { EditDialogComponent } from './edit-dialog.component';

/**
 * ACC-120 — A DIALOG OPENED FROM INSIDE ANOTHER DIALOG MUST NOT BE CLIPPED BY IT.
 *
 * This lives on the SHELL rather than on the consumer that found it, because
 * the defect was never one consumer's configuration: `appendTo` defaulted to
 * 'self', so a nested dialog rendered as a descendant of the parent's
 * `.am-dialog__body` — `max-height: min(420px, 60vh)`, `overflow-y: auto` — and
 * inherited its clip. Three consumers had already set 'body' by hand, which is
 * what a bad default looks like from the outside: everyone who meets it works
 * around it locally and the next one repeats it.
 *
 * Measured in a browser before this was written: the Arrange-cover dialog froze
 * at 392px in both its views while New Task, the same shell hosted at page
 * level, reached 551. Its form view had been losing 21px since it was written.
 *
 * ## Why these assertions are STRUCTURAL and not pixels
 *
 * The clip lands on `.p-dialog-content`, which belongs to PrimeNG. Our own
 * `.am-dialog__body` reports its natural height and never overflows — it renders
 * correctly inside a parent that clips it. So no measurement of our element can
 * see this, and two rounds of trying taught us that the honest thing to pin is
 * the structure that causes it. That is also layout-free, so it holds in a
 * harness that cannot lay PrimeNG out at all.
 */
@Component({
  standalone: true,
  imports: [EditDialogComponent],
  template: `
    <ng-template #innerTpl>
      <p id="inner-content">inner</p>
    </ng-template>
    <ng-template #outerTpl>
      <p id="outer-content">outer</p>
      <app-edit-dialog [visible]="innerOpen()" header="Inner" [content]="innerTpl" />
    </ng-template>
    <app-edit-dialog [visible]="true" header="Outer" [content]="outerTpl" />
  `,
})
class NestedHost {
  @ViewChild('innerTpl', { read: TemplateRef, static: true }) innerTpl!: TemplateRef<unknown>;
  @ViewChild('outerTpl', { read: TemplateRef, static: true }) outerTpl!: TemplateRef<unknown>;
  readonly innerOpen = signal(true);
}

/** Every ancestor class from `el` up to <body>, nearest first. */
function ancestry(el: Element): string[] {
  const out: string[] = [];
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (p.classList.contains('am-dialog__body')) out.push('.am-dialog__body');
    if (p.classList.contains('p-dialog-content')) out.push('.p-dialog-content');
  }
  return out;
}

describe('EditDialogComponent — a dialog inside a dialog (ACC-120)', () => {
  function setup(): NestedHost {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NestedHost],
      providers: [ConfirmationService, provideTranslateService({ lang: 'en' })],
    });
    const fixture = TestBed.createComponent(NestedHost);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('renders both dialogs', () => {
    setup();

    expect(document.querySelector('#outer-content')).not.toBeNull();
    expect(document.querySelector('#inner-content')).not.toBeNull();
  });

  // THE GUARANTEE. Each dialog's content sits inside exactly ONE
  // .am-dialog__body and ONE .p-dialog-content — its own. A second pair means it
  // is nested inside the other dialog and has inherited its clip.
  for (const which of ['outer', 'inner'] as const) {
    it(`the ${which} dialog's content has exactly one dialog body above it`, () => {
      setup();
      const content = document.querySelector(`#${which}-content`);
      expect(content).not.toBeNull();

      const above = ancestry(content!);
      expect(above.filter((c) => c === '.am-dialog__body').length)
        .withContext(`ancestors: ${above.join(' < ')}`)
        .toBe(1);
      expect(above.filter((c) => c === '.p-dialog-content').length)
        .withContext(`ancestors: ${above.join(' < ')}`)
        .toBe(1);
    });
  }

  // No ancestor between a dialog and <body> may scroll it. This is the property
  // the pixels followed from: the parent's body scrolls, so a nested dialog
  // inside it could never grow past the parent's cap.
  it('has no scrolling ancestor between any dialog and <body>', () => {
    setup();
    const offenders: string[] = [];
    for (const panel of Array.from(document.querySelectorAll('.p-dialog'))) {
      for (let p = panel.parentElement; p && p !== document.body; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          offenders.push(p.className || p.tagName);
        }
      }
    }
    expect(offenders)
      .withContext('a scrolling ancestor is what froze a nested dialog at its parent cap')
      .toEqual([]);
  });

  // The mechanism, named so a regression reports itself rather than showing up
  // as "the dialog looks short". If appendTo becomes an input again and defaults
  // to 'self', this is the test that fails first.
  it('appends every dialog outside its own component tree', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NestedHost],
      providers: [ConfirmationService, provideTranslateService({ lang: 'en' })],
    });
    const fixture = TestBed.createComponent(NestedHost);
    fixture.detectChanges();

    expect(document.querySelector('#inner-content')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#inner-content'))
      .withContext('inside the component tree means inside every ancestor clip')
      .toBeNull();
  });
});
