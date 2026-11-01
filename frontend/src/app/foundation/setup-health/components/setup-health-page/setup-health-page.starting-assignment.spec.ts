import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AmConfirmOptions, AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { SetupConditionDto, SetupHealthDto } from '../../services/setup-health.service';
import { SetupHealthPageComponent } from './setup-health-page.component';

// ACC-271 PR 5a — "Workflow stage still on its starting assignment" (drawing
// section 11): its title and sub-line in both languages, Review stage opening
// the stage in its panel, Keep this assignment through the one confirm, and
// the built permission line instead of both actions.

const NOW = new Date('2026-11-01T09:00:00.000Z');
const API = environment.apiUrl;

const starting = (over: Partial<SetupConditionDto> = {}): SetupConditionDto => ({
  id: 'cond-1',
  type: 'STAGE_ON_STARTING_ASSIGNMENT',
  severity: 'AT_RISK',
  objectId: 'stage-1',
  subject: {
    nameEn: 'Under review',
    nameAr: 'قيد المراجعة',
    templateId: 'tpl-1',
    templateNameEn: 'Policy review',
    templateNameAr: 'مراجعة السياسات',
    adminName: 'Layla Al-Harbi',
  },
  openedAt: '2026-10-28T09:00:00.000Z',
  ageBasis: 'OBJECT',
  lastSeenAt: '2026-11-01T08:50:00.000Z',
  clearedAt: null,
  ...over,
});

const health = (open: SetupConditionDto[]): SetupHealthDto => ({
  open,
  recentlyCleared: [],
  freshness: [{ type: 'STAGE_ON_STARTING_ASSIGNMENT', status: 'CURRENT', computedAt: '2026-11-01T08:50:00.000Z' }],
});

