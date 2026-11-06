// ACC-55 — the seam that broke on the live pass, and that neither component's
// own spec covers on its own: a save reloads the template, which replaces the
// stages array the expanded row renders from.
//
// Before ACC-271 PR 5b the transition dialogs lived INSIDE the expanded row, so
// a reload that rebuilt the row destroyed an open dialog and its warning. The
// transition panel lives on the page now, outside the row. This pins that a
// save reloads the page, the panel stays open on the transition (showing what
// the server stored), and the row's list is kept, not rebuilt (rows by id).
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { By } from '@angular/platform-browser';
import { environment } from '../../../../../environments/environment';
import { WorkflowStageListComponent } from './workflow-stage-list.component';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowTransitionEditorComponent } from '../workflow-transition-editor/workflow-transition-editor.component';
import { TransitionPanelComponent } from '../transition-panel/transition-panel.component';

const TRANSITION = {
  id: 'transition-1',
  fromStageId: 'stage-1',
  toStageId: 'stage-1',
  labelEn: 'Approve',
  labelAr: 'اعتماد',
  validatorConfig: null,
  isApprovalPath: false,
  kind: 'ADVANCE' as const,
  mover: 'PERSON' as const,
};

const template = () => ({
  id: 'template-1',
  organizationId: 'org-a',
  nameEn: 'Committee Management',
  nameAr: 'إدارة اللجان',
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  stages: [
    {
      id: 'stage-1',
      workflowTemplateId: 'template-1',
      nameEn: 'Formation',
      nameAr: 'التكوين',
      description: null,
      order: 10,
      slaWorkingHours: null,
      isInitial: true,
      isFinal: false,
      escalationConfig: null,
      transitions: [TRANSITION],
    },
  ],
});

describe('WorkflowStageList + transition panel (ACC-55 seam, ACC-271 PR 5b)', () => {
  it('a save reloads the page; the panel stays on the transition and the row’s list is kept', async () => {
    TestBed.configureTestingModule({
      imports: [WorkflowStageListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        {
          provide: ActivatedRoute,
          // queryParamMap — ACC-82's Fix link reads it; this test passes none.
          useValue: {
            snapshot: { paramMap: { get: () => 'template-1' }, queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    });

    // ACC-208 — the expanded row's "Tasks on entry" reads its own list.
    const drainTasks = (http: HttpTestingController): void => {
      http
        .match(`${environment.apiUrl}/workflow-templates/stages/stage-1/task-definitions`)
        .forEach((r) => r.flush([]));
    };

    const fixture = TestBed.createComponent(WorkflowStageListComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(template());
    fixture.detectChanges();

    fixture.componentInstance.expandedRowKeys.set({ 'stage-1': true });
    fixture.detectChanges();
    drainTasks(http);

    const list = fixture.debugElement.query(By.directive(WorkflowTransitionEditorComponent)).componentInstance as WorkflowTransitionEditorComponent;
    const host = fixture.nativeElement as HTMLElement;
    // No roles or permissions are read for the list or the panel any more.
    http.expectNone(`${environment.apiUrl}/roles/permissions`);

    host.querySelector<HTMLButtonElement>('[data-transition-row="transition-1"] [data-tr-edit] button')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const panel = (): TransitionPanelComponent | undefined =>
      fixture.debugElement.query(By.directive(TransitionPanelComponent))?.componentInstance;
    expect(panel()).withContext('the panel opened').toBeDefined();

    const input = host.querySelector<HTMLInputElement>('#tp-labelEn')!;
    input.value = 'Approve now';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[data-panel-save] button')!.click();
    fixture.detectChanges();

    http
      .expectOne(`${environment.apiUrl}/workflow-templates/transitions/transition-1`)
      .flush({ transition: { ...TRANSITION, labelEn: 'Approve now' } });
    fixture.detectChanges();

    const saved = template();
    saved.stages[0]!.transitions = [{ ...TRANSITION, labelEn: 'Approve now' }];
    http.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(saved);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    drainTasks(http);

    expect(panel()).withContext('the panel stays open on the transition').toBeDefined();
    expect(host.querySelector('[data-panel-heading]')?.textContent?.trim()).toBe('Approve now');
    const sameList =
      (fixture.debugElement.query(By.directive(WorkflowTransitionEditorComponent))?.componentInstance as WorkflowTransitionEditorComponent) === list;
    expect(sameList).withContext('the row’s list is kept, not rebuilt').toBeTrue();
    expect(host.querySelector('[data-transition-row="transition-1"] [data-tr-label]')?.textContent).toContain('Approve now');

    http.verify();
  });
});

// ACC-160, as the drawn list shows it (ACC-255 PR 4a) — one name per stage, in
// the reader's language. A stage is a record's identity there, so a stage with
// no Arabic name reads in English in an Arabic session: never a blank, never
// "null" (ACC-160's identity rule). The list no longer has a separate Arabic
// slot (Workflow Setup, section 3).
describe('WorkflowStageList — the stage name in the reader\'s language (ACC-160)', () => {
  preserveDocumentLanguage();

  function namesWith(stageNameAr: string | null, lang: 'en' | 'ar'): string[] {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [WorkflowStageListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        ConfirmationService,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'template-1' }, queryParamMap: convertToParamMap({}) } },
        },
      ],
    });
    TestBed.inject(LanguageService).use(lang);
    const fixture = TestBed.createComponent(WorkflowStageListComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const t = template();
    http
      .expectOne(`${environment.apiUrl}/workflow-templates/template-1`)
      .flush({ ...t, stages: [{ ...t.stages[0], nameEn: 'Formation', nameAr: stageNameAr }] });
    fixture.detectChanges();
    http.match(() => true).forEach((r) => r.flush([]));
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-stage-name]')).map((e) =>
      (e.textContent ?? '').trim(),
    );
  }

  it('reads the Arabic name in Arabic and the English name in English', () => {
    expect(namesWith('التكوين', 'ar')).toEqual(['التكوين']);
    expect(namesWith('التكوين', 'en')).toEqual(['Formation']);
  });

  it('falls back to English in Arabic when the stage has no Arabic name, never a blank', () => {
    const names = namesWith(null, 'ar');
    expect(names).toEqual(['Formation']);
    expect(names.join('')).not.toContain('null');
  });
});
