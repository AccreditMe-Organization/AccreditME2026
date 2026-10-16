import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AiSettingsComponent } from './ai-settings.component';
import { ITenant, TenantService } from '../../../tenant/services/tenant.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';

// ACC-120 slice 8 — the AI credits screen, against the real translation files.

function tenant(ai: Partial<ITenant['ai']> = {}, plan: ITenant['plan'] = 'STARTER'): ITenant {
  return {
    id: 'org-a',
    name: 'Org A',
    nameAr: null,
    slug: 'org-a',
    country: 'SA',
    timezone: 'Asia/Riyadh',
    language: 'en',
    logo: null,
    isPlatformOrg: false,
    modules: {},
    plan,
    ai: {
      enabled: true,
      monthlyCredits: 40,
      creditsUsed: 18,
      creditsRemaining: 22,
      resetDate: '2026-10-21T00:00:00.000Z',
      overageEnabled: false,
      pendingMonthlyCredits: null,
      periodStart: '2026-09-21T00:00:00.000Z',
      features: [],
      usage: [
        { key: 'document_summary', credits: 9, calls: 3 },
        { key: 'task_description_drafting', credits: 6, calls: 3 },
        { key: 'workload_balancing', credits: 3, calls: 3 },
      ],
      ...ai,
    },
  };
}

const SPENT = { monthlyCredits: 40, creditsUsed: 40, creditsRemaining: 0 };
const NONE = { enabled: false, monthlyCredits: 0, creditsUsed: 0, creditsRemaining: 0, resetDate: null, periodStart: null, usage: [] };

/** A breakdown row's cells, read one by one: they are separate spans. */
const cells = (row: Element): string =>
  Array.from(row.children)
    .map((c) => (c.textContent ?? '').trim())
    .filter((t) => t !== '')
    .join(' ');

