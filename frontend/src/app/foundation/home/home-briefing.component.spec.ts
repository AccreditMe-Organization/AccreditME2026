import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { AiBriefingService, BriefingViewDto } from './ai-briefing.service';
import { HomeBriefingComponent } from './home-briefing.component';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';

const TODAY: BriefingViewDto['briefing'] = {
  language: 'en',
  lead: 'Two tasks are overdue and one waits for your decision.',
  generatedAt: '2026-10-13T04:40:00.000Z', // 07:40 in Riyadh
  creditCost: 5,
  focus: [
    {
      item: { key: 'T1', type: 'TASK', id: 'task-1', title: 'Close CAPA-0912', dueAt: '2026-10-07T09:00:00.000Z', link: { target: 'task', id: 'task-1' }, done: false },
      reason: 'It is a week late and blocks the audit.',
    },
  ],
  groups: [
    {
      kind: 'overdue',
      items: [
        { key: 'T1', type: 'TASK', id: 'task-1', title: 'Close CAPA-0912', dueAt: '2026-10-07T09:00:00.000Z', link: { target: 'task', id: 'task-1' }, done: false },
        { key: 'T2', type: 'TASK', id: 'task-2', title: 'Submit hand hygiene figures', dueAt: '2026-10-09T09:00:00.000Z', link: { target: 'task', id: 'task-2' }, done: true },
      ],
    },
    {
      kind: 'decision',
      items: [
        { key: 'R1', type: 'TASK_REQUEST', id: 'req-1', title: 'Update audit tool', requestType: 'EXTENSION', requestedFor: '2026-10-20T09:00:00.000Z', link: { target: 'request', id: 'req-1' }, done: false },
      ],
    },
    {
      kind: 'notification',
      items: [{ key: 'N1', type: 'NOTIFICATION', id: 'n-1', title: 'AI credits allocated', titleAr: null, createdAt: '2026-10-13T03:00:00.000Z', link: null, done: false }],
    },
  ],
};

