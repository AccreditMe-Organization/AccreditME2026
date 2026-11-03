// ACC-120 slice 7 — the Workflows list as drawn (Workflow Setup, section 7).
//
// Read through the page's own DOM only, so each test says what a reader sees:
// the modules and their order, each row's record type, each row's ⋯, the keyboard,
// and the three request outcomes. Real translations, so the Arabic test reads
// the Arabic a reader gets.
//
// ACC-123's rule still holds and is pinned here: the write actions follow
// workflows:manage, which both endpoints enforce.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfirmationService } from 'primeng/api';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { WorkflowTemplateListComponent, workflowListItems } from './workflow-template-list.component';
import { WorkflowTemplateDto } from '../../services/workflow-template.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';

const LIST_URL = `${environment.apiUrl}/workflow-templates`;

// In the server's order: record type, then English name — so each default
// arrives FIRST in its group, and the page has to pin it last.
const TEMPLATES = [
  { id: 'c-default', nameEn: 'Committee lifecycle', nameAr: 'دورة حياة اللجنة', objectType: 'COMMITTEE', isDefault: true, isActive: true, isProtected: false },
  { id: 'c-task', nameEn: 'Task force lifecycle', nameAr: null, objectType: 'COMMITTEE', isDefault: false, isActive: true, isProtected: false },
  { id: 'd-default', nameEn: 'Document review', nameAr: 'مراجعة الوثيقة', objectType: 'DOCUMENT', isDefault: true, isActive: true, isProtected: false },
  { id: 'ccr', nameEn: 'Committee change request', nameAr: 'طلب تغيير لجنة', objectType: 'COMMITTEE_CHANGE_REQUEST', isDefault: true, isActive: true, isProtected: true },
];

// ACC-120 slice 7c — a mix across modules, deliberately out of order (the
// module order is the page's, not the server's), with an unknown type.
const t = (id: string, nameEn: string, objectType: string, isDefault: boolean, extra: Partial<WorkflowTemplateDto> = {}) =>
  ({ id, nameEn, nameAr: null, objectType, isDefault, isActive: true, isProtected: false, ...extra }) as WorkflowTemplateDto;
const MIXED: WorkflowTemplateDto[] = [
  t('c-default', 'Committee lifecycle', 'COMMITTEE', true, { nameAr: 'دورة حياة اللجنة' }),
  t('gap-1', 'Gap closure', 'GAP', false),
  t('ccr', 'Committee change request', 'COMMITTEE_CHANGE_REQUEST', true, { isProtected: true, nameAr: 'طلب تغيير لجنة' }),
  t('cr-default', 'Change request review', 'CHANGE_REQUEST', true),
  t('m-default', 'Meeting minutes', 'MEETING', true),
  t('d-default', 'Document review', 'DOCUMENT', true, { nameAr: 'مراجعة الوثيقة' }),
  t('dr-default', 'Document request review', 'DOCUMENT_REQUEST', true),
  t('dr-fast', 'Fast-track request', 'DOCUMENT_REQUEST', false),
  t('c-task', 'Task force lifecycle', 'COMMITTEE', false),
  t('i-default', 'Incident handling', 'INCIDENT', true),
];
const outlineOf = (items: ReturnType<typeof workflowListItems>): string[] =>
  items.map((i) => (i.kind === 'group' ? `# ${i.module}` : i.template.id));

const MANAGE = ['workflows:view', 'workflows:manage'];

