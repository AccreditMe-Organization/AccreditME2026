import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { UserService } from '../../services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { OrgUnitHeadService } from '../../../organization/services/org-unit-head.service';
import { CommitteeService } from '../../../committees/services/committee.service';
import { TransferCommitteesDto, TransferCommitteesService } from '../../services/transfer-committees.service';
import { TransferUserWizardComponent } from './transfer-user-wizard.component';
import { PERSON, UNITS, fakeUserService, seat, walkToAfterManager } from './transfer-wizard.testing';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';

// ACC-296 — the Committees step against the dialog body's 420px cap (ACC-111),
// in the real shell (EditDialogComponent at 640px, as both hosts open it) with
// the real theme, in both languages, at 1280 and at a 390px phone:
//   - 1, 5 and 100 rows, the 100 with the over-cap line ("Showing 100 of 140");
//   - every row a mix of the three kinds (a choice, a stage that blocks it, and
//     no permission is a separate run), because the "why" lines are the tallest.
// The list is what grows, so the LIST scrolls inside itself: the body's content
// keeps at least ROOM px under the cap (Ahmad's standing rule), so the body never
// scrolls. scrollHeight is compared with the CAP, not with clientHeight, because a
// Karma window is short and limits the body's box. And nothing may paint below the
// stepper: PrimeNG's inline p-steppanels padding used to add 18px of overflow, which
// scrolled the body on every step of this wizard.
//
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass "<= 400". The
// guard proves the step rendered with real height, that the list holds the
// rows asked for, and that 100 rows make the list scroll (it is taller inside
// than it shows) before any number may mean "fits".

const CAP = 420;
const ROOM = 20;
const FLOOR = 120;
const COUNTS = [1, 5, 100] as const;
const WIDTHS = [1280, 390] as const;

function mixedSeats(n: number): TransferCommitteesDto {
  const rows = Array.from({ length: n }, (_, i) =>
    i % 3 === 1
      ? seat(i + 1, { mayRemove: false, stage: { nameEn: 'Dissolution Pending', nameAr: 'قيد الحل' } })
      : seat(i + 1, { nameEn: `Infection Prevention and Control Committee ${i + 1}`, nameAr: `لجنة مكافحة العدوى ${i + 1}` }),
  );
  return { total: n === 100 ? 140 : n, rows };
}

@Component({
  standalone: true,
  imports: [EditDialogComponent, TransferUserWizardComponent],
  template: `
    <ng-template #tpl><app-transfer-user-wizard [userId]="userId()" /></ng-template>
    <app-edit-dialog [visible]="true" header="Transfer user" context="Huda Al-Harbi" [content]="tpl" width="640px" />
  `,
})
class HostComponent {
  readonly userId = input(PERSON.id);
}

describe('TransferUserWizard — the Committees step fits the 420px body (ACC-296)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HostComponent>;
  const measured: string[] = [];

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  async function render(language: 'en' | 'ar', committees: TransferCommitteesDto, permissions: string[]): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: UserService, useValue: fakeUserService() },
        { provide: OrgUnitService, useValue: { getFlat: () => of(UNITS) } },
        { provide: OrgUnitHeadService, useValue: {} },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        { provide: TransferCommitteesService, useValue: { forUser: () => of(committees) } },
        { provide: CommitteeService, useValue: { removeMember: () => of(undefined) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(HostComponent);
    await settle();
    const wizard = fixture.debugElement.query(By.directive(TransferUserWizardComponent)).componentInstance as TransferUserWizardComponent;
    walkToAfterManager(wizard);
    await settle();
  }

  async function atWidth(width: (typeof WIDTHS)[number]): Promise<void> {
    // At 390 the dialog is measured at the screen's width, the narrowest it
    // should ever be (more wrapping, so the tallest case). EditDialogComponent
    // has no breakpoint and keeps its 640px on a phone today, so in the app a
    // phone gets the 640 layout; this run is the stricter of the two.
    if (width === 390) document.querySelector<HTMLElement>('.p-dialog')!.style.width = '390px';
    // scrollHeight is the content's own height, whatever the (short) Karma
    // window does to the body's box; at 1280x800 and 390x844 the cap is 420.
    await settle();
  }

  const body = () => document.querySelector<HTMLElement>('.am-dialog__body')!;
  const list = () => document.querySelector<HTMLElement>('[data-testid="transfer-seats-list"]')!;

  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((el) => el.remove());
  });

  afterAll(() => {
    // The numbers the PR records.
    console.log(`ACC-296 body heights (cap ${CAP}):\n  ${measured.join('\n  ')}`);
  });

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      for (const count of COUNTS) {
        it(`${language} · ${width} · ${count} row${count === 1 ? '' : 's'}: the body stays ${ROOM}px under the cap and never scrolls`, async () => {
          await render(language, mixedSeats(count), ['committees:remove_member']);
          await atWidth(width);

          // Non-vacuity: the step is on screen, laid out, with the rows asked for.
          expect(body()).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
          expect(list()).withContext('the seats list rendered').not.toBeNull();
          expect(list().querySelectorAll('[data-seat]').length).toBe(count);
          expect(body().getBoundingClientRect().height).withContext('the body is laid out').toBeGreaterThan(FLOOR);
          if (count === 100) {
            expect(list().scrollHeight).withContext('100 rows make the LIST scroll').toBeGreaterThan(list().clientHeight + 100);
            expect(document.querySelector('[data-testid="transfer-seats-over-cap"]')).withContext('the over-cap line').not.toBeNull();
          }

          const height = body().scrollHeight;
          const stepper = body().querySelector('p-stepper')!.getBoundingClientRect().height;
          // Sub-pixel layout moves the two by a pixel or two between runs; the
          // overflow this guards is 18px.
          expect(height).withContext('nothing overflows below the stepper (p-steppanels padding)').toBeLessThanOrEqual(Math.ceil(stepper) + 4);
          measured.push(`${language} ${width} ${String(count).padStart(3)} rows: body ${height}px`);
          expect(height + ROOM).withContext(`${language} ${width} ${count} rows: body ${height}px`).toBeLessThanOrEqual(CAP);
        });
      }
    }
  }

  it('without committees:remove_member (every row says why): en and ar at 390 with 5 rows', async () => {
    for (const language of ['en', 'ar'] as const) {
      await render(language, mixedSeats(5), []);
      await atWidth(390);
      expect(list().querySelectorAll('[data-seat-why="permission"]').length).withContext('non-vacuity').toBe(5);
      const height = body().scrollHeight;
      measured.push(`${language} 390   5 rows, no permission: body ${height}px`);
      expect(height + ROOM).withContext(`${language} no permission: body ${height}px`).toBeLessThanOrEqual(CAP);
      fixture.destroy();
      document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((el) => el.remove());
    }
  });
});
