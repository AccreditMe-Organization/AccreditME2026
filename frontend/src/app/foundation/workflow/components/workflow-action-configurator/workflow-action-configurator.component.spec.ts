// ACC-120 slice 7 — the workflow Actions dialog, read through its DOM: the
// kinds offered by name, the edit title, unsaved work on Cancel and Escape,
// the audit row that always runs, a refused toggle, header rows under ACC-277's
// write-once rules, the two webhook steps, the 5-header limit, a protected
// workflow, and Arabic.
//
// Buttons are found by their words and fields typed into, so each test says
// what a person does. Real translations, so the Arabic test reads real Arabic.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { environment } from '../../../../../environments/environment';
import { WorkflowActionConfiguratorComponent } from './workflow-action-configurator.component';
import { WorkflowTransitionActionDto } from '../../services/workflow-template.service';

const ACTIONS_URL = `${environment.apiUrl}/workflow-templates/transitions/actions`;

const action = (id: string, actionType: string, configJson: Record<string, unknown> | null = null, isEnabled = true): WorkflowTransitionActionDto => ({
  id,
  workflowTransitionId: 'tr-1',
  actionType,
  order: 10,
  isEnabled,
  configJson,
});

/** A stored webhook with these set headers, as the masked read returns it (ACC-277). */
const webhook = (names: string[], id = 'wh') =>
  action(id, 'WEBHOOK', {
    webhookUrl: 'https://hooks.example.com/accreditme',
    headers: Object.fromEntries(names.map((n) => [n, ''])),
    headersValueSet: Object.fromEntries(names.map((n) => [n, true])),
  });

