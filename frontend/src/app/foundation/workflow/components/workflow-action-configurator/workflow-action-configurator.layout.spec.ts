import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowActionConfiguratorComponent } from './workflow-action-configurator.component';

// ACC-255 PR 4b (plan §17.6) — the dialogs that stay dialogs are measured, and
// held to AT MOST 400px of body: at least 20px under the 420px cap, which is
// never raised. The action configurator's Add / Edit action had never been
// measured; its tallest state is a webhook with a save error showing. It
// measured 470px (scrolling) and was compacted (ACC-120): Order and Enabled
// share a row, and the actions are in the footer: 322px in both languages.
//
// NON-VACUITY FIRST: a body measuring 0 passes "<= 400".

const CAP = 420;
const ROOM = 20;
const FLOOR = 120;

describe('Action configurator dialog — at least 20px under the 420px cap (ACC-255 PR 4b)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<WorkflowActionConfiguratorComponent>;
  const measured: string[] = [];

  function open(language: 'en' | 'ar'): WorkflowActionConfiguratorComponent {
    TestBed.configureTestingModule({
      imports: [WorkflowActionConfiguratorComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(WorkflowActionConfiguratorComponent);
    fixture.componentRef.setInput('transitionId', 'tr-1');
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  async function measure(label: string, language: 'en' | 'ar'): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const body = document.querySelector<HTMLElement>('.am-dialog__body');
    expect(body).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    const height = body!.scrollHeight;
    measured.push(`${label} [${language}]: ${height}px`);
    expect(height).withContext(`${label} [${language}] is not laid out`).toBeGreaterThan(FLOOR);
    expect(height).withContext(`${label} [${language}] body ${height}px: at least ${ROOM}px under ${CAP}`).toBeLessThanOrEqual(CAP - ROOM);
  }

  afterAll(() => console.log(`ACC-255 PR 4b action configurator measurements\n${measured.join('\n')}`));

  for (const language of ['en', 'ar'] as const) {
    it(`Add action, a webhook with a save error showing [${language}]`, async () => {
      const configurator = open(language);
      configurator.openAdd();
      configurator.form.controls.actionType.setValue('WEBHOOK');
      configurator.saveError.set('workflow.error.saveFailed');
      await measure('Add · webhook · save error', language);
    });
  }
});
