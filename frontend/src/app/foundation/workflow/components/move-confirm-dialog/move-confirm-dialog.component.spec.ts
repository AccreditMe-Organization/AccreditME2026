import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { MoveConfirmDialogComponent } from './move-confirm-dialog.component';

// ACC-316 PR 6 — the reason gate: a move that needs a reason is never confirmed
// without one, and a move that needs none never sends one.
describe('MoveConfirmDialogComponent (ACC-316 PR 6)', () => {
  function create(needsReason: boolean) {
    TestBed.configureTestingModule({
      imports: [MoveConfirmDialogComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), providePrimeNG({}), ConfirmationService],
    });
    const fixture = TestBed.createComponent(MoveConfirmDialogComponent);
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('needsReason', needsReason);
    fixture.componentRef.setInput('copy', {
      titleKey: 'meeting.cancel.title',
      leadKey: 'meeting.cancel.lead',
      confirmKey: 'meeting.cancel.confirm',
      keepKey: 'meeting.cancel.keep',
      danger: true,
    });
    fixture.detectChanges();
    const emitted: (string | null)[] = [];
    fixture.componentInstance.confirmed.subscribe((r) => emitted.push(r));
    return { c: fixture.componentInstance, fixture, emitted };
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  it('refuses to confirm with no reason, and shows the error instead', () => {
    const { c, emitted } = create(true);
    c.confirm();
    expect(emitted).toEqual([]);
    expect(c.showErrors()).toBeTrue();
  });

  it('a reason of spaces is no reason', () => {
    const { c, emitted } = create(true);
    c.form.controls.reason.setValue('   ');
    c.confirm();
    expect(emitted).toEqual([]);
  });

  it('confirms with the reason, trimmed', () => {
    const { c, emitted } = create(true);
    c.form.controls.reason.setValue('  The chair is away.  ');
    c.confirm();
    expect(emitted).toEqual(['The chair is away.']);
  });

  it('a move that needs no reason confirms at once, sending none', () => {
    const { c, emitted } = create(false);
    c.form.controls.reason.setValue('typed earlier');
    c.confirm();
    expect(emitted).toEqual([null]);
  });

  it('confirms nothing while a press is on its way', () => {
    const { c, fixture, emitted } = create(false);
    fixture.componentRef.setInput('busy', true);
    c.confirm();
    expect(emitted).toEqual([]);
  });

  it('every opening starts clean', () => {
    const { c, fixture } = create(true);
    c.form.controls.reason.setValue('old');
    c.confirm();
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    expect(c.form.controls.reason.value).toBe('');
    expect(c.showErrors()).toBeFalse();
  });
});
