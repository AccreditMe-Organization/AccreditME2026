import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { ADMIN_ACCESS } from '../../core/navigation/admin-access';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { MyWorkCountsService } from '../home/my-work-counts.service';
import { SetupHealthService, SetupHealthSummaryDto } from '../setup-health/services/setup-health.service';
import { AdminConsoleComponent } from './admin-console.component';

// ACC-292 — the Administration console. Which cards a person sees is the nav
// model's answer (nav-items.spec.ts covers the items); this covers what the
// page makes of it: the strip, the groups, the cards and Find a setting.
describe('AdminConsoleComponent (ACC-292)', () => {
  preserveDocumentLanguage();

  const FULL_ADMIN = [
    ADMIN_ACCESS,
    'setup:view',
    'users:view',
    'roles:view',
    'org:view',
    'positions:view',
    'workflows:manage',
    'lookups:view',
    'tenant:view',
    'tenant:manage_config',
  ];

  let fixture: ComponentFixture<AdminConsoleComponent>;
  let summary: ReturnType<typeof signal<SetupHealthSummaryDto | null>>;

  function render(opts: { permissions: string[]; summary?: SetupHealthSummaryDto | null; language?: 'en' | 'ar' }): HTMLElement {
    summary = signal<SetupHealthSummaryDto | null>(opts.summary === undefined ? { open: 3, blocksWork: 1 } : opts.summary);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminConsoleComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        provideFormatTesting(),
        {
          provide: NavigationAccessService,
          useValue: {
            hasPermission: (p: string) => opts.permissions.includes(p),
            isModuleEnabled: () => false,
            isPlatformAdmin: () => false,
          },
        },
        { provide: MyWorkCountsService, useValue: { isCommitteeMember: () => false } },
        // The rail's summary, shared: the console never requests one.
        { provide: SetupHealthService, useValue: { summary: summary.asReadonly() } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(opts.language ?? 'en');
    fixture = TestBed.createComponent(AdminConsoleComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const groups = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-group]')).map((g) => g.getAttribute('data-group'));
  const cards = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-card]')).map((c) => c.getAttribute('data-card'));
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const find = (el: HTMLElement, query: string) => {
    const input = el.querySelector<HTMLInputElement>('[data-testid="admin-console-find"]')!;
    input.value = query;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const marks = (el: HTMLElement) => Array.from(el.querySelectorAll('mark')).map((m) => m.textContent);

  describe('the page', () => {
    it('is titled Administration, with the design’s line under it', () => {
      const el = render({ permissions: FULL_ADMIN });
      expect(text(el.querySelector('h1'))).toBe('Administration');
      expect(text(el.querySelector('app-page-header p'))).toBe(
        'Every setting for your organisation, in one place. Each opens its own page.',
      );
    });

    it('a full administrator: 13 cards in 4 groups, in the design’s order', () => {
      const el = render({ permissions: FULL_ADMIN });
      expect(groups(el)).toEqual(['people', 'organisation', 'work', 'connections']);
      expect(cards(el)).toEqual([
        'users',
        'roles',
        'organization',
        'orgPositions',
        'organizationProfile',
        'workflows',
        'workingCalendar',
        'taskSla',
        'lookups',
        'emailProvider',
        'aiCredits',
        'fileStorage',
        'recycleBin',
      ]);
      expect(cards(el)).withContext('Setup health has no card').not.toContain('setupHealth');
    });

    it('each card is one link to its page, with the item’s own name and the line', () => {
      const el = render({ permissions: FULL_ADMIN });
      const card = el.querySelector<HTMLAnchorElement>('[data-card="taskSla"]')!;
      expect(card.tagName).toBe('A');
      expect(card.getAttribute('href')).toBe('/admin-settings/task-sla');
      expect(text(card.querySelector('.am-console__name'))).toBe('Task SLA');
      expect(text(card.querySelector('.am-console__line'))).toBe('Due times by priority, and when late tasks escalate.');
      expect(card.querySelector('.am-console__icon i')?.className).toContain('pi-clock');
    });

    it('a custom role with users:view and roles:view: two cards, one group, no strip', () => {
      const el = render({ permissions: [ADMIN_ACCESS, 'users:view', 'roles:view'] });
      expect(cards(el)).toEqual(['users', 'roles']);
      expect(groups(el)).withContext('the empty groups are hidden').toEqual(['people']);
      expect(el.querySelector('[data-testid="admin-console-strip"]')).toBeNull();
      expect(el.querySelector('[data-testid="admin-console-quiet"]')).toBeNull();
    });

    it('a card shows only with its page’s permission (tenant:view alone: Organization Profile)', () => {
      const el = render({ permissions: [ADMIN_ACCESS, 'tenant:view'] });
      expect(cards(el)).toEqual(['organizationProfile']);
      expect(groups(el)).toEqual(['organisation']);
    });
  });

  describe('the Setup health strip', () => {
    it('1 blocks work and 2 at risk, with the link to Setup health', () => {
      const el = render({ permissions: FULL_ADMIN, summary: { open: 3, blocksWork: 1 } });
      const strip = el.querySelector('[data-testid="admin-console-strip"]')!;
      expect(text(strip.querySelector('.am-console__strip-title'))).toBe('Setup health');
      expect(text(el.querySelector('[data-testid="admin-console-blocks"]'))).toBe('● 1 blocks work');
      expect(text(el.querySelector('[data-testid="admin-console-at-risk"]'))).toBe('● 2 at risk');
      const link = strip.querySelector('a')!;
      expect(link.getAttribute('href')).toBe('/setup-health');
      expect(text(link)).toBe('Open Setup health');
      expect(strip.classList).toContain('am-console__strip--blocks');
    });

    it('nothing blocking: no blocks chip, and the at-risk border', () => {
      const el = render({ permissions: FULL_ADMIN, summary: { open: 2, blocksWork: 0 } });
      expect(el.querySelector('[data-testid="admin-console-blocks"]')).toBeNull();
      expect(text(el.querySelector('[data-testid="admin-console-at-risk"]'))).toBe('● 2 at risk');
      expect(el.querySelector('[data-testid="admin-console-strip"]')!.classList).not.toContain('am-console__strip--blocks');
    });

    it('nothing open: the quiet line', () => {
      const el = render({ permissions: FULL_ADMIN, summary: { open: 0, blocksWork: 0 } });
      expect(el.querySelector('[data-testid="admin-console-strip"]')).toBeNull();
      expect(text(el.querySelector('[data-testid="admin-console-quiet"]'))).toBe('✓ Setup health: nothing open.');
    });

    it('in Arabic, the design’s words', () => {
      const el = render({ permissions: FULL_ADMIN, summary: { open: 3, blocksWork: 1 }, language: 'ar' });
      expect(text(el.querySelector('[data-testid="admin-console-blocks"]'))).toBe('● 1 يعطّل العمل');
      expect(text(el.querySelector('[data-testid="admin-console-at-risk"]'))).toBe('● 2 معرّضة للخطر');
      expect(text(el.querySelector('[data-testid="admin-console-strip"] a'))).toBe('فتح سلامة الإعداد');
      TestBed.inject(TranslateService).use('en');
    });

    it('only for a setup:view holder: no strip without it, whatever the summary holds', () => {
      const el = render({ permissions: FULL_ADMIN.filter((p) => p !== 'setup:view'), summary: { open: 3, blocksWork: 1 } });
      expect(cards(el).length).withContext('non-vacuity: the page renders').toBe(13);
      expect(el.querySelector('[data-testid="admin-console-strip"]')).toBeNull();
      expect(el.querySelector('[data-testid="admin-console-quiet"]')).toBeNull();
    });

    it('before the rail’s summary arrives (or if it failed): no strip, never a false quiet line', () => {
      const el = render({ permissions: FULL_ADMIN, summary: null });
      expect(el.querySelector('[data-testid="admin-console-strip"]')).toBeNull();
      expect(el.querySelector('[data-testid="admin-console-quiet"]')).toBeNull();
      summary.set({ open: 0, blocksWork: 0 });
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="admin-console-quiet"]')).not.toBeNull();
    });
  });

  describe('Find a setting', () => {
    it('is labelled, with a polite live region for its result line', () => {
      const el = render({ permissions: FULL_ADMIN });
      const input = el.querySelector('#am-console-find')!;
      expect(text(el.querySelector('label[for="am-console-find"]'))).toBe('Find a setting');
      expect(input.getAttribute('placeholder')).toBe('Find a setting');
      const result = el.querySelector('[data-testid="admin-console-result"]')!;
      expect(result.getAttribute('aria-live')).toBe('polite');
      expect(text(result)).withContext('nothing typed, nothing said').toBe('');
    });

    it('in English: "calendar" keeps Working Calendar, marks it, and hides the other groups', () => {
      const el = render({ permissions: FULL_ADMIN });
      find(el, 'calendar');
      expect(cards(el)).toEqual(['workingCalendar']);
      expect(groups(el)).toEqual(['work']);
      expect(marks(el)).toEqual(['Calendar']);
      expect(text(el.querySelector('[data-testid="admin-console-result"]'))).toBe('1 setting matches');
    });

    it('matches the line when the name does not, and marks it there', () => {
      const el = render({ permissions: FULL_ADMIN });
      find(el, 'holidays');
      expect(cards(el)).toEqual(['workingCalendar']);
      expect(marks(el)).toEqual(['holidays']);
    });

    it('counts several matches: "settings match"', () => {
      const el = render({ permissions: FULL_ADMIN });
      find(el, 'org');
      expect(cards(el).length).toBeGreaterThan(1);
      expect(text(el.querySelector('[data-testid="admin-console-result"]'))).toBe(`${cards(el).length} settings match`);
    });

    it('by a synonym: "SMTP" finds Email Provider (no mark: the word is not on the card)', () => {
      const el = render({ permissions: FULL_ADMIN });
      find(el, 'SMTP');
      expect(cards(el)).toEqual(['emailProvider']);
      expect(marks(el)).toEqual([]);
    });

    it('an Arabic query in an English session finds the card by its Arabic name', () => {
      const el = render({ permissions: FULL_ADMIN });
      find(el, 'تقويم');
      expect(cards(el)).toEqual(['workingCalendar']);
      expect(text(el.querySelector('[data-card="workingCalendar"] .am-console__name'))).toBe('Working Calendar');
    });

    it('in Arabic: «تقويم» marks the whole word «التقويم», so the letters stay joined', () => {
      const el = render({ permissions: FULL_ADMIN, language: 'ar' });
      find(el, 'تقويم');
      expect(cards(el)).toEqual(['workingCalendar']);
      expect(marks(el)).toEqual(['التقويم']);
      expect(text(el.querySelector('[data-testid="admin-console-result"]'))).toBe('يطابق إعداد واحد');
      TestBed.inject(TranslateService).use('en');
    });

    it('in Arabic, an English query finds the card by its English name', () => {
      const el = render({ permissions: FULL_ADMIN, language: 'ar' });
      find(el, 'recycle');
      expect(cards(el)).toEqual(['recycleBin']);
      expect(text(el.querySelector('[data-card="recycleBin"] .am-console__name'))).toBe('سلة المحذوفات');
      TestBed.inject(TranslateService).use('en');
    });

    it('ignores Arabic marks: «كلا» finds the line written «كلًّا»', () => {
      const el = render({ permissions: FULL_ADMIN, language: 'ar' });
      find(el, 'كلا منها');
      expect(cards(el)).toEqual(['organization', 'orgPositions']);
      TestBed.inject(TranslateService).use('en');
    });

    it('never finds a card the person may not open', () => {
      const el = render({ permissions: [ADMIN_ACCESS, 'users:view', 'roles:view'] });
      find(el, 'smtp');
      expect(cards(el)).toEqual([]);
      expect(text(el.querySelector('[data-testid="admin-console-result"]'))).toBe('No settings match “smtp”.');
    });

    it('no match: every group hidden, and the design’s line', () => {
      const el = render({ permissions: FULL_ADMIN });
      find(el, 'zzz');
      expect(groups(el)).toEqual([]);
      expect(text(el.querySelector('[data-testid="admin-console-result"]'))).toBe('No settings match “zzz”.');
    });

    it('clearing it brings every group back', () => {
      const el = render({ permissions: FULL_ADMIN });
      find(el, 'zzz');
      find(el, '');
      expect(groups(el)).toEqual(['people', 'organisation', 'work', 'connections']);
      expect(text(el.querySelector('[data-testid="admin-console-result"]'))).toBe('');
    });
  });
});
