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
import { useLayoutFonts } from '../../../../../testing/layout-fonts';

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
// ACC-120 slice 7, the tidy (4 Nov) — Order is gone, and step 1 is the kind,
// then that kind's own fields, one gap token apart. A webhook on ONE step with
// five headers measured 585px (EN) and 623px (AR) in the app at 1440, over the
// 420px cap, so it stays two steps; both are pinned below, five headers on
// step 2. The rhythm test walks every kind: the gap between each control on
// step 1 is the form's own row gap, and nothing sits under the kind select.
//
// NON-VACUITY FIRST: a body measuring 0 passes "<= 400".

const CAP = 420;
const ROOM = 20;
const FLOOR = 120;
/** Step 1 of a kind with no fields of its own is about 100px: its own floor. */
const SMALL_FLOOR = 60;

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
  useLayoutFonts({ rtl: true });
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

  async function measure(label: string, language: 'en' | 'ar', floor = FLOOR): Promise<number> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const body = document.querySelector<HTMLElement>('.am-dialog__body');
    expect(body).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    const height = body!.scrollHeight;
    measured.push(`${label} [${language}]: ${height}px`);
    expect(height).withContext(`${label} [${language}] is not laid out`).toBeGreaterThan(floor);
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

    it(`Edit action, a webhook with 5 headers stays two steps, each under the budget [${language}]`, async () => {
      const configurator = open(language);
      configurator.openEdit(webhook(5));
      const step1 = await measure('Edit · webhook · 5 headers · step 1', language);
      // Guard: step 1 holds no header row; the headers are step 2's.
      expect(document.querySelectorAll('.am-dialog__body [data-testid="action-header-row"]').length).toBe(0);
      configurator.next();
      const step2 = await measure('Edit · webhook · 5 headers · step 2', language);
      expect(document.querySelectorAll('.am-dialog__body [data-testid="action-header-row"]').length).toBe(5);
      // Two steps because one would not fit: together they are over the cap.
      expect(step1 + step2).withContext(`steps 1 + 2 = ${step1 + step2}px`).toBeGreaterThan(CAP);
    });

    // Every kind, as Add offers it and as an existing action of a kind no longer
    // offered opens in Edit.
    const kinds: { kind: string; via: 'add' | 'edit' }[] = [
      { kind: 'SEND_NOTIFICATION', via: 'add' },
      { kind: 'LOG_AUDIT', via: 'add' },
      { kind: 'WEBHOOK', via: 'add' },
      { kind: 'GENERATE_PDF', via: 'edit' },
      { kind: 'LOCK_DOCUMENT', via: 'edit' },
    ];
    for (const { kind, via } of kinds) {
      it(`step 1 of ${kind} (${via}): one even gap, every label with its control, all aligned [${language}]`, async () => {
        const configurator = open(language);
        if (via === 'add') {
          configurator.openAdd();
          configurator.form.controls.actionType.setValue(kind);
        } else {
          configurator.openEdit({ id: 'a-2', workflowTransitionId: 'tr-1', actionType: kind, order: 10, isEnabled: true, configJson: null });
        }
        await measure(`${via === 'add' ? 'Add' : 'Edit'} · ${kind} · step 1`, language, SMALL_FLOOR);
        // The dialog opens with a scale animation; boxes read during it are
        // scaled (16px read as 14.88). Wait for the dialog's own finite
        // animations, then read; a cancelled one rejects `finished` and has
        // ended all the same.
        const form = document.querySelector<HTMLElement>('.am-dialog__body form')!;
        const layer = form.closest('.p-dialog-mask') ?? form.closest('.p-dialog')!;
        const motion = layer
          .getAnimations({ subtree: true })
          .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity);
        await Promise.all(motion.map((a) => a.finished.catch(() => undefined)));
        const children = Array.from(form.children) as HTMLElement[];
        const gap = parseFloat(getComputedStyle(form).rowGap);
        // NON-VACUITY: a real gap, and at least the kind and one more control.
        expect(gap).withContext('the form has a row gap').toBeGreaterThan(0);
        expect(children.length).withContext('the kind and its fields').toBeGreaterThanOrEqual(2);
        for (const child of children) {
          expect(child.getBoundingClientRect().height).withContext(`<${child.tagName.toLowerCase()}> is laid out`).toBeGreaterThan(0);
        }

        // Nothing under the kind select: its field ends where the select does.
        const select = children[0]!.querySelector<HTMLElement>('app-overlay-select')!;
        expect(Math.round(children[0]!.getBoundingClientRect().bottom - select.getBoundingClientRect().bottom))
          .withContext('space under the kind select inside its field')
          .toBe(0);
        // One rhythm: every control is the form's gap below the one before
        // (within a pixel: the boxes sit on fractional pixels).
        for (let i = 1; i < children.length; i++) {
          const between = children[i]!.getBoundingClientRect().top - children[i - 1]!.getBoundingClientRect().bottom;
          expect(Math.abs(between - gap))
            .withContext(`gap before child ${i} of ${kind}: ${between}px, the form's is ${gap}px`)
            .toBeLessThan(1);
        }

        // Every label has its control, shown. The kind's label has no inner
        // input to point at (the select names itself), so its select is it.
        expect(select.getBoundingClientRect().height).withContext('the kind select is shown').toBeGreaterThan(0);
        for (const label of Array.from(form.querySelectorAll<HTMLLabelElement>('label[for]:not([for=""])'))) {
          const control = document.getElementById(label.htmlFor);
          expect(control).withContext(`a control for "${label.textContent?.trim()}"`).not.toBeNull();
          const shown = control!.closest('p-checkbox') ?? control!;
          expect(shown.getBoundingClientRect().height).withContext(`"${label.textContent?.trim()}"'s control is shown`).toBeGreaterThan(0);
        }

        // The Enabled row starts where the select starts (either direction).
        const enabled = form.querySelector<HTMLElement>('[data-testid="action-form-enabled"]');
        const always = form.querySelector<HTMLElement>('[data-testid="action-form-always-runs"]');
        expect(!!enabled !== !!always).withContext('exactly one of the Enabled row and the Always-runs line').toBeTrue();
        const row = (enabled ?? always)!;
        const start = (el: Element): number =>
          language === 'ar' ? el.getBoundingClientRect().right : el.getBoundingClientRect().left;
        expect(Math.round(start(row.firstElementChild!))).withContext('aligned with the select').toBe(Math.round(start(select)));
        if (kind === 'LOG_AUDIT') {
          expect(enabled).withContext('the audit log has no box').toBeNull();
        } else {
          expect(enabled!.querySelector('input[type="checkbox"]')).withContext('an Enabled box').not.toBeNull();
        }
      });
    }

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
