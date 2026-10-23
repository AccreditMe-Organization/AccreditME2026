import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { LanguageService } from '../../../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { AmConfirmOptions, AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { TaskService } from '../../services/task.service';
import { NO_ACTIONS, recordRow } from '../record-tasks-panel/record-tasks.fixtures';
import { TaskActionHostComponent } from './task-action-host.component';

// ACC-240 (lane A's handover) — Complete asks by the task's title, through
// bilingual() (ACC-160), and states what complete() does: every other active
// assignee comes off it (task.service.ts:720–723), it becomes COMPLETED
// (:725–727), and its open requests are cancelled (:730). Read from the REAL
// translation files.

describe('TaskActionHostComponent — the Complete confirm (ACC-240)', () => {
  preserveDocumentLanguage();
  let asked: AmConfirmOptions[];
  let completed: string[];

  function host(lang: 'en' | 'ar'): TaskActionHostComponent {
    asked = [];
    completed = [];
    TestBed.configureTestingModule({
      imports: [TaskActionHostComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        { provide: TaskService, useValue: { complete: (id: string) => (completed.push(id), of({})) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    return TestBed.createComponent(TaskActionHostComponent).componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  const row = (titleAr: string | null) =>
    recordRow('t-1', {
      title: 'Collect the hand hygiene sample',
      titleAr,
      actions: { ...NO_ACTIONS, complete: true, completeNeedsEvidence: false, primary: 'COMPLETE' },
    });

  const said = () => {
    expect(asked.length).withContext('asked exactly once').toBe(1);
    const o = asked[0]!;
    return { tone: o.tone, header: o.header, message: o.message, accept: o.acceptLabel };
  };

  it('English: names the task, says it is done for everyone and open requests are cancelled, and is neutral', () => {
    host('en').run(row('جمع عينة نظافة اليدين'), 'complete');
    expect(said()).toEqual({
      tone: 'neutral',
      header: 'Complete “Collect the hand hygiene sample”?',
      message: "It's marked done for everyone on it, and any open request for more time or a hold is cancelled.",
      accept: 'Complete',
    });
  });

  it('Arabic: the Arabic title, in Arabic quotes', () => {
    host('ar').run(row('جمع عينة نظافة اليدين'), 'complete');
    expect(said()).toEqual({
      tone: 'neutral',
      header: 'إنجاز «جمع عينة نظافة اليدين»؟',
      message: 'تُعلَّم منجزةً لكل من أُسندت إليه، ويُلغى أي طلب مفتوح لمزيد من الوقت أو للتعليق.',
      accept: 'إنجاز',
    });
  });

  it('Arabic, a task with no Arabic title: the English title, never a blank (ACC-160)', () => {
    host('ar').run(row(null), 'complete');
    expect(said().header).toBe('إنجاز «Collect the hand hygiene sample»؟');
  });

  it('nothing is completed until the person accepts', () => {
    host('en').run(row(null), 'complete');
    expect(completed).toEqual([]);
    asked[0]!.accept();
    expect(completed).toEqual(['t-1']);
  });
});
