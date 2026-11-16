import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { ITaskPageViewDto, ResolvedDelegationDto } from '../../services/task.service';
import { TaskPageComponent } from './task-page.component';
import { HISTORY, pageView } from './task-page.fixtures';

// ACC-302 — "covering for {name}" on the task page's assignee line, when the
// task reached them as an away person's cover. The server resolves the name
// under ACC-101's qualifier rule, unchanged; a label it withholds is absent,
// and nothing is drawn in its place.

const API = `${environment.apiUrl}/tasks`;

describe('TaskPageComponent — covering for someone out of office (ACC-302)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;
  let fixture: ComponentFixture<TaskPageComponent>;
  const params = new BehaviorSubject(convertToParamMap({ id: 'task-1' }));

  function open(language: 'en' | 'ar', delegation: ResolvedDelegationDto | null): string {
    TestBed.configureTestingModule({
      imports: [TaskPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
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
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskPageComponent);
    fixture.detectChanges();
    const base = pageView();
    const view: ITaskPageViewDto = { ...base, assignees: [{ ...base.assignees[0]!, delegation }] };
    http.expectOne(`${API}/task-1/view`).flush(view);
    http.expectOne(`${API}/task-1/history`).flush(HISTORY);
    fixture.detectChanges();
    http.match(`${API}/task-1/evidence`).forEach((r) => r.flush({ items: [], canAdd: false, closed: false }));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return Array.from(el.querySelectorAll('.am-tp__cell')).map((c) => c.textContent?.replace(/\s+/g, ' ').trim() ?? '')[1]!;
  }

  const covering: ResolvedDelegationDto = {
    reason: 'OUT_OF_OFFICE_COVERAGE',
    contextId: 'away-1',
    contextLabelEn: 'Dr. Shaikha Al-Rumaithi',
    contextLabelAr: 'Dr. Shaikha Al-Rumaithi',
  };

  afterEach(() => http.verify());

  it('[en] says whom the assignee covers', () => {
    expect(open('en', covering)).toContain('covering for Dr. Shaikha Al-Rumaithi');
  });

  it('[ar] says it in Arabic, with no gendered verb', () => {
    expect(open('ar', covering)).toContain('بالنيابة عن Dr. Shaikha Al-Rumaithi');
  });

  it('draws nothing when the server withheld the name, or there is no delegation', () => {
    expect(open('en', { ...covering, contextLabelEn: null, contextLabelAr: null })).not.toContain('covering for');
    TestBed.resetTestingModule();
    expect(open('en', null)).not.toContain('covering for');
  });

  it('draws nothing for an acting head: that qualifier is not this one', () => {
    expect(open('en', { reason: 'ACTING_HEAD', contextId: 'unit-1', contextLabelEn: 'Cardiology', contextLabelAr: 'أمراض القلب' })).not.toContain(
      'covering for',
    );
  });
});
