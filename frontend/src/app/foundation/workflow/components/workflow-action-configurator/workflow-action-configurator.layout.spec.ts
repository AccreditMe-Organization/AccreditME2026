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
import { WorkflowTransitionActionDto } from '../../services/workflow-template.service';

// ACC-255 PR 4b (plan §17.6) — the dialogs that stay dialogs are measured, and
// held to AT MOST 400px of body: at least 20px under the 420px cap, which is
// never raised. The action configurator's Add / Edit action had never been
// measured; its tallest state is a webhook with a save error showing. It
// measured 470px (scrolling) and was compacted (ACC-120): Order and Enabled
// share a row, and the actions are in the footer: 322px in both languages.
//
// ACC-120 slice 7 — the headers became rows, and one form with three set
// headers measured 579px. So a webhook is two steps: step 1 the action, step 2
// its headers, at most 5 (a stored action with more scrolls inside step 2).
// Each state below is pinned at or under the 400px budget. Measured here
// (EN = AR, because this runner lacks the real Arabic font):
//   Add · webhook · save error 279 · step 1 279 · step 2 with 3 set headers 268
//   · with 5: 373 · with 7 stored: 374, the list scrolling inside the step.
// In the app at 1440px (IBM Plex Sans Arabic loaded), Arabic is taller: step 1
// 293, step 2 with 3 / 5 / 7 headers 288 / 402 / 378, all under the 420px cap.
// That is why rows sit 6px apart and each hint has no gap above it: with 8px
// and a 4px gap, five headers measured 422px in Arabic.
//
// NON-VACUITY FIRST: a body measuring 0 passes "<= 400".

const CAP = 420;
const ROOM = 20;
const FLOOR = 120;

/** A stored webhook with this many set headers, as the masked read returns it (ACC-277). */
function webhook(count: number): WorkflowTransitionActionDto {
  const names = ['Authorization', 'X-Api-Key', 'X-Tenant', 'X-Request-Source', 'X-Signature-Version', 'X-Extra-One', 'X-Extra-Two'].slice(
    0,
    count,
  );
  return {
    id: 'a-1',
    workflowTransitionId: 'tr-1',
    actionType: 'WEBHOOK',
    order: 10,
    isEnabled: true,
    configJson: {
      webhookUrl: 'https://hooks.example.com/accreditme',
      headers: Object.fromEntries(names.map((n) => [n, ''])),
      headersValueSet: Object.fromEntries(names.map((n) => [n, true])),
    },
  };
}

describe('Action configurator dialog — at least 20px under the 420px cap (ACC-255 PR 4b, ACC-120 slice 7)', () => {
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

  async function measure(label: string, language: 'en' | 'ar'): Promise<number> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const body = document.querySelector<HTMLElement>('.am-dialog__body');
    expect(body).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    const height = body!.scrollHeight;
    measured.push(`${label} [${language}]: ${height}px`);
    expect(height).withContext(`${label} [${language}] is not laid out`).toBeGreaterThan(FLOOR);
    expect(height).withContext(`${label} [${language}] body ${height}px: at least ${ROOM}px under ${CAP}`).toBeLessThanOrEqual(CAP - ROOM);
    return height;
  }

  afterAll(() => console.log(`Action configurator measurements\n${measured.join('\n')}`));

  for (const language of ['en', 'ar'] as const) {
    it(`Add action, a webhook with a save error showing [${language}]`, async () => {
      const configurator = open(language);
      configurator.openAdd();
      configurator.form.controls.actionType.setValue('WEBHOOK');
      configurator.saveError.set('workflow.error.saveFailed');
      await measure('Add · webhook · save error', language);
    });

    it(`Edit action, a webhook, step 1 [${language}]`, async () => {
      const configurator = open(language);
      configurator.openEdit(webhook(3));
      await measure('Edit · webhook · step 1', language);
    });

    for (const count of [3, 5, 7]) {
      it(`Edit action, a webhook, step 2 with ${count} set headers [${language}]`, async () => {
        const configurator = open(language);
        configurator.openEdit(webhook(count));
        configurator.next();
        await measure(`Edit · webhook · step 2 · ${count} set headers`, language);
        // Guard: step 2 is what was measured, with every stored header in it.
        const rows = document.querySelectorAll('.am-dialog__body [data-testid="action-header-row"]');
        expect(rows.length).withContext('every stored header shows').toBe(count);
      });
    }
  }
});
