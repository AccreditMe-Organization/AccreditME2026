import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { TaskSlaSettingsComponent } from './task-sla-settings.component';

// ACC-208 — raising a priority's hours is refused when a workflow stage would
// end before a task defined on it is due (TASK_SLA_EXCEEDS_STAGE_DEADLINES).
// The screen names every stage it would break, under the priority that breaks
// it, each a link to that stage's row, and says the way out.

const SLA = {
  LOW: { dueAfterHours: 80, managerEscalationAfterHours: 0, headEscalationAfterHours: 0 },
  MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 0, headEscalationAfterHours: 0 },
  HIGH: { dueAfterHours: 16, managerEscalationAfterHours: 0, headEscalationAfterHours: 0 },
  CRITICAL: { dueAfterHours: 4, managerEscalationAfterHours: 0, headEscalationAfterHours: 0 },
};

const CONFLICT = {
  stageId: 'stage-terms',
  stageName: 'Terms Review',
  stageNameAr: 'مراجعة الشروط',
  templateName: 'Committee Management',
  templateNameAr: null,
  workflowTemplateId: 'template-1',
  stageHours: 16,
  longestTaskHours: 24,
  priority: 'HIGH',
};

describe('TaskSlaSettingsComponent — stage deadlines (ACC-208)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<TaskSlaSettingsComponent>;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/tenant/task-sla`;

  function setup(language: 'en' | 'ar' = 'en'): TaskSlaSettingsComponent {
    TestBed.configureTestingModule({
      imports: [TaskSlaSettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskSlaSettingsComponent);
    fixture.detectChanges();
    http.expectOne(url).flush(SLA);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  function refuse(component: TaskSlaSettingsComponent, stages: unknown[]): void {
    component.form.controls.HIGH.controls.dueAfterHours.setValue(24);
    component.onSubmit();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('PATCH');
    req.flush(
      { statusCode: 409, code: 'TASK_SLA_EXCEEDS_STAGE_DEADLINES', message: 'English for a log', stages },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  afterEach(() => http.verify());

  it('names the stage under the priority that breaks it, as a link to its row, with the way out', () => {
    refuse(setup(), [CONFLICT]);

    const block = el().querySelector('[data-sla-conflicts="HIGH"]');
    expect(block).not.toBeNull();
    const parts = Array.from(block!.querySelectorAll(':scope > span, li')).map((n) => n.textContent?.trim());
    expect(parts).toEqual([
      'High would become 24 working hours, which passes the deadline of:',
      'Committee Management · Terms Review (16 working hours)',
      'Raise those deadlines first, or keep High at 16 or less.',
    ]);
    expect(block!.querySelector('a')?.getAttribute('href')).toBe('/workflows/template-1/stages?stage=stage-terms');
    // Under that priority only, and never the generic failure or the server's English.
    expect(el().querySelectorAll('[data-sla-conflicts]').length).toBe(1);
    expect(fixture.componentInstance.error()).toBeNull();
    expect(el().textContent).not.toContain('English for a log');
  });

  it('lists every stage it would break, keeping the way out to the tightest deadline', () => {
    refuse(setup(), [CONFLICT, { ...CONFLICT, stageId: 'stage-2', stageName: 'Formation', stageNameAr: null, stageHours: 8 }]);
    const block = el().querySelector('[data-sla-conflicts="HIGH"]')!;
    expect(block.querySelectorAll('li').length).toBe(2);
    expect(block.textContent).toContain('keep High at 8 or less');
  });

  it('clears once the hours change', () => {
    const component = setup();
    refuse(component, [CONFLICT]);
    component.form.controls.HIGH.controls.dueAfterHours.setValue(16);
    fixture.detectChanges();
    expect(el().querySelector('[data-sla-conflicts]')).toBeNull();
  });

  it('keeps the generic message for any other failure', () => {
    const component = setup();
    component.onSubmit();
    http.expectOne(url).flush('down', { status: 500, statusText: 'Server Error' });
    expect(component.error()).toBe('adminSettings.errorSave');
  });

  it('says it in Arabic, the stage by its Arabic name', () => {
    refuse(setup('ar'), [CONFLICT]);
    const text = el().querySelector('[data-sla-conflicts="HIGH"]')!.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('ستصبح الأولوية «عالية» 24 ساعة عمل، وهذا يتجاوز مهلة:');
    expect(text).toContain('Committee Management · مراجعة الشروط (16 ساعة عمل)');
  });
});
