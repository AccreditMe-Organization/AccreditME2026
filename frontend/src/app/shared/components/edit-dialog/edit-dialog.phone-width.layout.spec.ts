import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { environment } from '../../../../environments/environment';
import { AccreditMePreset } from '../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { LanguageService } from '../../../core/services/language.service';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { EditDialogComponent } from './edit-dialog.component';
import { UserService } from '../../../foundation/user/services/user.service';
import { OrgUnitService } from '../../../foundation/organization/services/org-unit.service';
import { OrgUnitHeadService } from '../../../foundation/organization/services/org-unit-head.service';
import { CommitteeService } from '../../../foundation/committees/services/committee.service';
import { TransferCommitteesService } from '../../../foundation/user/services/transfer-committees.service';
import { TransferUserWizardComponent } from '../../../foundation/user/components/transfer-user-wizard/transfer-user-wizard.component';
import {
  PERSON,
  UNITS,
  fakeUserService,
  seats,
  walkToAfterManager,
} from '../../../foundation/user/components/transfer-user-wizard/transfer-wizard.testing';
import { TaskFormComponent } from '../../../foundation/tasks/components/task-form/task-form.component';
import { TaskFormFooterComponent } from '../../../foundation/tasks/components/task-form/task-form-footer.component';
import { TaskFormStepsComponent } from '../../../foundation/tasks/components/task-form/task-form-steps.component';

// ACC-299 — a form dialog fits a phone. The shell caps every dialog's width at
// var(--am-dialog-max-inline), the screen less a 16px gutter each side, so at
// 390px the 640px Transfer wizard and the 560px New task are 358 wide and
// nothing in them scrolls sideways.
//
// THE 390PX SCREEN. A Karma window cannot be 390 wide, and the token reads
// 100vw, which here is the test window. So each case sets the token to the value
// it takes on a 390px screen, calc(390px - 2 * var(--am-space-16)), and the
// shell must hold the dialog to it. Remove the cap from the shell and the
// dialog is its own 640 / 560 again: that is the failure this pins.
//
// NON-VACUITY FIRST (ACC-120): the dialog is rendered with a real width, and
// uncapped it would be wider than the phone allows, so "no wider than 358" is
// the cap's doing and not a narrow dialog's.

const API = environment.apiUrl;
const PHONE = 390;
const GUTTER = 16;
const MAX = PHONE - 2 * GUTTER;
const FAR = { dueAt: '2100-01-01T00:00:00.000Z', limitAt: '2100-01-01T00:00:00.000Z' };

@Component({
  standalone: true,
  imports: [EditDialogComponent, TransferUserWizardComponent],
  template: `
    <ng-template #tpl><app-transfer-user-wizard [userId]="userId()" /></ng-template>
    <app-edit-dialog [visible]="true" header="Transfer user" context="Huda Al-Harbi" [content]="tpl" width="640px" />
  `,
})
class TransferHostComponent {
  readonly userId = input(PERSON.id);
}

@Component({
  standalone: true,
  imports: [TaskFormComponent, TaskFormFooterComponent, TaskFormStepsComponent, EditDialogComponent],
  template: `
    <ng-template #steps><app-task-form-steps [form]="formRef()" /></ng-template>
    <ng-template #footer><app-task-form-footer [form]="formRef()" /></ng-template>
    <ng-template #body>
      <app-task-form
        lockedSourceType="COMMITTEE"
        lockedSourceId="cmt-1"
        lockedSourceLabel="Infection Prevention and Control Committee"
        (ready)="formRef.set($event)"
      />
    </ng-template>
    <app-edit-dialog
      [visible]="true"
      header="New task"
      context="on Infection Prevention and Control Committee"
      [content]="body"
      [headerExtra]="steps"
      [footer]="footer"
    />
  `,
})
class NewTaskHostComponent {
  readonly formRef = signal<TaskFormComponent | null>(null);
}

