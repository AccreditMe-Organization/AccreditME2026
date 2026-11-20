import { TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { AmConfirmOptions, AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';
import { RoleService } from '../../roles/services/role.service';
import { IUserDto, UserService } from './user.service';
import { UserStatusActionsService } from './user-status-actions.service';

/**
 * ACC-306 — the deactivation confirmation says the person's committee seats end.
 *
 * Since #358 a deactivation ends every committee seat the person holds, inside
 * its own transaction, except on a Dissolved committee, whose roster is kept;
 * a seat never refuses it. The users list's row menu
 * and the user record page both open this ONE confirmation
 * (UserStatusActionsService.confirmDeactivate), so it is tested here, in both
 * languages, from the real translation files.
 */
describe('UserStatusActionsService — the deactivation confirmation names committee seats (ACC-306)', () => {
  const EN_SEATS = 'Any committee seats this person holds end too, except on dissolved committees.';
  const AR_SEATS = 'تنتهي أيضًا مقاعد هذا الحساب في اللجان، عدا اللجان المنحلّة.';
  const user = { id: 'u1', name: 'Huda Al-Harbi', status: 'ACTIVE' } as IUserDto;

  function ask(lang: 'en' | 'ar'): AmConfirmOptions {
    let captured: AmConfirmOptions | null = null;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({ lang }),
        provideFormatTesting(),
        // Captured, not rendered: the dialog's words are what is under test.
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => (captured = o) } },
        { provide: UserService, useValue: { deactivate: () => of({ reassignedCount: 0, unassignedCount: 0 }) } },
        { provide: RoleService, useValue: {} },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(UserStatusActionsService).confirmDeactivate(user, { succeeded: () => {}, failed: () => {} });
    expect(captured).withContext('the confirmation opened').not.toBeNull();
    return captured!;
  }

  it('says it in English, as its own paragraph after the existing text', () => {
    const message = String(ask('en').message);
    // Non-vacuity: the existing confirmation text is there, so the sentence is
    // checked against the real message, not an empty or untranslated one.
    expect(message).toContain("They're signed out at once and can't sign in.");
    expect(message).toContain('they come back with the roles they have now.');
    expect(message.endsWith(`now.\n\n${EN_SEATS}`)).withContext(message).toBeTrue();
    expect(message).not.toContain('{{seats}}');
  });

  it('says it in Arabic, as its own paragraph after the existing text', () => {
    const message = String(ask('ar').message);
    expect(message).toContain('تُنهى جلسات هذا الحساب فورًا');
    expect(message.endsWith(`الآن.\n\n${AR_SEATS}`)).withContext(message).toBeTrue();
    expect(message).not.toContain(EN_SEATS);
    expect(message).not.toContain('{{seats}}');
  });

  it('keeps its header and its action in both languages', () => {
    const english = ask('en');
    expect(english.header).toBe('Deactivate Huda Al-Harbi?');
    expect(english.acceptLabel).toBe(en.user.deactivate);
    const arabic = ask('ar');
    expect(arabic.header).toBe('إلغاء تنشيط Huda Al-Harbi؟');
    expect(arabic.acceptLabel).toBe(ar.user.deactivate);
  });
});
