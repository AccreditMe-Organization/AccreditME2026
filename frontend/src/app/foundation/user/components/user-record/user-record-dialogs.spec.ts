import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { IUserDto } from '../../services/user.service';
import { EditProfileDialogComponent } from './edit-profile-dialog.component';
import { OutOfOfficeDialogComponent } from './out-of-office-dialog.component';
import { TwoStepSetupDialogComponent } from './two-step-setup-dialog.component';
import { TwoStepOffDialogComponent } from './two-step-off-dialog.component';

// ACC-120 slice 5 — the record page's four new dialogs. Numbered tests are the
// plan's; each was seen to fail under its mutation.

const RECORD: IUserDto = {
  id: 'cmtra1opx00nzocp15rd2xmhd',
  organizationId: 'cmtr9x7zq0000ocp1am2rs14o',
  email: 'yasser.alamri@alnakheel-hospital.test',
  name: 'Dr. Yasser Al-Amri',
  avatarUrl: null,
  status: 'ACTIVE',
  language: 'en',
  positionId: 'pos-senior',
  primaryOrgUnitId: 'unit-im',
  managerId: 'mgr-1',
  outOfOfficeFrom: '2026-10-20T00:00:00.000Z',
  outOfOfficeTo: '2026-10-24T00:00:00.000Z',
  actingUserId: 'cover-1',
  actingOrgUnitId: null,
  actingOrgUnitUntil: null,
  lastLoginAt: null,
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
};

@Component({
  standalone: true,
  imports: [EditProfileDialogComponent, OutOfOfficeDialogComponent, TwoStepSetupDialogComponent, TwoStepOffDialogComponent],
  template: `
    @switch (which()) {
      @case ('profile') {
        <app-edit-profile-dialog
          [visible]="visible()"
          (visibleChange)="visible.set($event)"
          [user]="user()"
          [isOwn]="isOwn()"
          [canEditPlacement]="placement()"
        />
      }
      @case ('ooo') {
        <app-out-of-office-dialog
          [visible]="visible()"
          (visibleChange)="visible.set($event)"
          [user]="user()"
          [coverOptions]="[{ id: 'cover-1', name: 'Dr. Omar Siddiqui', unit: '' }]"
        />
      }
      @case ('setup') {
        <app-two-step-setup-dialog [visible]="visible()" (visibleChange)="visible.set($event)" (enabled)="enabled = true" />
      }
      @case ('off') {
        <app-two-step-off-dialog [visible]="visible()" (visibleChange)="visible.set($event)" />
      }
    }
  `,
})
class Host {
  readonly which = signal<'profile' | 'ooo' | 'setup' | 'off'>('profile');
  readonly visible = signal(true);
  readonly user = signal<IUserDto | null>(RECORD);
  readonly isOwn = signal(false);
  readonly placement = signal(false);
  enabled = false;
}

