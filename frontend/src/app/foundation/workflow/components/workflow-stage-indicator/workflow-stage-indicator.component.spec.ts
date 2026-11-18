import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { expectArabicDateInPageDirection, expectPhraseInPageDirection } from '../../../../../testing/arabic-date';
import { WorkflowInstanceDto, WorkflowStageHistoryDto } from '../../services/workflow.service';
import { WorkflowStageIndicatorComponent } from './workflow-stage-indicator.component';

/**
 * ACC-313 (CC-323) — each visit's entered date, in the stage history, takes the
 * page's direction. It sat in a dir="ltr" span, so an Arabic date showed its
 * day last («نوفمبر 2026 3»).
 */
describe('WorkflowStageIndicatorComponent — the visit date in Arabic (ACC-313)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('reads day first, in the page direction', () => {
    TestBed.configureTestingModule({
      imports: [WorkflowStageIndicatorComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideTranslateService({ lang: 'ar' }), provideFormatTesting()],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('ar');
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(WorkflowStageIndicatorComponent);
    fixture.componentRef.setInput('instance', { id: 'i-1' } as WorkflowInstanceDto);
    fixture.componentRef.setInput('show', 'history');
    fixture.detectChanges();

    const history = {
      instanceId: 'i-1',
      stages: [],
      visits: [
        {
          id: 'v1',
          stageId: 's1',
          stageNameEn: 'Formation',
          stageNameAr: 'التكوين',
          enteredAt: '2026-11-03T08:00:00Z',
          exitedAt: null,
          outcome: null,
          actorId: null,
          actorName: null,
          transitionLabelEn: null,
          transitionLabelAr: null,
          comment: null,
          isUnassigned: false,
          delegation: null,
        },
      ],
    } as unknown as WorkflowStageHistoryDto;
    http.expectOne(`${environment.apiUrl}/workflows/instances/i-1/stage-history`).flush(history);
    fixture.detectChanges();

    const spans = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span'));
    const span = spans.find((s) => s.children.length === 0 && /^\s*3 نوفمبر/.test(s.textContent ?? ''));
    expectArabicDateInPageDirection(span, { day: '3', month: 'نوفمبر' });
  });

  // CC-326 — the sequence's stage line (stageMeta()) and the in-stage line,
  // which a scan cannot see: a method returns their text. A stage visited once
  // and left shows a bare date; the current stage a phrase ("since …").
  it('the sequence: a past stage’s bare date reads day first, the current one’s «منذ …» and the in-stage line in the page direction', () => {
    TestBed.configureTestingModule({
      imports: [WorkflowStageIndicatorComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideTranslateService({ lang: 'ar' }), provideFormatTesting()],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('ar');
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(WorkflowStageIndicatorComponent);
    fixture.componentRef.setInput('instance', { id: 'i-1' } as WorkflowInstanceDto);
    fixture.componentRef.setInput('show', 'sequence');
    fixture.detectChanges();

    const visit = (id: string, stageId: string, enteredAt: string, exitedAt: string | null) => ({
      id,
      stageId,
      stageNameEn: stageId,
      stageNameAr: stageId,
      enteredAt,
      exitedAt,
      outcome: exitedAt ? 'APPROVED' : null,
      actorId: null,
      actorName: null,
      transitionLabelEn: null,
      transitionLabelAr: null,
      comment: null,
      isUnassigned: false,
      delegation: null,
    });
    const history = {
      instanceId: 'i-1',
      stages: [
        { id: 'past', nameEn: 'Formation', nameAr: 'التكوين', order: 1, visitCount: 1, isCurrent: false },
        { id: 'now', nameEn: 'Terms Review', nameAr: 'مراجعة الشروط', order: 2, visitCount: 1, isCurrent: true },
      ],
      visits: [visit('v1', 'past', '2026-11-03T08:00:00Z', '2026-11-05T08:00:00Z'), visit('v2', 'now', '2026-11-05T08:00:00Z', null)],
    } as unknown as WorkflowStageHistoryDto;
    http.expectOne(`${environment.apiUrl}/workflows/instances/i-1/stage-history`).flush(history);
    fixture.detectChanges();

    const metas = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-stage-meta]'));
    expect(metas.length).toBe(2);
    expectArabicDateInPageDirection(metas[0], { day: '3', month: 'نوفمبر' });
    expectPhraseInPageDirection(metas[1], 'منذ 5 نوفمبر');
    const inStage = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span')).find(
      (s) => s.children.length === 0 && (s.textContent ?? '').trim().startsWith('دخلت هذه المرحلة'),
    );
    expectPhraseInPageDirection(inStage, 'دخلت هذه المرحلة');
  });
});