describe('WorkflowTemplateListComponent (ACC-120 slice 7)', () => {
  // First, so it runs last: the Arabic test switches the document's language.
  preserveDocumentLanguage();

  let fixture: ComponentFixture<WorkflowTemplateListComponent>;
  let http: HttpTestingController;
  let navigate: jasmine.Spy;

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
  });

  /** Renders the page; the list request is left open for the test to answer. */
  function render(permissions: string[] = MANAGE, language: 'en' | 'ar' = 'en'): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [WorkflowTemplateListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(WorkflowTemplateListComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function answer(body: object[]): void {
    http.expectOne(LIST_URL).flush(body);
    fixture.detectChanges();
  }

  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  /** Headings and rows in document order: "# Group" for a heading, the name for a row. */
  const outline = (root: HTMLElement): string[] =>
    Array.from(root.querySelectorAll('[data-testid="workflow-group"], [data-testid="workflow-row"]')).map((el) =>
      el.matches('[data-testid="workflow-group"]') ? `# ${text(el)}` : text(el.querySelector('[data-testid="workflow-name"]')),
    );

  const row = (root: HTMLElement, id: string): HTMLElement =>
    root.querySelector<HTMLElement>(`[data-testid="workflow-row"][data-template-id="${id}"]`)!;

  /** Opens a row's ⋯ and reads its items. */
  function menuItems(root: HTMLElement, id: string): string[] {
    row(root, id).querySelector<HTMLButtonElement>('[data-testid="row-menu-trigger"]')!.click();
    fixture.detectChanges();
    const items = Array.from(document.querySelectorAll('.am-row-menu__item')).map((i) => text(i));
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
    return items;
  }

  describe('the rows', () => {
    // ACC-120 slice 7c — grouped by MODULE, in the page's fixed order, each
    // heading only when it has a row; record types kept together in the
    // module's order; each type's default pinned last.
    it('groups by module in the fixed order, record types together, each default last', () => {
      const root = render();
      answer(MIXED);
      expect(outline(root)).toEqual([
        '# Documents',
        'Fast-track request',
        'Document request review',
        'Document review',
        'Change request review',
        '# Incidents',
        'Incident handling',
        '# Meetings',
        'Meeting minutes',
        '# Committees',
        'Task force lifecycle',
        'Committee lifecycle',
        'Committee change request',
        '# Other',
        'Gap closure',
      ]);
      // A module with no row draws no heading.
      expect(outline(root)).not.toContain('# Audits');
      expect(outline(root)).not.toContain('# Corrective actions');
    });

    it('pins a default last within its record type, not within its module', () => {
      const items = workflowListItems([
        t('dr-default', 'A request', 'DOCUMENT_REQUEST', true),
        t('d-other', 'A lifecycle', 'DOCUMENT', false),
        t('dr-other', 'B request', 'DOCUMENT_REQUEST', false),
        t('d-default', 'B lifecycle', 'DOCUMENT', true),
      ]);
      expect(outlineOf(items)).toEqual(['# DOCUMENTS', 'dr-other', 'dr-default', 'd-other', 'd-default']);
    });

    it("names each row's record type on its second line, and draws no star", () => {
      const root = render();
      answer(MIXED);
      const line = (id: string) => text(row(root, id).querySelector('[data-testid="workflow-record-line"]'));
      expect(line('dr-default')).toBe('Default for document requests');
      expect(line('d-default')).toBe('Default for document lifecycle');
      expect(line('cr-default')).toBe('Default for change requests');
      expect(line('c-default')).toBe('Default for committee management');
      expect(line('dr-fast')).toBe('For document requests');
      expect(line('c-task')).toBe('For committee management');
      expect(line('ccr')).toBe('Default for committee change requests (no fields to test).');
      expect(text(root)).not.toContain('Used for new records of this type.');
      expect(root.querySelector('.pi-star, .pi-star-fill')).toBeNull();
    });

    it('puts an unknown record type under Other, never shown as a code', () => {
      const root = render();
      answer(MIXED);
      expect(text(row(root, 'gap-1').querySelector('[data-testid="workflow-record-line"]'))).toBe('For other records');
      expect(text(root)).not.toContain('GAP');
    });

    it('keeps the heading of every module with a match while searching, and only those', () => {
      expect(outlineOf(workflowListItems(MIXED, 'review'))).toEqual(['# DOCUMENTS', 'dr-default', 'd-default', 'cr-default']);
      expect(outlineOf(workflowListItems(MIXED, 'lifecycle'))).toEqual(['# COMMITTEES', 'c-task', 'c-default']);
      // The Arabic name matches too.
      expect(outlineOf(workflowListItems(MIXED, 'لجنة'))).toEqual(['# COMMITTEES', 'c-default', 'ccr']);
      expect(workflowListItems(MIXED, 'nothing like this')).toEqual([]);
    });

    it('says an inactive workflow is Inactive, in words', () => {
      const root = render();
      answer([{ ...TEMPLATES[1], isActive: false }]);
      expect(text(row(root, 'c-task').querySelector('[data-testid="workflow-state"]'))).toBe('Inactive');
    });

    it('keeps the column headers plain text: the list does not sort', () => {
      const root = render();
      answer(TEMPLATES);
      // Guard first: the headings are there, so their plainness means something.
      // (Karma's frame is phone width, where State folds into the row.)
      expect(text(root.querySelector('[role="columnheader"]'))).toBe('Workflow');
      expect(root.querySelector('am-sort-header')).toBeNull();
      expect(root.querySelector('[aria-sort]')).toBeNull();
    });
  });

  describe("each row's ⋯", () => {
    it('offers Open, Set as default and Deactivate on a row that is not the default', () => {
      const root = render();
      answer(TEMPLATES);
      expect(menuItems(root, 'c-task')).toEqual(['Open', 'Set as default', 'Deactivate']);
    });

    it('leaves Set as default off the default row', () => {
      const root = render();
      answer(TEMPLATES);
      expect(menuItems(root, 'c-default')).toEqual(['Open', 'Deactivate']);
    });

    it('offers only Open on the protected change request workflow', () => {
      const root = render();
      answer(TEMPLATES);
      expect(menuItems(root, 'ccr')).toEqual(['Open']);
    });

    it('names its row', () => {
      const root = render();
      answer(TEMPLATES);
      const trigger = row(root, 'c-task').querySelector('[data-testid="row-menu-trigger"]')!;
      expect(trigger.getAttribute('aria-label')).toBe('Actions for Task force lifecycle');
      // One ⋯ per row, and no other button in it.
      expect(row(root, 'c-task').querySelectorAll('button').length).toBe(1);
    });

    // ACC-123 — a holder of workflows:view alone is offered no write.
    it('offers only Open without workflows:manage', () => {
      const root = render(['workflows:view']);
      answer(TEMPLATES);
      expect(menuItems(root, 'c-task')).toEqual(['Open']);
    });
  });

  describe('opening a workflow', () => {
    it('opens the row from the keyboard: Enter on the row', () => {
      const root = render();
      answer(TEMPLATES);
      const target = row(root, 'c-task');
      target.focus();
      target.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }));
      expect(navigate).toHaveBeenCalledWith(['c-task', 'stages'], jasmine.anything());
    });

    it('makes the first workflow row the tab stop, not a heading', () => {
      const root = render();
      answer(TEMPLATES);
      // Documents comes first among the modules, so its only row is the first.
      expect(row(root, 'd-default').getAttribute('tabindex')).toBe('0');
      expect(row(root, 'c-task').getAttribute('tabindex')).toBe('-1');
      expect(root.querySelector('[data-testid="workflow-group"]')!.hasAttribute('tabindex')).toBe(false);
    });

    it('opens the row on a click', () => {
      const root = render();
      answer(TEMPLATES);
      row(root, 'd-default').click();
      expect(navigate).toHaveBeenCalledWith(['d-default', 'stages'], jasmine.anything());
    });
  });

  describe('request outcomes', () => {
    it('shows skeleton rows while loading, and no empty sentence', () => {
      const root = render();
      expect(root.querySelector('[data-testid="workflow-list-loading"] .am-skeleton-bar')).not.toBeNull();
      expect(root.querySelector('[data-testid="workflow-list-empty"]')).toBeNull();
      expect(text(root)).not.toContain(en.workflow.list.emptyTitle);
      http.expectOne(LIST_URL).flush([]);
    });

    it('shows an alert with Retry on a failed load, and no empty sentence; Retry reads again', () => {
      const root = render();
      http.expectOne(LIST_URL).flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      const alert = root.querySelector('[role="alert"][data-testid="workflow-list-error"]');
      expect(text(alert)).toContain("The workflows couldn't be loaded.");
      expect(text(alert)).toContain('Nothing was changed.');
      expect(root.querySelector('[data-testid="workflow-list-empty"]')).toBeNull();
      expect(text(root)).not.toContain(en.workflow.list.emptyTitle);

      root.querySelector<HTMLElement>('[data-testid="workflow-list-retry"] button')!.click();
      fixture.detectChanges();
      answer(TEMPLATES);
      expect(root.querySelector('[data-testid="workflow-list-error"]')).toBeNull();
      expect(outline(root)).toContain('Task force lifecycle');
    });

    it('shows the empty sentence only on a successful read with no rows', () => {
      const root = render();
      answer([]);
      expect(text(root.querySelector('[data-testid="workflow-list-empty"]'))).toContain(en.workflow.list.emptyTitle);
      expect(text(root.querySelector('[data-testid="workflow-list-empty"]'))).toContain(en.workflow.list.emptyBody);
      expect(root.querySelector('[role="alert"]')).toBeNull();
    });

    it("says a refused Set as default in the server's words, until dismissed", () => {
      const root = render();
      answer(TEMPLATES);
      row(root, 'c-task').querySelector<HTMLButtonElement>('[data-testid="row-menu-trigger"]')!.click();
      fixture.detectChanges();
      document.querySelector<HTMLButtonElement>('.am-row-menu__item[data-action="setDefault"]')!.click();
      fixture.detectChanges();
      http
        .expectOne(`${LIST_URL}/c-task/set-default`)
        .flush({ message: 'Another workflow is being made the default.' }, { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();

      const alert = root.querySelector('[role="alert"][data-testid="workflow-refusal"]');
      expect(text(alert)).toContain('Another workflow is being made the default.');
      alert!.querySelector<HTMLElement>('button')!.click();
      fixture.detectChanges();
      expect(root.querySelector('[data-testid="workflow-refusal"]')).toBeNull();
    });
  });

  describe('in Arabic', () => {
    it("titles the page, heads the modules and names each row's record type in Arabic, with the English name where there is no Arabic one", () => {
      const root = render(MANAGE, 'ar');
      answer(MIXED);
      expect(text(root.querySelector('h1'))).toBe('سير العمل');
      expect(outline(root)).toEqual([
        '# الوثائق',
        'Fast-track request',
        'Document request review',
        'مراجعة الوثيقة',
        'Change request review',
        '# الحوادث',
        'Incident handling',
        '# الاجتماعات',
        'Meeting minutes',
        '# اللجان',
        'Task force lifecycle',
        'دورة حياة اللجنة',
        'طلب تغيير لجنة',
        '# أخرى',
        'Gap closure',
      ]);
      const line = (id: string) => text(row(root, id).querySelector('[data-testid="workflow-record-line"]'));
      expect(line('dr-default')).toBe('الافتراضي في طلبات الوثائق');
      expect(line('d-default')).toBe('الافتراضي في دورة حياة الوثيقة');
      expect(line('c-task')).toBe('يُستخدم في إدارة اللجان');
      expect(line('ccr')).toBe('الافتراضي في طلبات تغيير اللجان (لا حقول لاختبارها).');
      expect(line('gap-1')).toBe('يُستخدم في سجلات أخرى');
    });
  });
});
