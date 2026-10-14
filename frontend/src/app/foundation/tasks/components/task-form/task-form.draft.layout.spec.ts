import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { ITaskDraft } from '../../services/task.service';
import { TaskFormComponent } from './task-form.component';
import { TaskFormFooterComponent } from './task-form-footer.component';
import { TaskFormStepsComponent } from './task-form-steps.component';

// ACC-197 — the 420px body cap (ACC-111), MEASURED and not assumed (ACC-120):
// step 2 of New task in every state of "Draft with AI" — idle, working, the
// suggestion, a refusal — in both languages, in the real dialog shell with the
// real theme, font and translations, exactly as the committee page hosts it
// (the step strip in the header, the actions in the footer). No task is
// created: every request is answered by the test.
//
// HOW IT CAME TO FIT. The drawing put step 2 with a suggestion at 383 / 400.
// The BUILT step 2 has two more things than it drew — the evidence hint and
// the Source block — so:
//   1. the working line and the suggestion TAKE THE PLACE of the two blocks
//      below them, and of the description's hint (plan §2.1);
//   2. the suggestion is drawn at the meta step, with the title on a line and
//      "Use this title" in the action row. At the body step with a boxed title
//      it measured 507 / 585;
//   3. the server's caps came down from 70 / 140 / 200 / 140 to 60 / 120 / 180
//      / 120, so a draft is eight lines at most: 410 in Arabic with the old
//      caps left no room for one wide word.
// The 420 did not move.
//
// THE SUGGESTION IS MEASURED AT ITS WORST, three ways:
//   - ordinary prose with every part at its cap, a title at its cap, and the
//     "Accept or discard the suggestion first." line under the card;
//   - the same prose ONE EIGHTH LONGER than the caps allow, which must still
//     fit with nothing scrolling: the room each line keeps for wider words
//     than this fixture's;
//   - text no cap can bound (one unbroken run of the widest letter): the text
//     block scrolls inside itself and the body still does not pass the cap.
//
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass "<= 420"
// perfectly. Each case asserts the body is really laid out, that the state
// being measured is on screen, and that the real font is the one measured.

const API = environment.apiUrl;
const CAP = 420;
const FLOOR = 150;

const FAR = { dueAt: '2100-01-01T00:00:00.000Z', limitAt: '2100-01-01T00:00:00.000Z' };
const FAR_LIMITS = { CRITICAL: FAR, HIGH: FAR, MEDIUM: FAR, LOW: FAR };

/** Real words, repeated and cut to EXACTLY n characters — so lines wrap as prose does. */
function words(source: string, n: number): string {
  let out = '';
  while (out.length < n) out += `${source} `;
  return out.slice(0, n).trimEnd().padEnd(n, 'x');
}

const EN_WORDS = 'check every dispenser and the store then reorder through supply and agree a weekly check with the charge nurse';
const AR_WORDS = 'فحص كل موزع وفي المستودع ثم طلب الكمية عبر الإمداد والاتفاق على فحص أسبوعي مع رئيسة التمريض في الجناح';

/** The server's caps (backend draft-answer.ts): title, purpose, to do, done when. */
const CAPS = { title: 60, purpose: 120, toDo: 180, doneWhen: 120 };

/** One eighth over the caps: the room kept for words wider than the fixture's. */
const ROOM = 1.125;

type Wording = 'prose' | 'unbounded';

/** A draft with EVERY part at its server cap, or `stretch` times it. */
function worstDraft(language: 'en' | 'ar', wording: Wording = 'prose', stretch = 1): ITaskDraft {
  const prose = language === 'ar' ? AR_WORDS : EN_WORDS;
  const text = (cap: number): string => {
    const n = Math.ceil(cap * stretch);
    return wording === 'unbounded' ? (language === 'ar' ? 'ض' : 'W').repeat(n) : words(prose, n);
  };
  const labels = language === 'ar' ? ['الغرض:', 'المطلوب:', 'يُعدّ منجزًا:'] : ['Purpose:', 'To do:', 'Done when:'];
  const lines = [
    { label: labels[0]!, text: text(CAPS.purpose) },
    { label: labels[1]!, text: text(CAPS.toDo) },
    { label: labels[2]!, text: text(CAPS.doneWhen) },
  ];
  return { draftId: 'log-1', title: text(CAPS.title), lines, description: lines.map((l) => `${l.label} ${l.text}`).join('\n') };
}