describe('SetupHealthPageComponent — a stage on its starting assignment (ACC-271 PR 5a)', () => {
  let fixture: ComponentFixture<SetupHealthPageComponent>;
  let http: HttpTestingController;
  let ask: jasmine.Spy<(o: AmConfirmOptions) => void>;
  let permissions: Set<string>;

  function render(lang: 'en' | 'ar', open: SetupConditionDto[] = [starting()]): HTMLElement {
    ask = jasmine.createSpy('ask');
    TestBed.configureTestingModule({
      imports: [SetupHealthPageComponent],
      providers: [
        ConfirmationService,
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: AmConfirmService, useValue: { ask } },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.has(p) } },
        { provide: LanguageService, useValue: { isArabic: () => lang === 'ar' } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SetupHealthPageComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/setup-health`).flush(health(open));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const textOf = (el: Element | null): string => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(() => {
    permissions = new Set(['workflows:view', 'workflows:manage']);
    jasmine.clock().install();
    jasmine.clock().mockDate(NOW);
  });
  afterEach(() => {
    http.verify();
    jasmine.clock().uninstall();
  });

  it('says the condition and whose the work is, under its group, At risk', () => {
    const el = render('en');
    const group = el.querySelector('#health-group-STAGE_ON_STARTING_ASSIGNMENT')!;
    expect(textOf(group)).toBe('Workflow stage still on its starting assignment');
    const row = el.querySelector('li')!;
    expect(textOf(row)).toContain('Workflow stage still on its starting assignment');
    expect(textOf(row)).toContain(
      'Workflow: Policy review · Stage: Under review · Its work goes to Layla Al-Harbi until someone replaces this assignment.',
    );
    expect(textOf(el.querySelector('section section'))).toContain('At risk');
  });

  it('reads in Arabic, naming the workflow and the stage in Arabic', () => {
    const el = render('ar');
    const row = el.querySelector('li')!;
    expect(textOf(row)).toContain('مرحلة في مسار العمل ما زالت على الإسناد الأولي');
    expect(textOf(row)).toContain('مسار العمل: مراجعة السياسات · المرحلة: قيد المراجعة · يذهب عملها إلى Layla Al-Harbi إلى أن يُستبدل هذا الإسناد.');
    expect(textOf(el.querySelector('a.am-health-fix'))).toBe('مراجعة المرحلة');
    expect(textOf(el.querySelector('[data-testid="health-keep"]'))).toBe('الإبقاء على هذا الإسناد');
  });

  it('Review stage opens the stage in its panel: /workflows/{templateId}/stages?stage={id}', () => {
    const el = render('en');
    const link = el.querySelector<HTMLAnchorElement>('a.am-health-fix')!;
    expect(textOf(link)).toBe('Review stage');
    expect(link.getAttribute('href')).toBe('/workflows/tpl-1/stages?stage=stage-1');
  });

  it('Keep asks through the one confirm, then keeps it, reads the page again once, and says it closes on the next check', () => {
    const el = render('en');
    const keep = el.querySelector<HTMLButtonElement>('[data-testid="health-keep"]')!;
    expect(keep.getAttribute('aria-label')).toBe('Keep this assignment: Under review');
    keep.click();
    expect(ask).toHaveBeenCalledTimes(1);
    const options = ask.calls.mostRecent().args[0];
    expect(options.header).toBe('Keep Layla Al-Harbi on Under review?');
    expect(options.message).toBe('Setup health will stop flagging it.');
    expect(options.acceptLabel).toBe('Keep');
    expect(options.tone).toBe('neutral');
    // Nothing is sent until the confirm is accepted.
    http.expectNone(() => true);

    options.accept();
    const req = http.expectOne(`${API}/workflow-templates/stages/stage-1/keep-starting-assignment`);
    expect(req.request.method).toBe('POST');
    req.flush({ kept: true });
    // One reload; the condition is still open until the next hourly check.
    http.expectOne(`${API}/setup-health`).flush(health([starting()]));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="health-keep"]')).toBeNull();
    expect(textOf(el.querySelector('[data-testid="health-kept"]'))).toBe('Kept, closes on the next check');
    // Review stage stays.
    expect(el.querySelector('a.am-health-fix')).not.toBeNull();
  });

  it('a confirm asked in Arabic says it in Arabic', () => {
    const el = render('ar');
    el.querySelector<HTMLButtonElement>('[data-testid="health-keep"]')!.click();
    const options = ask.calls.mostRecent().args[0];
    expect(options.header).toBe('الإبقاء على Layla Al-Harbi في «قيد المراجعة»؟');
    expect(options.message).toBe('ستتوقف «سلامة الإعداد» عن التنبيه إليها.');
    expect(options.acceptLabel).toBe('إبقاء');
  });

  it('a failed Keep says so, and offers Keep again', () => {
    const el = render('en');
    el.querySelector<HTMLButtonElement>('[data-testid="health-keep"]')!.click();
    ask.calls.mostRecent().args[0].accept();
    http
      .expectOne(`${API}/workflow-templates/stages/stage-1/keep-starting-assignment`)
      .flush({ statusCode: 500 }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(textOf(el.querySelector('[role="alert"]'))).toBe('Couldn’t keep the assignment. Try again.');
    expect(el.querySelector('[data-testid="health-keep"]')).not.toBeNull();
  });

  it('without workflows:manage: the built permission line instead of both actions', () => {
    permissions = new Set(['workflows:view']);
    const el = render('en');
    expect(el.querySelector('a.am-health-fix')).toBeNull();
    expect(el.querySelector('[data-testid="health-keep"]')).toBeNull();
    expect(textOf(el.querySelector('li'))).toContain('Fixing this needs permission to manage workflows.');
  });

  it('a removed administrator reads as the organization’s administrator, never blank', () => {
    const el = render('en', [starting({ subject: { ...starting().subject, adminName: null } })]);
    expect(textOf(el.querySelector('li'))).toContain('Its work goes to the organization’s administrator until someone replaces this assignment.');
  });
});
