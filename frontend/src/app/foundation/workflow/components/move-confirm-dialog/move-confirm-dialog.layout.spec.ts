import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { MOVE_REASON_MAX, MoveConfirmCopy, MoveConfirmDialogComponent } from './move-confirm-dialog.component';

// ACC-316 PR 6 — the move buttons' confirm against the 420px body cap (ACC-111),
// MEASURED in both languages, in the real theme and font, at 1280 and on a 390
// phone (the dialog given that width, as the remove-member layout spec does).
//
// Two copies a meeting gives its moves: Cancel Meeting, which needs a reason
// (empty; pressed with nothing typed; a realistic reason; the 2000-character
// limit, where only the textarea scrolls), and Issue Agenda, a confirm with no
// field. Each body keeps at least 20px under the cap and scrolls nowhere.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const CAP = 420;
const ROOM = 20;
const FLOOR = 40;
const WIDTHS = [1280, 390] as const;
const CANCEL: MoveConfirmCopy = {
  titleKey: 'meeting.cancel.title',
  leadKey: 'meeting.cancel.lead',
  hintKey: 'meeting.cancel.hint',
  confirmKey: 'meeting.cancel.confirm',
  keepKey: 'meeting.cancel.keep',
  danger: true,
};
const ISSUE: MoveConfirmCopy = {
  titleKey: 'meeting.issue.title',
  leadKey: 'meeting.issue.lead',
  confirmKey: 'meeting.issue.confirm',
  keepKey: 'meeting.issue.keep',
  danger: false,
};
const REASON = {
  en: 'The chair is travelling on the 14th; we will set a new date at the next meeting of the board.',
  ar: 'رئيس اللجنة في سفر يوم 14، وسنحدد موعدًا جديدًا في الاجتماع القادم لمجلس الإدارة.',
};

@Component({
  standalone: true,
  imports: [MoveConfirmDialogComponent],
  template: `<app-move-confirm-dialog [visible]="true" [copy]="copy()" [needsReason]="needsReason()" />`,
})
class Host {
  readonly copy = signal<MoveConfirmCopy>(CANCEL);
  readonly needsReason = signal(true);
}

describe('Move confirm dialog — layout, measured (ACC-316 PR 6)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  let fixture: ComponentFixture<Host>;

  afterAll(() => console.log(`ACC-316 move confirm dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${measured.join('\n  ')}`));

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    fixture?.destroy();
  });

  async function open(language: 'en' | 'ar', width: (typeof WIDTHS)[number], copy: MoveConfirmCopy, needsReason: boolean): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.copy.set(copy);
    fixture.componentInstance.needsReason.set(needsReason);
    document.body.appendChild(fixture.nativeElement);
    fixture.autoDetectChanges(true);
    await settle();
    if (width === 390) frame().style.width = '390px';
    await still();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  const body = () => document.querySelector<HTMLElement>('.am-dialog__body')!;
  const frame = () => document.querySelector<HTMLElement>('.p-dialog')!;
  const textarea = () => document.querySelector<HTMLTextAreaElement>('#moveConfirmReason')!;
  const press = async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="move-confirm-submit"] button')!.click();
    await settle();
    await still();
  };
  const type = async (value: string) => {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
    await settle();
  };

  /** Boxes are read once PrimeNG's open motion has stopped (it scales the frame). */
  async function still(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const f = frame();
      if (f && Math.abs(f.getBoundingClientRect().width - f.offsetWidth) <= 0.01) return settle();
      await new Promise((r) => setTimeout(r, 20));
    }
    fail('the dialog never stopped animating');
  }

  function check(label: string, language: string, width: number, allowTextareaScroll = false): number {
    const b = body();
    expect(b).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    const height = b.scrollHeight;
    const drawn = Math.round(frame().getBoundingClientRect().width);
    measured.push(`${label} [${language}, ${width}]: body ${height}px, room ${CAP - height}px, dialog ${drawn}px wide`);
    expect(height).withContext(`${label} [${language}, ${width}] not laid out`).toBeGreaterThan(FLOOR);
    expect(CAP - height).withContext(`${label} [${language}, ${width}] body ${height}px leaves under ${ROOM}px`).toBeGreaterThanOrEqual(ROOM);
    const scrollers = Array.from(b.querySelectorAll<HTMLElement>('*'))
      .filter((n) => !(allowTextareaScroll && n === textarea()))
      .filter((n) => n.scrollHeight > n.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(n).overflowY));
    expect(scrollers.map((n) => `${n.tagName}.${n.className} ${n.scrollHeight}/${n.clientHeight}`))
      .withContext(`${label} [${language}, ${width}] something scrolls`)
      .toEqual([]);
    return height;
  }

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      describe(`${language === 'en' ? 'English' : 'Arabic'} at ${width}`, () => {
        it('Cancel Meeting: empty, with its error, filled, at the limit', async () => {
          await open(language, width, CANCEL, true);
          // Non-vacuity: the meeting's own words and the field are there.
          expect(document.querySelector('.p-dialog-title')?.textContent?.trim()).toBe(language === 'en' ? en.meeting.cancel.title : ar.meeting.cancel.title);
          expect(document.querySelector('[data-testid="move-confirm-lead"]')?.textContent?.trim()).toBe(
            language === 'en' ? en.meeting.cancel.lead : ar.meeting.cancel.lead,
          );
          expect(textarea()).not.toBeNull();
          const empty = check('cancel, empty', language, width);

          await press();
          expect(document.querySelector('.am-field__message--error')).withContext('the error is showing').not.toBeNull();
          check('cancel, with its error', language, width);

          await type(REASON[language]);
          const filled = check('cancel, filled', language, width);
          expect(textarea().scrollHeight).withContext('the reason fits the field').toBeLessThanOrEqual(textarea().clientHeight + 1);

          await type('x '.repeat(MOVE_REASON_MAX / 2).trim());
          const full = check('cancel, at the limit', language, width, true);
          expect(full).withContext('a long reason scrolls in its field; the body does not grow').toBe(filled);
          expect(empty).toBeGreaterThan(FLOOR);
        }, 30_000);

        it('Issue Agenda: a confirm, with no field', async () => {
          await open(language, width, ISSUE, false);
          expect(document.querySelector('[data-testid="move-confirm-lead"]')?.textContent?.trim()).toBe(
            language === 'en' ? en.meeting.issue.lead : ar.meeting.issue.lead,
          );
          expect(textarea()).withContext('no reason field').toBeNull();
          check('issue', language, width);
        }, 30_000);
      });
    }
  }
});