describe('Form dialogs at a 390px phone width (ACC-299)', () => {
  preserveDocumentLanguage();
  const measured: string[] = [];
  let fixture: ComponentFixture<unknown>;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  function base(language: 'en' | 'ar', providers: unknown[]): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ...(providers as never[]),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    // The token as a 390px screen gives it.
    document.documentElement.style.setProperty('--am-dialog-max-inline', `calc(${PHONE}px - 2 * var(--am-space-16))`);
  }

  afterEach(() => {
    document.documentElement.style.removeProperty('--am-dialog-max-inline');
    fixture?.destroy();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((el) => el.remove());
  });

  afterAll(() => {
    console.log(`ACC-299 dialog widths at ${PHONE}px (max ${MAX}):\n  ${measured.join('\n  ')}`);
  });

  /** The uncapped width the dialog asks for: its explicit width, or its size token. */
  function askedWidth(dialog: HTMLElement): number {
    const w = dialog.style.width;
    const token = /var\((--[^)]+)\)/.exec(w)?.[1];
    return parseFloat(token ? getComputedStyle(document.documentElement).getPropertyValue(token) : w);
  }

  function assertFits(label: string): void {
    const dialog = document.querySelector<HTMLElement>('.p-dialog')!;
    // Non-vacuity: a real dialog, which uncapped would not fit the phone.
    expect(dialog).withContext(`${label}: no dialog`).not.toBeNull();
    // offsetWidth: the laid-out width. A bounding box would include PrimeNG's
    // opening scale, which runs on the real clock.
    const width = dialog.offsetWidth;
    expect(width).withContext(`${label}: the dialog is laid out`).toBeGreaterThan(0);
    expect(askedWidth(dialog)).withContext(`${label}: uncapped, the dialog asks for more than ${MAX}`).toBeGreaterThan(MAX);

    const body = dialog.querySelector<HTMLElement>('.am-dialog__body')!;
    measured.push(`${label}: dialog ${Math.round(width)}px, body ${body.scrollWidth}/${body.clientWidth}`);
    expect(Math.round(width)).withContext(`${label}: dialog ${Math.round(width)}px against ${MAX}`).toBeLessThanOrEqual(MAX);
    expect(dialog.scrollWidth).withContext(`${label}: the dialog scrolls sideways`).toBeLessThanOrEqual(dialog.clientWidth + 1);
    expect(body.scrollWidth).withContext(`${label}: the body scrolls sideways`).toBeLessThanOrEqual(body.clientWidth + 1);
  }

  for (const language of ['en', 'ar'] as const) {
    it(`Transfer wizard, Destination and Committees [${language}]`, async () => {
      base(language, [
        { provide: UserService, useValue: fakeUserService() },
        { provide: OrgUnitService, useValue: { getFlat: () => of(UNITS) } },
        { provide: OrgUnitHeadService, useValue: {} },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        { provide: TransferCommitteesService, useValue: { forUser: () => of(seats(4)) } },
        { provide: CommitteeService, useValue: { removeMember: () => of(undefined) } },
      ]);
      fixture = TestBed.createComponent(TransferHostComponent);
      await settle();
      assertFits(`Transfer · Destination [${language}]`);

      const wizard = fixture.debugElement.query(By.directive(TransferUserWizardComponent)).componentInstance as TransferUserWizardComponent;
      walkToAfterManager(wizard);
      await settle();
      expect(document.querySelector('[data-testid="transfer-committees"]')).withContext('on the Committees step').not.toBeNull();
      assertFits(`Transfer · Committees [${language}]`);
    });

    it(`New task, steps 1 and 2 [${language}]`, async () => {
      base(language, [provideHttpClient(), provideHttpClientTesting()]);
      const http = TestBed.inject(HttpTestingController);
      fixture = TestBed.createComponent(NewTaskHostComponent);
      await settle();
      http.expectOne(`${API}/tasks/assignment/units`).flush([]);
      http.expectOne(`${API}/working-calendar`).flush({
        id: 'cal-1',
        organizationId: 'org-1',
        timezone: 'Asia/Riyadh',
        workingDays: [0, 1, 2, 3, 4],
        workingHoursStart: '08:00',
        workingHoursEnd: '16:00',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      http.expectOne(`${API}/working-calendar/holidays`).flush([]);
      http.expectOne(`${API}/tasks/sla-preview`).flush({ CRITICAL: FAR, HIGH: FAR, MEDIUM: FAR, LOW: FAR });
      http.expectOne(`${API}/tasks/draft/availability`).flush({ available: false });
      await settle();
      assertFits(`New task · step 1 [${language}]`);

      const form = (fixture.componentInstance as NewTaskHostComponent).formRef()!;
      form.form.patchValue({ title: 'Collect December infection figures' });
      form.step.set(2);
      await settle();
      assertFits(`New task · step 2 [${language}]`);
      http.verify();
    });
  }
});
