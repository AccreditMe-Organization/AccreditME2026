// ACC-120 slice 7 — the Workflows list as drawn (Workflow Setup, section 7).
//
// Read through the page's own DOM only, so each test says what a reader sees:
// the groups and their order, the default's words, each row's ⋯, the keyboard,
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
import { WorkflowTemplateListComponent } from './workflow-template-list.component';
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
    it('groups by record type in the server order, with the default pinned last in each group', () => {
      const root = render();
      answer(TEMPLATES);
      expect(outline(root)).toEqual([
        '# Committees',
        'Task force lifecycle',
        'Committee lifecycle',
        '# Documents',
        'Document review',
        '# Committee change requests',
        'Committee change request',
      ]);
    });

    it('says which row is the default in words, and draws no star', () => {
      const root = render();
      answer(TEMPLATES);
      expect(text(row(root, 'c-default').querySelector('[data-testid="workflow-default-line"]'))).toBe(
        'Default · Used for new records of this type.',
      );
      expect(text(row(root, 'ccr').querySelector('[data-testid="workflow-default-line"]'))).toBe(
        'Default · Used for every change request (no fields to test).',
      );
      expect(row(root, 'c-task').querySelector('[data-testid="workflow-default-line"]')).toBeNull();
      expect(root.querySelector('.pi-star, .pi-star-fill')).toBeNull();
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
      expect(row(root, 'c-task').getAttribute('tabindex')).toBe('0');
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
    it('titles the page, heads the groups and states the default in Arabic, with the English name where there is no Arabic one', () => {
      const root = render(MANAGE, 'ar');
      answer(TEMPLATES);
      expect(text(root.querySelector('h1'))).toBe('سير العمل');
      expect(outline(root)).toEqual([
        '# اللجان',
        'Task force lifecycle',
        'دورة حياة اللجنة',
        '# الوثائق',
        'مراجعة الوثيقة',
        '# طلبات تغيير اللجان',
        'طلب تغيير لجنة',
      ]);
      expect(text(row(root, 'c-default').querySelector('[data-testid="workflow-default-line"]'))).toBe(
        'افتراضي · يُستخدم للسجلات الجديدة من هذا النوع.',
      );
    });
  });
});
