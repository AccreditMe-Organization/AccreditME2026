import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslatePipe, TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { providePrimeNG } from 'primeng/config';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { ISeatPositionDto, UserService } from '../../services/user.service';
import { OrgPositionService } from '../../../org-position/services/org-position.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { OrgUnitHeadService } from '../../../organization/services/org-unit-head.service';
import { InviteUserComponent } from './invite-user.component';

// ACC-159 — the Invite user dialog with its seats line, against the 420px body
// cap (ACC-111), MEASURED in both languages, in the real theme and font, hosted
// exactly as the Users list hosts it (compact density, the actions in the
// footer). At 1280 (the dialog's own 560) and on a 390 phone.
//
// States, each with the seats line FULL unless named: the line normal; full;
// full with every field's error revealed. Each keeps at least 20px of room
// under the cap, and nothing in the body scrolls.
//
// Two more are MEASURED AND LOGGED, NOT HELD TO THE CAP, because they were over
// it before the seats line existed (measured without it, 21 Nov): "this unit has
// no head" (435 / 452 at 560, 477 / 476 at 390) and the server's refusal said
// above the fields (522 / 524, 606 / 596). Both are the form's own messages,
// not this line; they are reported on ACC-159 for their own fix.
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass, so the seats
// line itself is checked present before any height is believed.

const CAP = 420;
const ROOM = 20;
const FLOOR = 60;
const WIDTHS = [1280, 390] as const;