describe('HomeBriefingComponent (ACC-198)', () => {
  let fixture: ComponentFixture<HomeBriefingComponent>;
  let get: jasmine.Spy;
  let make: jasmine.Spy;
  let admin: boolean;
  let arabic: boolean;
  const el = () => fixture.nativeElement as HTMLElement;
  const trigger = () => el().querySelector('.am-ai__trigger') as HTMLButtonElement | null;
  const render = () => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  function build(view: BriefingViewDto): void {
    get = jasmine.createSpy('get').and.returnValue(of(view));
    make = jasmine.createSpy('make');
    TestBed.configureTestingModule({
      imports: [HomeBriefingComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: AiBriefingService, useValue: { get, make } },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => admin && p === 'tenant:manage_config' } },
        { provide: AuthService, useValue: { currentUser: () => ({ name: 'Hessa Al-Dosari' }) } },
        { provide: LanguageService, useValue: { isArabic: () => arabic, bilingual: (e: string, a: string | null) => (arabic && a ? a : e) } },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    loadTranslationsForTest({ en, ar });
    translate.use(arabic ? 'ar' : 'en');
    fixture = TestBed.createComponent(HomeBriefingComponent);
    render();
  }

  beforeEach(() => {
    admin = true;
    arabic = false;
  });

  it('a user without tenant:manage_config: no card, and the server is not asked', () => {
    admin = false;
    build({ available: true, creditCost: 5, greeting: 'morning', briefing: null });
    expect(get).not.toHaveBeenCalled();
    expect(el().querySelector('.am-briefing')).toBeNull();
  });

  it('feature not open or AI off, nothing made today: no card, no button, no error', () => {
    build({ available: false, creditCost: null, greeting: 'morning', briefing: null });
    expect(el().querySelector('.am-briefing')).toBeNull();
  });

  it('the button face: the intro line and "Prepare my briefing · 5 credits" (D2)', () => {
    build({ available: true, creditCost: 5, greeting: 'morning', briefing: null });
    expect(el().querySelector('.am-briefing__intro')!.textContent).toContain('A short AI summary');
    expect(trigger()!.textContent).toContain('Prepare my briefing');
    expect(trigger()!.textContent).toContain('· 5 credits');
  });

  it('pressing sends the language the user is reading in, shows the working face, then the briefing', () => {
    build({ available: true, creditCost: 5, greeting: 'morning', briefing: null });
    const answer = new Subject<BriefingViewDto>();
    make.and.returnValue(answer);
    trigger()!.click();
    render();
    expect(make).toHaveBeenCalledWith('en');
    expect(trigger()!.disabled).toBe(true);
    expect(el().querySelector('.am-ai__tag')!.textContent).toContain('Your briefing · being prepared');
    expect(el().querySelector('.am-ai__working-text')!.textContent).toContain('Preparing your briefing…');

    answer.next({ available: true, creditCost: 5, greeting: 'morning', briefing: TODAY });
    render();
    expect(el().querySelector('.am-briefing__hello')!.textContent).toContain('Good morning, Hessa Al-Dosari.');
    expect(el().querySelector('.am-ai__tag')!.textContent).toContain('made by AI at 07:40');
  });

  it('the briefing: lead, Focus on these first, groups in order with our links and dates, "done", Show the full list', () => {
    build({ available: true, creditCost: 5, greeting: 'afternoon', briefing: TODAY });
    const text = el().textContent!;
    expect(text).toContain('Good afternoon, Hessa Al-Dosari.');
    expect(text).toContain('Two tasks are overdue and one waits for your decision.');
    expect(text).toContain('Focus on these first');
    expect(text).toContain('It is a week late and blocks the audit.');
    const heads = Array.from(el().querySelectorAll('.am-briefing__head')).map((h) => h.textContent!.trim());
    expect(heads).toEqual(['Focus on these first', 'Overdue · 2', 'Waiting for your decision · 1', 'New since yesterday · 1']);
    expect(el().querySelector('.am-briefing__head--warn')!.textContent).toContain('Overdue');

    const links = Array.from(el().querySelectorAll('a.am-briefing__link')) as HTMLAnchorElement[];
    // ACC-228 — a task opens its own page; a 'request' link (saved before
    // ACC-228, with the request's id) still lands on My tasks' decision row.
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/tasks/task-1', '/tasks/task-1', '/tasks/task-2', '/tasks?request=req-1']);
    expect(el().querySelector('.am-briefing__link--plain')!.textContent).toContain('AI credits allocated');
    expect(el().querySelectorAll('.am-briefing__done')).toHaveSize(1);
    expect(text).toContain('More time to 20 Oct 2026');
    expect(trigger()!.textContent).toContain('Make a new briefing');
    expect(el().querySelector('.am-briefing__show-all')!.textContent).toContain('Show the full list');
  });

  it('a quiet day: the drawing\'s sentence, no groups, no focus', () => {
    build({
      available: true,
      creditCost: 5,
      greeting: 'morning',
      briefing: { ...TODAY!, lead: 'Nothing is overdue or due today, and nothing waits for you.', creditCost: 0, focus: [], groups: [] },
    });
    expect(el().textContent).toContain('Nothing is overdue or due today, and nothing waits for you.');
    expect(el().querySelectorAll('.am-briefing__head')).toHaveSize(0);
  });

  it('no valid focus picks → the section is not shown (D13)', () => {
    build({ available: true, creditCost: 5, greeting: 'morning', briefing: { ...TODAY!, focus: [] } });
    expect(el().textContent).not.toContain('Focus on these first');
  });

  it('after a press, credits used up shows inside the card, and the earlier briefing stays below (D1)', () => {
    build({ available: true, creditCost: 5, greeting: 'morning', briefing: TODAY });
    make.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'AI_CREDITS_EXHAUSTED', renewsAt: '2026-10-21T00:00:00.000Z' } })),
    );
    trigger()!.click();
    render();
    expect(el().querySelector('.am-ai__refusal')!.textContent).toContain('They renew on 21 Oct 2026');
    expect(el().textContent).toContain('Two tasks are overdue');
    expect(trigger()!.textContent).toContain('Make a new briefing');
  });

  it('a failure that is not an AI refusal reads as unavailable, with Try again that presses again', () => {
    build({ available: true, creditCost: 5, greeting: 'morning', briefing: null });
    make.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    trigger()!.click();
    render();
    const box = el().querySelector('.am-ai__refusal--failed')!;
    expect(box.textContent).toContain("AI isn't available right now");
    make.and.returnValue(of({ available: true, creditCost: 5, greeting: 'morning', briefing: TODAY }));
    (box.querySelector('button') as HTMLButtonElement).click();
    render();
    expect(make).toHaveBeenCalledTimes(2);
    expect(el().textContent).toContain('Two tasks are overdue');
  });

  it('a briefing made today stays visible with no button when the feature has since closed (D12)', () => {
    build({ available: false, creditCost: null, greeting: 'morning', briefing: TODAY });
    expect(el().textContent).toContain('Two tasks are overdue');
    expect(trigger()).toBeNull();
  });

  it('in Arabic: Arabic words, the request sent in Arabic, and an English briefing marked as English (D4)', () => {
    arabic = true;
    build({ available: true, creditCost: 5, greeting: 'morning', briefing: TODAY });
    expect(el().textContent).toContain('صباح الخير يا Hessa Al-Dosari.');
    expect(el().textContent).toContain('ابدأ بهذه أولًا');
    const lead = el().querySelector('.am-briefing__lead')!;
    expect(lead.getAttribute('lang')).toBe('en');
    expect(lead.getAttribute('dir')).toBe('ltr');
    expect(trigger()!.textContent).toContain('إعداد موجز جديد');
    expect(trigger()!.textContent).toContain('· 5');
    make.and.returnValue(of({ available: true, creditCost: 5, greeting: 'morning', briefing: { ...TODAY!, language: 'ar' } }));
    trigger()!.click();
    expect(make).toHaveBeenCalledWith('ar');
  });
});