@Component({
  standalone: true,
  imports: [TaskFormComponent, TaskFormFooterComponent, TaskFormStepsComponent, EditDialogComponent],
  template: `
    <ng-template #steps><app-task-form-steps [form]="formRef()" /></ng-template>
    <ng-template #footer><app-task-form-footer [form]="formRef()" /></ng-template>
    <ng-template #body>
      <app-task-form
        [lockedSourceType]="locked ? 'COMMITTEE' : null"
        [lockedSourceId]="locked ? 'cmt-1' : null"
        [lockedSourceLabel]="locked ? 'Infection Control Committee' : null"
        (ready)="formRef.set($event)"
      />
    </ng-template>
    <app-edit-dialog
      [visible]="true"
      header="New task"
      context="on Infection Control Committee"
      [content]="body"
      [headerExtra]="steps"
      [footer]="footer"
    />
  `,
})
class HostComponent {
  locked = true;
  readonly formRef = signal<TaskFormComponent | null>(null);
}

describe('New task, step 2 with Draft with AI — the 420px body cap (ACC-197)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;
  let fixture: ComponentFixture<HostComponent>;
  const measured: string[] = [];

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Opens New task in the dialog, on step 2, with AI available. */
  async function open(language: 'en' | 'ar', locked = true): Promise<TaskFormComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.locked = locked;
    fixture.detectChanges();
    await settle();
    http.expectOne(`${API}/tasks/assignment/units`).flush([]);
    http.expectOne(`${API}/working-calendar`).flush({
      id: 'cal-1',
      organizationId: 'org-1',
      timezone: 'Asia/Riyadh',
      workingDays: [0, 1, 2, 3, 4],
      workingHoursStart: '07:30',
      workingHoursEnd: '17:00',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    http.expectOne(`${API}/working-calendar/holidays`).flush([]);
    http.expectOne(`${API}/tasks/sla-preview`).flush(FAR_LIMITS);
    http.expectOne(`${API}/tasks/draft/availability`).flush({ available: true });
    const form = fixture.componentInstance.formRef()!;
    form.form.patchValue({ title: 'Hand rub', description: 'follow up hand rub stock ward 6A' });
    form.step.set(2);
    await settle();
    return form;
  }

  function body(): HTMLElement {
    const el = document.querySelector<HTMLElement>('.am-dialog__body');
    expect(el).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    return el!;
  }

  /** The body's full content height — what it would need to show without scrolling. */
  async function measure(label: string, language: 'en' | 'ar', onScreen: string): Promise<number> {
    await settle();
    // The real font, loaded — a fallback font wraps lines elsewhere.
    await document.fonts.ready;
    await settle();
    expect(document.fonts.check('13px "IBM Plex Sans Arabic"')).withContext('measured in a fallback font').toBe(true);
    // Non-vacuity: the state under measurement is really on screen.
    expect(document.querySelector(onScreen)).withContext(`${label} [${language}]: ${onScreen} is not on screen`).not.toBeNull();
    const height = body().scrollHeight;
    measured.push(`${label} [${language}]: ${height}px`);
    expect(height).withContext(`${label} [${language}] is not laid out`).toBeGreaterThan(FLOOR);
    expect(height).withContext(`${label} [${language}] body ${height}px against the ${CAP}px cap`).toBeLessThanOrEqual(CAP);
    return height;
  }

  /** The suggestion's text block: what it needs, what it has, and how many lines that is. */
  function textBlock(): { needs: number; has: number; lines: number } {
    const block = document.querySelector<HTMLElement>('app-task-draft-card .am-draft__text')!;
    const lineHeight = parseFloat(getComputedStyle(block.querySelector('.am-draft__line')!).lineHeight);
    return { needs: block.scrollHeight, has: block.clientHeight, lines: Math.round(block.scrollHeight / lineHeight) };
  }

  const pressTrigger = async (): Promise<void> => {
    document.querySelector<HTMLButtonElement>('app-task-draft-trigger .am-ai__trigger')!.click();
    await settle();
  };
  const draftRequest = () => http.expectOne({ method: 'POST', url: `${API}/tasks/draft` });

  afterAll(() => {
    // The numbers recorded in step-197-task-drafting.md §15.
    console.log(`ACC-197 measurements\n${measured.join('\n')}`);
  });

  for (const language of ['en', 'ar'] as const) {
    describe(language, () => {
      afterEach(() => http.verify());

      it('idle: the trigger on the label row adds NO height to step 2, and sits wholly inside the body', async () => {
        await open(language);
        const withTrigger = await measure('idle · trigger shown', language, 'app-task-draft-trigger .am-ai__trigger');
        // Not clipped by the body's top edge, and clear of the field below it.
        const trigger = document.querySelector('app-task-draft-trigger .am-ai__trigger')!.getBoundingClientRect();
        expect(trigger.height).toBeGreaterThan(10);
        expect(trigger.top).withContext('the trigger pokes above the dialog body, which clips it').toBeGreaterThanOrEqual(body().getBoundingClientRect().top);
        expect(trigger.bottom).toBeLessThanOrEqual(document.querySelector('#description')!.getBoundingClientRect().top);
        // The same step with no trigger at all, to compare against.
        fixture.componentInstance.formRef()!.draft.available.set(false);
        await settle();
        expect(document.querySelector('app-task-draft-trigger .am-ai__trigger')).toBeNull();
        expect(body().scrollHeight).withContext('the trigger changed the height of step 2').toBe(withTrigger);
      });

      it('working: the working line takes the place of the two lower blocks', async () => {
        await open(language);
        await pressTrigger();
        const req = draftRequest();
        await measure('working', language, 'app-task-draft-card .am-ai__result--working');
        expect(document.querySelector('#requiresEvidence')).toBeNull();
        req.flush(worstDraft(language));
      });

      it('the suggestion AT ITS WORST fits: every part at its cap, the title line, and the "settle first" line', async () => {
        const form = await open(language);
        await pressTrigger();
        draftRequest().flush(worstDraft(language));
        await measure('suggestion · worst case', language, 'app-task-draft-card .am-draft__title');
        // Non-vacuity: the worst case really is at the caps, and "Use this title" is in the action row.
        const parts = Array.from(document.querySelectorAll('.am-draft__line')).map((l) => l.textContent!.trim().length);
        expect(parts.length).toBe(3);
        expect(Math.max(...parts)).toBeGreaterThan(CAPS.toDo);
        expect(document.querySelector('.am-ai__actions .am-draft__title-button')).not.toBeNull();
        // Nothing scrolls inside the card either: eight lines at most.
        const block = textBlock();
        expect(block.has).toBeGreaterThan(0);
        expect(block.needs).withContext(`the text block scrolls: ${block.lines} lines`).toBeLessThanOrEqual(block.has);
        measured.push(`   ${block.lines} lines of suggestion`);

        form.onSubmit(); // Create task while unsettled: the message appears under the card.
        await measure('suggestion · worst case · "settle first" shown', language, 'app-task-draft-card .am-draft__settle');
      });

      it('prose one eighth LONGER than the caps still fits, with nothing scrolling: the room kept for wider words', async () => {
        const form = await open(language);
        await pressTrigger();
        draftRequest().flush(worstDraft(language, 'prose', ROOM));
        form.onSubmit();
        await measure('suggestion · one eighth over the caps · "settle first" shown', language, 'app-task-draft-card .am-draft__settle');
        const block = textBlock();
        expect(block.needs).withContext(`the text block scrolls: ${block.lines} lines`).toBeLessThanOrEqual(block.has);
        measured.push(`   ${block.lines} lines of suggestion`);
      });

      it('text no cap can bound scrolls INSIDE the card; the body still does not pass the cap', async () => {
        const form = await open(language);
        await pressTrigger();
        draftRequest().flush(worstDraft(language, 'unbounded'));
        form.onSubmit();
        await measure('suggestion · unbroken widest letters · "settle first" shown', language, 'app-task-draft-card .am-draft__settle');
        // Non-vacuity: this wording really does need more than the block gives.
        const block = textBlock();
        expect(block.needs).toBeGreaterThan(block.has);
        measured.push(`   ${block.lines} lines of suggestion, held to 8`);
      });

      it('a refusal fits WITH the two lower blocks still showing: the longest sentence, and a failed call with Try again', async () => {
        await open(language);
        await pressTrigger();
        draftRequest().flush(
          { statusCode: 409, message: 'x', code: 'AI_CREDITS_EXHAUSTED', renewsAt: '2026-10-21T00:00:00.000Z' },
          { status: 409, statusText: 'Conflict' },
        );
        await measure('refusal · credits used up', language, 'app-task-draft-card .am-ai__refusal');
        expect(document.querySelector('#requiresEvidence')).withContext('a refusal hides nothing').not.toBeNull();

        await pressTrigger();
        draftRequest().flush({ statusCode: 409, message: 'x', code: 'DRAFT_NOTHING_TO_SUGGEST' }, { status: 409, statusText: 'Conflict' });
        await measure('refusal · nothing to suggest', language, 'app-task-draft-card .am-ai__refusal');

        await pressTrigger();
        draftRequest().flush({ statusCode: 502, message: 'x', code: 'AI_PROVIDER_FAILED' }, { status: 502, statusText: 'Bad Gateway' });
        await measure('refusal · failed, with Try again', language, 'app-task-draft-card .am-ai__refusal .am-ai__secondary');
        expect(document.querySelector('#requiresEvidence')).not.toBeNull();
      });

      it('the standalone screen (source typed by hand) fits too: idle, and a refusal with Try again', async () => {
        await open(language, false);
        await measure('unlocked source · idle', language, '#sourceId');
        await pressTrigger();
        draftRequest().flush({ statusCode: 502, message: 'x', code: 'AI_PROVIDER_FAILED' }, { status: 502, statusText: 'Bad Gateway' });
        await measure('unlocked source · refusal with Try again', language, 'app-task-draft-card .am-ai__refusal .am-ai__secondary');
      });
    });
  }
});