const POSITION = {
  id: 'pos-1',
  organizationId: 'org-1',
  nameEn: 'Senior Infection Control Specialist',
  nameAr: 'أخصائي أول لمكافحة العدوى',
  grade: 5,
  isSingleAssignee: false,
  isUnitHeadPosition: false,
  roleId: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const UNIT = {
  id: 'unit-1',
  organizationId: 'org-1',
  parentId: null,
  nameEn: 'Infection Prevention and Control Department',
  nameAr: 'إدارة الوقاية من العدوى ومكافحتها',
  code: 'IPC',
  type: null,
  description: null,
  isActive: true,
  isCodeLocked: false,
  sortOrder: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};
const NO_HEAD = {
  holders: [],
  pendingHeadUserId: null,
  headHandoverEffectiveDate: null,
  actingHeadUserId: null,
  lastVacancy: null,
  pendingHeadAccessSince: null,
  cover: null,
  activeCover: null,
  scheduledCover: null,
  recentlyEndedCovers: [],
};

@Component({
  standalone: true,
  imports: [EditDialogComponent, InviteUserComponent, ButtonModule, TranslatePipe],
  template: `
    <ng-template #inviteTpl>
      <app-invite-user (ready)="form.set($event)" />
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-2">
        <p-button [label]="'common.cancel' | translate" severity="secondary" [text]="true" />
        <p-button [label]="'user.sendInvitation' | translate" (onClick)="form()?.onSubmit()" data-testid="invite-send" />
      </div>
    </ng-template>
    <app-edit-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [header]="'user.invite' | translate"
      [content]="inviteTpl"
      [footer]="footerTpl"
      density="compact"
    />
  `,
})
class Host {
  readonly visible = signal(true);
  readonly form = signal<InviteUserComponent | null>(null);
}

describe('Invite user dialog — the seats line, measured (ACC-159)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  let fixture: ComponentFixture<Host>;
  let seats: ISeatPositionDto;
  let inviteResult: () => Observable<unknown>;

  afterAll(() => console.log(`ACC-159 invite dialog (cap ${CAP}, room ≥ ${ROOM}):\n  ${measured.join('\n  ')}`));

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    fixture?.destroy();
  });

  async function open(language: 'en' | 'ar', width: (typeof WIDTHS)[number], seatsNow: ISeatPositionDto): Promise<void> {
    TestBed.resetTestingModule();
    seats = seatsNow;
    inviteResult = () => of({});
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        {
          provide: UserService,
          useValue: {
            getSeats: () => of(seats),
            listAllUsers: () => of([{ id: 'mgr-1', name: 'Dr. Layla Al-Harbi', primaryOrgUnitId: 'unit-1' }]),
            invite: () => inviteResult(),
          },
        },
        { provide: OrgPositionService, useValue: { listPositions: () => of([POSITION]) } },
        { provide: OrgUnitService, useValue: { getFlat: () => of([UNIT]) } },
        { provide: OrgUnitHeadService, useValue: { getHeadStatus: () => of(NO_HEAD) } },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => p === 'users:invite' } },
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
  const seatsLine = () => document.querySelector<HTMLElement>('[data-invite-seats]');
  const form = () => fixture.componentInstance.form()!;

  async function still(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const f = frame();
      if (f && Math.abs(f.getBoundingClientRect().width - f.offsetWidth) <= 0.01) return settle();
      await new Promise((r) => setTimeout(r, 20));
    }
    fail('the dialog never stopped animating');
  }

  async function send(): Promise<void> {
    document.querySelector<HTMLButtonElement>('[data-testid="invite-send"] button')!.click();
    await settle();
  }

  function check(label: string, language: string, width: number, overBefore = false): number {
    const b = body();
    expect(b).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    const height = b.scrollHeight;
    const drawn = Math.round(frame().getBoundingClientRect().width);
    const note = overBefore ? ' (over the cap before ACC-159)' : '';
    measured.push(`${label} [${language}, ${width}]: body ${height}px, room ${CAP - height}px, dialog ${drawn}px wide${note}`);
    expect(height).withContext(`${label} [${language}, ${width}] not laid out`).toBeGreaterThan(FLOOR);
    expect(drawn).withContext(`${label} [${language}] dialog width`).toBe(width === 390 ? 390 : 560);
    if (overBefore) return height;
    expect(CAP - height)
      .withContext(`${label} [${language}, ${width}] body ${height}px leaves under ${ROOM}px`)
      .toBeGreaterThanOrEqual(ROOM);
    const scrollers = Array.from(b.querySelectorAll<HTMLElement>('*')).filter(
      (n) => n.scrollHeight > n.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(n).overflowY),
    );
    expect(scrollers.map((n) => `${n.tagName}.${n.className} ${n.scrollHeight}/${n.clientHeight}`))
      .withContext(`${label} [${language}, ${width}] something scrolls`)
      .toEqual([]);
    return height;
  }

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      describe(`${language === 'en' ? 'English' : 'Arabic'} at ${width}`, () => {
        it('normal, full, full with every error, full with "no head"', async () => {
          await open(language, width, { occupied: 7, maxUsers: 25 });
          // Non-vacuity: the line is there, and not full.
          expect(seatsLine()).withContext('the seats line').not.toBeNull();
          expect(seatsLine()!.hasAttribute('data-full')).toBeFalse();
          check('seats normal', language, width);

          fixture.destroy();
          document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
          await open(language, width, { occupied: 25, maxUsers: 25 });
          expect(seatsLine()!.hasAttribute('data-full')).withContext('full').toBeTrue();
          check('seats full', language, width);

          await send();
          expect(document.querySelector('.am-field__message--error')).withContext('the errors are showing').not.toBeNull();
          check('seats full, every error', language, width);

          form().form.controls.primaryOrgUnitId.setValue('unit-1');
          await settle();
          expect(form().selectedUnitHasNoHead()).withContext('the no-head line').toBeTrue();
          check('seats full, unit has no head', language, width, true);
        }, 40_000);

        it('full, with the server\'s seat refusal said above the fields', async () => {
          await open(language, width, { occupied: 25, maxUsers: 25 });
          inviteResult = () =>
            throwError(
              () =>
                new HttpErrorResponse({
                  status: 409,
                  error: { statusCode: 409, message: 'SERVER ENGLISH', code: 'SEAT_LIMIT_REACHED' },
                }),
            );
          const f = form();
          f.form.controls.name.setValue('Dr. Nora bint Abdulrahman Al-Otaibi');
          f.form.controls.email.setValue('nora.alotaibi@alnakheel-hospital.test');
          f.form.controls.positionId.setValue('pos-1');
          f.form.controls.primaryOrgUnitId.setValue('unit-1');
          f.form.controls.managerId.setValue('mgr-1');
          await settle();
          await send();
          expect(f.error()).withContext('the refusal').toContain(
            language === 'en' ? 'Every seat on your organisation' : 'جميع المقاعد في خطة المنشأة',
          );
          check('seats full, seat refusal', language, width, true);
        }, 40_000);
      });
    }
  }
});