describe('WorkflowActionConfiguratorComponent (ACC-120 slice 7)', () => {
  // First, so it runs last: the Arabic tests switch the document's language.
  preserveDocumentLanguage();

  let fixture: ComponentFixture<WorkflowActionConfiguratorComponent>;
  let http: HttpTestingController;
  let ask: jasmine.Spy;

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.cdk-overlay-container, .p-dialog-mask, .p-dialog').forEach((n) => n.remove());
  });

  function render(actions: WorkflowTransitionActionDto[], opts: { language?: 'en' | 'ar'; isProtected?: boolean } = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [WorkflowActionConfiguratorComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(opts.language ?? 'en');
    http = TestBed.inject(HttpTestingController);
    ask = spyOn(TestBed.inject(AmConfirmService), 'ask');
    fixture = TestBed.createComponent(WorkflowActionConfiguratorComponent);
    fixture.componentRef.setInput('transitionId', 'tr-1');
    fixture.componentRef.setInput('actions', actions);
    if (opts.isProtected) fixture.componentRef.setInput('isProtected', true);
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, c: fixture.componentInstance };
  }

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const body = (): HTMLElement => document.querySelector<HTMLElement>('.am-dialog__body')!;
  /** A dialog button by its words. */
  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('.p-dialog button')).find((b) => text(b) === label);
  const press = async (label: string): Promise<void> => {
    const b = button(label);
    expect(b).withContext(`a "${label}" button`).toBeDefined();
    b!.click();
    await settle();
  };
  const type = async (input: HTMLInputElement, value: string): Promise<void> => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  const rowOf = (root: HTMLElement, id: string): HTMLElement => root.querySelector<HTMLElement>(`tr[data-action-id="${id}"]`)!;
  const headerRows = (): HTMLElement[] => Array.from(body().querySelectorAll<HTMLElement>('[data-testid="action-header-row"]'));
  /** What the last PATCH sent, answered with the saved action. */
  const patched = (id: string): Record<string, unknown> => {
    const req = http.expectOne(`${ACTIONS_URL}/${id}`);
    expect(req.request.method).toBe('PATCH');
    const sent = req.request.body as Record<string, unknown>;
    req.flush(action(id, 'WEBHOOK'));
    return sent;
  };

  describe('the kinds offered', () => {
    it('names each kind, and offers neither Generate PDF nor Lock document', async () => {
      const { c } = render([]);
      c.openAdd();
      await settle();
      body().querySelector<HTMLElement>('.am-overlay-select-trigger')!.click();
      await settle();
      const options = Array.from(document.querySelectorAll('[role="option"]')).map((o) => text(o));
      expect(options).toEqual(['Send notification', 'Log to the audit trail', 'Webhook']);
    });

    it('names the kinds in Arabic', async () => {
      const { c } = render([], { language: 'ar' });
      c.openAdd();
      await settle();
      body().querySelector<HTMLElement>('.am-overlay-select-trigger')!.click();
      await settle();
      const options = Array.from(document.querySelectorAll('[role="option"]')).map((o) => text(o));
      expect(options).toEqual(['إرسال إشعار', 'التسجيل في سجل التدقيق', 'استدعاء ويب (Webhook)']);
    });
  });

  it('titles the edit form "Edit action", and gives a non-webhook kind one step with Save on it', async () => {
    const { c } = render([action('n1', 'SEND_NOTIFICATION')]);
    c.openEdit(action('n1', 'SEND_NOTIFICATION'));
    await settle();
    expect(text(document.querySelector('.p-dialog-title'))).toBe('Edit action');
    expect(document.querySelector('.am-steps')).toBeNull();
    expect(button('Next')).toBeUndefined();
    expect(button('Save')).toBeDefined();
  });

  describe('unsaved work', () => {
    it('asks before discarding on Cancel', async () => {
      const { c } = render([webhook([])]);
      c.openEdit(webhook([]));
      await settle();
      await type(body().querySelector<HTMLInputElement>('#action-webhook-url')!, 'https://changed.example.com');
      await press('Cancel');
      expect(ask).toHaveBeenCalled();
      expect(body()).not.toBeNull();
    });

    it('asks before discarding on Escape', async () => {
      const { c } = render([webhook([])]);
      c.openEdit(webhook([]));
      await settle();
      await type(body().querySelector<HTMLInputElement>('#action-webhook-url')!, 'https://changed.example.com');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await settle();
      expect(ask).toHaveBeenCalled();
    });

    it('asks on step 2 as well', async () => {
      const { c } = render([webhook(['Authorization'])]);
      c.openEdit(webhook(['Authorization']));
      await settle();
      await press('Next');
      await type(headerRows()[0]!.querySelector<HTMLInputElement>('input[type="password"]')!, 'Bearer typed');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      await settle();
      expect(ask).toHaveBeenCalled();
    });
  });

  describe('the table', () => {
    it('says the audit row always runs, with no Enabled box', () => {
      const { root } = render([action('au', 'LOG_AUDIT'), action('n1', 'SEND_NOTIFICATION')]);
      expect(text(rowOf(root, 'au').querySelector('[data-testid="action-state"]'))).toBe('Always runs');
      expect(rowOf(root, 'au').querySelector('p-checkbox')).toBeNull();
      // Guard: an ordinary row still has its box, named for its action.
      expect(rowOf(root, 'n1').querySelector('input[type="checkbox"]')!.getAttribute('aria-label')).toBe('Enabled: Send notification');
    });

    it('puts a refused toggle back, and says why', async () => {
      const { root } = render([action('n1', 'SEND_NOTIFICATION')]);
      await settle(); // ngModel writes its value on a microtask
      const box = rowOf(root, 'n1').querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(box.checked).toBe(true);
      box.click();
      await settle();
      http
        .expectOne(`${ACTIONS_URL}/n1`)
        .flush({ message: 'This action cannot be switched off now.' }, { status: 409, statusText: 'Conflict' });
      await settle();
      expect(rowOf(root, 'n1').querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
      expect(text(root.querySelector('[role="alert"]'))).toContain('This action cannot be switched off now.');
    });
  });

  describe('webhook headers (ACC-277: values are write-once)', () => {
    it('shows each stored header by name, with an empty password field and the hint', async () => {
      const { c } = render([webhook(['Authorization', 'X-Api-Key'])]);
      c.openEdit(webhook(['Authorization', 'X-Api-Key']));
      await settle();
      await press('Next');
      const rows = headerRows();
      expect(rows.map((r) => text(r.querySelector('[data-testid="action-header-name"]')))).toEqual(['Authorization', 'X-Api-Key']);
      for (const r of rows) {
        const value = r.querySelector<HTMLInputElement>('input[type="password"]')!;
        expect(value.value).toBe('');
        expect(value.getAttribute('autocomplete')).toBe('off');
        expect(value.getAttribute('dir')).toBe('ltr');
        expect(text(r.querySelector('[data-testid="action-header-hint"]'))).toBe('Set. Type a new value to replace it.');
      }
    });

    it('saves untouched headers as "" (which keeps them), and never sends headersValueSet', async () => {
      const { c } = render([webhook(['Authorization', 'X-Api-Key'])]);
      c.openEdit(webhook(['Authorization', 'X-Api-Key']));
      await settle();
      await press('Next');
      await press('Save');
      const sent = patched('wh');
      expect((sent['configJson'] as Record<string, unknown>)['headers']).toEqual({ Authorization: '', 'X-Api-Key': '' });
      expect(JSON.stringify(sent)).not.toContain('headersValueSet');
    });

    it('leaves a removed header out, which removes it', async () => {
      const { c } = render([webhook(['Authorization', 'X-Api-Key'])]);
      c.openEdit(webhook(['Authorization', 'X-Api-Key']));
      await settle();
      await press('Next');
      body().querySelector<HTMLElement>('button[aria-label="Remove header X-Api-Key"]')!.click();
      await settle();
      await press('Save');
      expect((patched('wh')['configJson'] as Record<string, unknown>)['headers']).toEqual({ Authorization: '' });
    });

    it('sends a value only when one is typed', async () => {
      const { c } = render([webhook(['Authorization', 'X-Api-Key'])]);
      c.openEdit(webhook(['Authorization', 'X-Api-Key']));
      await settle();
      await press('Next');
      await type(headerRows()[0]!.querySelector<HTMLInputElement>('input[type="password"]')!, 'Bearer new');
      await press('Save');
      expect((patched('wh')['configJson'] as Record<string, unknown>)['headers']).toEqual({ Authorization: 'Bearer new', 'X-Api-Key': '' });
    });
  });

  describe('the two webhook steps', () => {
    it('keeps every value across Next and Back', async () => {
      const { c } = render([webhook([])]);
      c.openEdit(webhook([]));
      await settle();
      await type(body().querySelector<HTMLInputElement>('#action-webhook-url')!, 'https://kept.example.com');
      await press('Next');
      await press('Add header');
      const row = headerRows()[0]!;
      await type(row.querySelector<HTMLInputElement>('[data-testid="action-header-name-input"]')!, 'X-Kept');
      await type(row.querySelector<HTMLInputElement>('input[type="password"]')!, 'kept-value');
      await press('Back');
      expect(body().querySelector<HTMLInputElement>('#action-webhook-url')!.value).toBe('https://kept.example.com');
      await press('Next');
      expect(headerRows()[0]!.querySelector<HTMLInputElement>('[data-testid="action-header-name-input"]')!.value).toBe('X-Kept');
      expect(headerRows()[0]!.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('kept-value');
    });

    it('goes back to step 1 when Save on step 2 finds an error there', async () => {
      const { c } = render([webhook([])]);
      c.openEdit(webhook([]));
      await settle();
      await press('Next');
      await press('Back');
      await type(body().querySelector<HTMLInputElement>('#action-webhook-url')!, '');
      // Back on step 1 with no URL, Next shows the error rather than moving on…
      await press('Next');
      expect(text(body())).toContain('Enter the webhook URL.');
      expect(button('Next')).toBeDefined();
      // …and a Save from step 2 with step 1 wrong comes back to it the same way.
      c.form.controls.webhookUrl.setValue('https://x.example.com');
      await settle();
      await press('Next');
      c.form.controls.webhookUrl.setValue('');
      await press('Save');
      expect(body().querySelector('#action-webhook-url')).not.toBeNull();
      expect(text(body())).toContain('Enter the webhook URL.');
    });

    it('stops at 5 headers and says so', async () => {
      const names = ['A-One', 'A-Two', 'A-Three', 'A-Four'];
      const { c } = render([webhook(names)]);
      c.openEdit(webhook(names));
      await settle();
      await press('Next');
      expect(button('Add header')).toBeDefined();
      await press('Add header');
      expect(headerRows().length).toBe(5);
      expect(button('Add header')).toBeUndefined();
      expect(text(body().querySelector('[data-testid="action-header-limit"]'))).toBe('Up to 5 headers.');
    });

    it('shows every stored header past the limit, in a list that scrolls', async () => {
      const names = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7'];
      const { c } = render([webhook(names)]);
      c.openEdit(webhook(names));
      await settle();
      await press('Next');
      expect(headerRows().map((r) => text(r.querySelector('[data-testid="action-header-name"]')))).toEqual(names);
      expect(getComputedStyle(body().querySelector('[data-testid="action-header-rows"]')!).overflowY).toBe('auto');
      expect(button('Add header')).toBeUndefined();
    });
  });

  describe('a protected workflow', () => {
    it('offers no write at all, and says why', () => {
      const { root } = render([action('n1', 'SEND_NOTIFICATION'), action('au', 'LOG_AUDIT')], { isProtected: true });
      expect(text(root.querySelector('[data-testid="actions-read-only"]'))).toBe(
        "The app sets this workflow, so its actions can't be changed here.",
      );
      expect(root.querySelector('input[type="checkbox"]')).toBeNull();
      expect(root.querySelectorAll('button').length).toBe(0);
      expect(text(rowOf(root, 'n1').querySelector('[data-testid="action-state"]'))).toBe('Enabled');
    });

    it('says why in Arabic', () => {
      const { root } = render([action('n1', 'SEND_NOTIFICATION')], { isProtected: true, language: 'ar' });
      expect(text(root.querySelector('[data-testid="actions-read-only"]'))).toBe(
        'يحدد التطبيق سير العمل هذا، لذا لا يمكن تغيير إجراءاته هنا.',
      );
    });
  });
});