async function render(answer: () => Observable<ITenant>, language: 'en' | 'ar' = 'en') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AiSettingsComponent],
    providers: [
      provideTranslateService({ lang: 'en' }),
      provideFormatTesting(),
      { provide: TenantService, useValue: { getCurrent: jasmine.createSpy('getCurrent').and.callFake(answer) } },
    ],
  });
  loadTranslationsForTest({ en, ar });
  TestBed.inject(TranslateService).use(language);
  const fixture = TestBed.createComponent(AiSettingsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const text = (selector: string): string => (root.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { fixture, root, text };
}

describe('AiSettingsComponent (ACC-120 slice 8)', () => {
  it('normal: the period, what is left of what, and a meter with a spoken value', async () => {
    const { root, text } = await render(() => of(tenant()));

    expect(root.querySelector('[data-ai-state]')?.getAttribute('data-ai-state')).toBe('normal');
    expect(text('h2')).toBe("This period's allowance");
    expect(text('[data-ai-period]')).toBe('21 Sep 2026 – 21 Oct 2026');
    expect(text('[data-ai-left]')).toContain('22');
    expect(text('[data-ai-left]')).toContain('credits left of');
    expect(root.querySelector('[data-ai-paused]')).toBeNull();

    const meter = root.querySelector('[role="meter"]')!;
    expect(meter.getAttribute('aria-label')).toBe('⁦22⁩ of 40 credits left');
    expect(meter.getAttribute('aria-valuenow')).toBe('22');
    expect(meter.getAttribute('aria-valuemax')).toBe('40');
    expect(root.querySelectorAll('[data-ai-segment]').length).toBe(3);
  });

  it('every number is set left to right in tabular figures', async () => {
    const { root } = await render(() => of(tenant()));
    const numbers = root.querySelectorAll('[data-ai-left] [dir="ltr"], [data-ai-used], [data-ai-row] [dir="ltr"]');
    expect(numbers.length).toBeGreaterThan(4);
    numbers.forEach((n) => expect(n.classList).toContain('tabular-nums'));
  });

  it('the breakdown names each feature, its credits and its percent, and reads each row as a sentence', async () => {
    const { root } = await render(() => of(tenant()));
    const rows = Array.from(root.querySelectorAll('[data-ai-row]'));
    expect(rows.map(cells)).toEqual([
      '▲ Document summaries 9 50%',
      '● Task drafts 6 33%',
      '■ Assignee suggestions 3 17%',
    ]);
    expect(rows[0].getAttribute('aria-label')).toBe('Document summaries: 9 credits, 50%');
  });

  it('spent: the paused chip says it in words, so the state is never colour alone', async () => {
    const { root, text } = await render(() => of(tenant(SPENT)));
    expect(root.querySelector('[data-ai-state]')?.getAttribute('data-ai-state')).toBe('spent');
    expect(text('[data-ai-paused]')).toBe('None left · AI is paused until 21 Oct 2026');
    expect(root.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('none: no meter and no zero, only the not-included shape with its reason and the plan', async () => {
    const { root, text } = await render(() => of(tenant(NONE)));
    expect(root.querySelector('[data-ai-state]')?.getAttribute('data-ai-state')).toBe('none');
    expect(root.querySelector('[role="meter"]')).toBeNull();
    expect(root.querySelector('[data-ai-left]')).toBeNull();
    expect(text('h2')).toBe("AI features aren't part of your plan");
    expect(text('[data-ai-none]')).toContain('on its Starter plan');
  });

  it('"Other" appears, with its note, when the log adds up to less than what was used', async () => {
    const { root } = await render(() => of(tenant({ creditsUsed: 24, creditsRemaining: 16 })));
    expect(root.querySelector('[data-ai-other-note]')).not.toBeNull();
    const last = Array.from(root.querySelectorAll('[data-ai-row]')).pop()!;
    expect(cells(last)).toBe('Other 6 25%');
  });

  it('nothing used yet: says so instead of an empty list', async () => {
    const { root } = await render(() => of(tenant({ creditsUsed: 0, creditsRemaining: 40, usage: [] })));
    expect(root.querySelector('[data-ai-nothing-used]')).not.toBeNull();
    expect(root.querySelector('[data-ai-breakdown]')).toBeNull();
  });

  it('denied: a 403 gets its own sentence, no retry, and none of the server\'s text', async () => {
    const refusal = new HttpErrorResponse({ status: 403, error: { message: 'Required permission: tenant:view' } });
    const { root, text } = await render(() => throwError(() => refusal));
    expect(text('[data-ai-denied]')).toBe(
      "You can't see this organization's AI credits. That needs permission to view the organization's settings.",
    );
    expect(root.textContent).not.toContain('Required permission');
    expect(root.querySelector('[data-ai-error]')).toBeNull();
  });

  it('error: a translated message and Retry, which asks again; never the server\'s text', async () => {
    let calls = 0;
    const failure = new HttpErrorResponse({ status: 500, error: { message: 'connect ECONNREFUSED' } });
    const { fixture, root, text } = await render(() => (++calls === 1 ? throwError(() => failure) : of(tenant())));
    expect(text('[data-ai-error]')).toContain("The AI credits couldn't be loaded.");
    expect(root.textContent).not.toContain('ECONNREFUSED');

    (root.querySelector('[data-ai-error] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(calls).toBe(2);
    expect(root.querySelector('[data-ai-state]')?.getAttribute('data-ai-state')).toBe('normal');
  });

  describe('in Arabic', () => {
    it('normal: the Arabic heading, and the noun agreeing with what is left', async () => {
      const { root, text } = await render(() => of(tenant()), 'ar');
      expect(text('h2')).toBe('رصيد هذه الفترة');
      expect(text('[data-ai-left]')).toContain('رصيدًا متبقيًا من');
      expect(root.querySelector('[role="meter"]')?.getAttribute('aria-label')).toBe('المتبقي ⁦22⁩ من 40 رصيدًا');
    });

    it('spent and none read in Arabic', async () => {
      const spent = await render(() => of(tenant(SPENT)), 'ar');
      expect(spent.text('[data-ai-paused]')).toContain('الذكاء الاصطناعي متوقف حتى');
      const none = await render(() => of(tenant(NONE)), 'ar');
      expect(none.text('h2')).toBe('ميزات الذكاء الاصطناعي ليست ضمن خطتك');
      expect(none.text('[data-ai-none]')).toContain('«المبتدئة»');
    });
  });
});