describe('User record dialogs (ACC-120 slice 5)', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let http: HttpTestingController;
  let confirmSpy: jasmine.Spy;
  let languageUse: jasmine.Spy;
  let auth: { setupMfa: jasmine.Spy; verifyAndEnableMfa: jasmine.Spy; disableMfa: jasmine.Spy };

  function open(which: 'profile' | 'ooo' | 'setup' | 'off', setUp: (h: Host) => void = () => undefined): void {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: AuthService, useValue: auth },
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => false,
            isRtl: () => false,
            bilingual: (e: string) => e,
            use: (languageUse = jasmine.createSpy('use').and.returnValue(of(undefined))),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    confirmSpy = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    host.which.set(which);
    setUp(host);
    fixture.detectChanges();
    // The shell renders its body from a TemplateRef inside p-dialog, which
    // attaches on the pass after the dialog itself.
    fixture.detectChanges();
  }

  beforeEach(() => {
    auth = {
      setupMfa: jasmine.createSpy('setupMfa').and.returnValue(
        of({ qrCodeDataUrl: 'data:image/png;base64,AAAA', secret: 'JBSWY3DPEHPK3PXP', backupCodes: ['BACKUP-1111', 'BACKUP-2222'] }),
      ),
      verifyAndEnableMfa: jasmine.createSpy('verifyAndEnableMfa').and.returnValue(of(undefined)),
      disableMfa: jasmine.createSpy('disableMfa').and.returnValue(of(undefined)),
    };
  });

  // The dialogs append to <body>, so their content is read from the document.
  const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
  const type = (selector: string, value: string): void => {
    const input = q<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  // A <p-button> fires (onClick) from the <button> it renders, not its host.
  const click = (selector: string): void => {
    const el = q(selector)!;
    const target = el.matches('button, input') ? el : (el.querySelector('button') ?? el);
    (target as HTMLElement).click();
    fixture.detectChanges();
  };
  const escape = (): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };
  const patchBody = (): Record<string, unknown> => {
    const req = http.expectOne((r) => r.method === 'PATCH');
    const body = req.request.body as Record<string, unknown>;
    req.flush(RECORD);
    fixture.detectChanges();
    return body;
  };

  // ── Edit profile ────────────────────────────────────────────────────────
  describe('Edit profile', () => {
    it('4 · the placement fields render only when the viewer may change them', () => {
      open('profile');
      expect(q('[data-ep-placement]')).toBeNull();
      expect(q('#ep-position')).toBeNull();
      host.placement.set(true);
      fixture.detectChanges();
      expect(q('[data-ep-placement]')).not.toBeNull();
    });

    it('11 · Escape on unsaved edits asks first; on a clean form it simply closes', () => {
      open('profile');
      escape();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(host.visible()).toBe(false);

      host.visible.set(true);
      fixture.detectChanges();
      type('#ep-name', 'Dr. Yasser Al-Amri (edited)');
      escape();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(host.visible()).toBe(true);
    });

    it('12 · saving your OWN language switches the session to it', () => {
      open('profile', (h) => h.isOwn.set(true));
      click('[data-ep-save]');
      const req = http.expectOne((r) => r.method === 'PATCH');
      req.flush({ ...RECORD, language: 'ar' });
      expect(languageUse).toHaveBeenCalledWith('ar');
    });

    it("12 · saving SOMEONE ELSE's language never changes what you see", () => {
      open('profile', (h) => h.isOwn.set(false));
      click('[data-ep-save]');
      const req = http.expectOne((r) => r.method === 'PATCH');
      req.flush({ ...RECORD, language: 'ar' });
      expect(languageUse).not.toHaveBeenCalled();
    });

    it('an empty name is refused before anything is sent', () => {
      open('profile');
      type('#ep-name', '');
      click('[data-ep-save]');
      http.expectNone((r) => r.method === 'PATCH');
      expect(document.body.textContent).toContain('Enter a name.');
    });

    it('placement is sent only by a viewer who may change it', () => {
      open('profile');
      click('[data-ep-save]');
      const body = patchBody();
      expect(Object.keys(body).sort()).toEqual(['name']);
    });

    // Found in the browser pass: the old form sent the picker's language on
    // every save, so editing a name pinned someone with no saved language
    // (who follows the organisation's) to English.
    it('an unchanged language is not sent, so no saved preference is invented', () => {
      open('profile', (h) => h.user.set({ ...RECORD, language: null }));
      type('#ep-name', 'Dr. Yasser Al-Amri');
      click('[data-ep-save]');
      expect(patchBody()).toEqual({ name: 'Dr. Yasser Al-Amri' });
    });

    it('a changed language is sent', () => {
      open('profile', (h) => h.user.set({ ...RECORD, language: null }));
      const dialog = fixture.debugElement.children[0].componentInstance as EditProfileDialogComponent;
      dialog.form.controls.language.setValue('ar');
      dialog.form.controls.language.markAsDirty();
      click('[data-ep-save]');
      expect(patchBody()).toEqual({ name: 'Dr. Yasser Al-Amri', language: 'ar' });
    });
  });

  // ── Out of office ───────────────────────────────────────────────────────
  describe('Out of office', () => {
    it('13 · Clear all, then Save, sends all three fields as null — the endpoint replaces the window', () => {
      open('ooo');
      click('[data-ooo-clear-all]');
      click('[data-ooo-save]');
      const body = patchBody();
      expect(body).toEqual({ outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null });
    });

    it('A2 · changing only the end date keeps the start date and the cover person', () => {
      open('ooo');
      const dialog = fixture.debugElement.children[0].componentInstance as OutOfOfficeDialogComponent;
      const newEnd = new Date('2026-10-28T00:00:00.000Z');
      dialog.onDayPicked('to', newEnd);
      fixture.detectChanges();
      click('[data-ooo-save]');
      const body = patchBody();
      expect(body).toEqual({
        outOfOfficeFrom: '2026-10-20T00:00:00.000Z',
        outOfOfficeTo: newEnd.toISOString(),
        actingUserId: 'cover-1',
      });
    });

    it('an end before the start is refused before anything is sent', () => {
      open('ooo');
      const dialog = fixture.debugElement.children[0].componentInstance as OutOfOfficeDialogComponent;
      dialog.onDayPicked('to', new Date('2026-10-01T00:00:00.000Z'));
      fixture.detectChanges();
      click('[data-ooo-save]');
      http.expectNone((r) => r.method === 'PATCH');
      expect(q('[data-ooo-order-error]')).not.toBeNull();
    });

    it('11 · Escape on unsaved edits asks first', () => {
      open('ooo');
      click('[data-ooo-clear-all]');
      escape();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(host.visible()).toBe(true);
    });

    it('picking a date swaps the fields for the calendar, and Escape closes the calendar first', () => {
      open('ooo');
      click('[data-ooo-date="to"]');
      expect(q('[data-ooo-dateview]')).not.toBeNull();
      expect(q('[data-ooo-save]')).not.toBeNull(); // same footer
      escape();
      expect(q('[data-ooo-dateview]')).toBeNull();
      expect(host.visible()).toBe(true);
      expect(confirmSpy).not.toHaveBeenCalled();
    });
  });

  // ── Two-step sign-in ────────────────────────────────────────────────────
  describe('Two-step sign-in', () => {
    it('10 · setup sends the password, then the code — and never shows the backup codes', () => {
      open('setup');
      type('#two-step-password', 'typed-in-test');
      click('[data-two-step-continue]');
      expect(auth.setupMfa).toHaveBeenCalledOnceWith('typed-in-test');

      expect(q('[data-two-step-code]')).not.toBeNull();
      expect(q('[data-two-step-secret]')!.textContent).toContain('JBSWY3DPEHPK3PXP');
      expect(document.body.textContent).not.toContain('BACKUP-1111');
      expect(document.body.textContent).not.toContain('BACKUP-2222');

      type('#two-step-code', '123456');
      click('[data-two-step-verify]');
      expect(auth.verifyAndEnableMfa).toHaveBeenCalledOnceWith('123456');
      expect(host.enabled).toBe(true);
      expect(host.visible()).toBe(false);
    });

    it('10 · nothing is sent without a password', () => {
      open('setup');
      click('[data-two-step-continue]');
      expect(auth.setupMfa).not.toHaveBeenCalled();
      expect(document.body.textContent).toContain('Enter your password.');
    });

    it('11 · Escape after typing the password asks first', () => {
      open('setup');
      type('#two-step-password', 'typed-in-test');
      escape();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(host.visible()).toBe(true);
    });

    it('11 · Turn off: Escape after typing the password asks first', () => {
      open('off');
      type('#two-step-off-password', 'typed-in-test');
      escape();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(host.visible()).toBe(true);
    });

    it('Turn off sends the same request the page did, and shows the refusal', () => {
      auth.disableMfa.and.returnValue(throwError(() => ({ error: { message: 'Invalid password' }, status: 401 })));
      open('off');
      type('#two-step-off-password', 'typed-in-test');
      click('[data-two-step-off-confirm]');
      expect(auth.disableMfa).toHaveBeenCalledOnceWith('typed-in-test');
      expect(document.body.textContent).toContain('Invalid password');
      expect(host.visible()).toBe(true);
    });
  });
});
