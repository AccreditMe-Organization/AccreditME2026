import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeService } from '../../services/committee.service';
import { CommitteeRemoveMemberDialogComponent, REMOVE_REASON_MAX } from './committee-remove-member-dialog.component';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';

// ACC-298 — the Remove member dialog against the 420px body cap (ACC-111),
// MEASURED in both languages, in the real theme and font, at 1280 (the form
// dialog's own 560) and on a 390 phone, where the dialog is the screen's width.
// A Karma window cannot be 390 wide, so the dialog is given that width, as the
// committee form's layout spec does.
//
// States: empty; pressed with nothing typed (the error showing); filled with a
// realistic reason; filled to the 2000-character limit (the textarea scrolls
// inside itself, so the body must not grow); and refused by the stage (its
// sentence under the field). Each body keeps at least 20px of room under the
// cap, and nothing in it scrolls except, at the limit, the textarea itself.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass.

const CAP = 420;
const ROOM = 20;
const FLOOR = 60;
const WIDTHS = [1280, 390] as const;
const NAME = 'Dr. Nora bint Abdulrahman Al-Otaibi';
const REASON = {
  en: 'Transferred to the Pharmacy and Therapeutics Committee as its secretary from next month.',
  ar: 'نُقلت العضوية إلى لجنة الصيدلة والعلاجات بصفة أمين سر اعتبارًا من الشهر القادم.',
};

@Component({
  standalone: true,
  imports: [CommitteeRemoveMemberDialogComponent],
  template: `
    <app-committee-remove-member-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      committeeId="c-1"
      [target]="{ memberId: 'm-1', name: name }"
    />
  `,
})
class Host {
  readonly visible = signal(true);
  readonly name = NAME;
}

describe('Remove member dialog — layout, measured (ACC-298)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  let fixture: ComponentFixture<Host>;
  let respond: () => Observable<void>;

  afterAll(() => console.log(`ACC-298 remove member dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${measured.join('\n  ')}`));

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    fixture?.destroy();
  });

  async function open(language: 'en' | 'ar', width: (typeof WIDTHS)[number]): Promise<void> {
    TestBed.resetTestingModule();
    respond = () => of(undefined);
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: CommitteeService, useValue: { removeMember: () => respond() } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(Host);
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
  const textarea = () => document.querySelector<HTMLTextAreaElement>('#committeeRemoveMemberReason')!;
  const press = async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="remove-member-submit"] button')!.click();
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

  /** A body: laid out, the right width, under the cap with the room, and scrolling nowhere. */
  function check(label: string, language: string, width: number, allowTextareaScroll = false): number {
    const b = body();
    expect(b).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    const height = b.scrollHeight;
    const drawn = Math.round(frame().getBoundingClientRect().width);
    measured.push(`${label} [${language}, ${width}]: body ${height}px, room ${CAP - height}px, dialog ${drawn}px wide`);
    expect(height).withContext(`${label} [${language}, ${width}] not laid out`).toBeGreaterThan(FLOOR);
    expect(drawn).withContext(`${label} [${language}] dialog width`).toBe(width === 390 ? 390 : 560);
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
        it('empty, with its error, filled, at the limit', async () => {
          await open(language, width);
          // Non-vacuity: the title, the consequence line and the field are there.
          expect(document.querySelector('.p-dialog-title')?.textContent).toContain(NAME);
          expect(document.querySelector('[data-testid="remove-member-consequence"]')).not.toBeNull();
          const empty = check('empty', language, width);

          await press();
          expect(document.querySelector('.am-field__message--error')).withContext('the error is showing').not.toBeNull();
          check('with its error', language, width);

          await type(REASON[language]);
          const filled = check('filled', language, width);
          expect(textarea().scrollHeight).withContext('the reason fits the field').toBeLessThanOrEqual(textarea().clientHeight + 1);

          await type('x '.repeat(REMOVE_REASON_MAX / 2).trim());
          const full = check('at the limit', language, width, true);
          expect(full).withContext('a long reason scrolls in its field; the body does not grow').toBe(filled);
          expect(empty).toBeGreaterThan(FLOOR);
        }, 30_000);

        it('refused by the stage, said under the field', async () => {
          await open(language, width);
          respond = () =>
            throwError(
              () =>
                new HttpErrorResponse({
                  status: 409,
                  error: { code: 'STAGE_ACTION_NOT_ALLOWED', action: 'remove_member', stageNameEn: 'Dissolution Pending', stageNameAr: 'بانتظار الحل' },
                }),
            );
          await type(REASON[language]);
          await press();
          expect(document.querySelector('[data-testid="committee-stage-refusal"]')).withContext('the refusal').not.toBeNull();
          check('refused by the stage', language, width);
        }, 30_000);
      });
    }
  }
});
