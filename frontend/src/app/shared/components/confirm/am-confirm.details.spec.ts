import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { AmConfirmOptions, AmConfirmService, CONFIRM_ACCEPT_CLASS } from './am-confirm.service';
import { ConfirmHostComponent } from './confirm-host.component';

/**
 * ACC-240 — ask()'s optional `details`: lines listed in the confirm, before the
 * consequence (Approve: the changes in words, then the task it creates). Still
 * a confirm — one question, two buttons, no fields. Without `details` the
 * confirm is exactly as before. Rendered with the real host and PrimeNG dialog.
 */
@Component({
  standalone: true,
  imports: [ConfirmHostComponent],
  template: `<button id="opener" type="button">Approve…</button><am-confirm-host />`,
})
class HostComponent {
  readonly confirm = inject(AmConfirmService);
}

describe('AmConfirmService.ask() — details (ACC-240)', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ lang: 'en' }), providePrimeNG({}), ConfirmationService],
    });
    TestBed.inject(TranslateService).setTranslation('en', { common: { cancel: 'Cancel', close: 'Close' } });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.querySelectorAll('.p-confirmdialog, .p-dialog-mask').forEach((n) => n.remove());
  });

  const confirmEl = () => document.querySelector<HTMLElement>('.p-confirmdialog');

  async function until(condition: () => boolean, what: string, turns = 100): Promise<void> {
    for (let turn = 0; !condition(); turn++) {
      if (turn >= turns) throw new Error(`timed out waiting for ${what}`);
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function ask(overrides: Partial<AmConfirmOptions> = {}): Promise<void> {
    document.getElementById('opener')!.focus();
    fixture.componentInstance.confirm.ask({
      tone: 'neutral',
      header: 'Approve and apply these changes?',
      message: 'A task to revise the terms of reference will be created for Nora Al-Otaibi.',
      acceptLabel: 'Approve',
      accept: () => undefined,
      ...overrides,
    });
    fixture.detectChanges();
    await until(() => !!confirmEl()?.querySelector(`button.${CONFIRM_ACCEPT_CLASS}`), 'the confirm to open');
  }

  it('lists the details in order, before the message, as a list', async () => {
    await ask({ details: ['Quorum: 5 → 6', 'Reports to: Quality & Patient Safety Council → Medical Executive Committee'] });
    const list = confirmEl()!.querySelector('[data-testid="confirm-details"]');
    // Non-vacuity first: the list really rendered.
    expect(list).withContext('the details list').not.toBeNull();
    expect(Array.from(list!.querySelectorAll('li')).map((li) => li.textContent!.trim())).toEqual([
      'Quorum: 5 → 6',
      'Reports to: Quality & Patient Safety Council → Medical Executive Committee',
    ]);
    const message = confirmEl()!.querySelector('.p-confirmdialog-message')!;
    expect(message.textContent!.trim()).toBe('A task to revise the terms of reference will be created for Nora Al-Otaibi.');
    // The list comes first, then the consequence.
    expect(list!.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('without details: no list, and the message as PrimeNG drew it before', async () => {
    await ask();
    expect(confirmEl()!.querySelector('[data-testid="confirm-details"]')).toBeNull();
    expect(confirmEl()!.querySelector('.p-confirmdialog-message')!.textContent!.trim()).toBe(
      'A task to revise the terms of reference will be created for Nora Al-Otaibi.',
    );
  });

  it('an empty details list is no list', async () => {
    await ask({ details: [] });
    expect(confirmEl()!.querySelector('[data-testid="confirm-details"]')).toBeNull();
  });

  it('details are text, never markup', async () => {
    await ask({ details: ['<b>Quorum</b>: 5 → 6'] });
    const li = confirmEl()!.querySelector('[data-testid="confirm-details"] li')!;
    expect(li.querySelector('b')).toBeNull();
    expect(li.textContent!.trim()).toBe('<b>Quorum</b>: 5 → 6');
  });
});
