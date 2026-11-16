import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { LookupCategoryDto, LookupService, LookupValueDto } from './services/lookup.service';
import { LookupValueListComponent } from './components/lookup-value-list/lookup-value-list.component';
import { LookupValueFormComponent } from './components/lookup-value-form/lookup-value-form.component';
import { LookupCategoryListComponent } from './components/lookup-category-list/lookup-category-list.component';
import { lookupRefusalKey } from './lookup-refusal';

// ACC-309 — every error line in the Lookups section is READABLE, in two senses:
//   - its words: a refusal is said from its CODE (lookupRefusalKey(), through the
//     shared refusalCode()), else the action's own translated sentence; NEVER the
//     server's English `message`. A refused Hide used to say "Internal server
//     error" in an Arabic session.
//   - its colour: the danger token (--am-danger-ink, 6.57:1 on white), the field
//     errors' own, never a literal red (red-500 is about 3.8:1). Checked on the
//     RENDERED colour against the token's own value, not on a class name.
//
// The four lines: the values page's own error, the override dialog's, the
// Add/Edit value form's, and the categories page's. The categories page's
// `error` is never set today (the page has no mutations), so its colour is
// pinned by setting it here; no person can reach it.

const SERVER_ENGLISH = 'Internal server error';
const serverError = () => new HttpErrorResponse({ status: 500, error: { statusCode: 500, message: SERVER_ENGLISH, error: 'Internal Server Error' } });
const coded = (code: string, status = 409) => new HttpErrorResponse({ status, error: { statusCode: status, message: `English for ${code}`, code } });

const CATEGORY = {
  id: 'cat-seat',
  key: 'committee_member_role',
  labelEn: 'Committee Member Role',
  labelAr: 'دور عضو اللجنة',
  isSystem: true,
  isExtensible: true,
  isActive: true,
  attributeSchema: null,
} as unknown as LookupCategoryDto;

const CHAIRMAN = {
  id: 'chairman',
  key: 'chairman',
  labelEn: 'Chairman',
  labelAr: 'رئيس اللجنة',
  labelOverrideEn: null,
  labelOverrideAr: null,
  layer: 'SYSTEM',
  attributes: null,
  isActive: true,
  isHidden: false,
  sortOrder: 0,
} as unknown as LookupValueDto;

const OWN = { ...CHAIRMAN, id: 'quality_lead', key: 'quality_lead', labelEn: 'Quality Lead', labelAr: 'قائد الجودة', layer: 'TENANT' } as LookupValueDto;

describe('Lookups error lines are readable (ACC-309)', () => {
  preserveDocumentLanguage();

  const text = (node: Element | null) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

  /** The danger token's own colour, as the browser resolves it. */
  function dangerInk(): string {
    const probe = document.createElement('span');
    probe.style.color = 'var(--am-danger-ink)';
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }

  function expectDangerInk(node: Element | null, what: string): void {
    expect(node).withContext(`${what} is on screen`).not.toBeNull();
    const expected = dangerInk();
    // Non-vacuity: the token resolves to a real colour, not the default black.
    expect(expected).withContext('--am-danger-ink resolves').not.toBe(getComputedStyle(document.body).color);
    expect(getComputedStyle(node!).color).withContext(`${what}: the danger token`).toBe(expected);
  }

  function base(lang: 'en' | 'ar', lookupService: Partial<Record<keyof LookupService, unknown>>, confirm?: { accept: (() => void) | null }) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        providePrimeNG({}),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        {
          provide: ConfirmationService,
          useValue: confirm
            ? {
                confirm: (opt: { accept: () => void }) => {
                  confirm.accept = opt.accept;
                },
              }
            : new ConfirmationService(),
        },
        { provide: LookupService, useValue: lookupService },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
  }

  async function settle<T>(fixture: ComponentFixture<T>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  describe('lookupRefusalKey()', () => {
    it('a known code says its own sentence', () => {
      expect(lookupRefusalKey(coded('LOOKUP_ATTRIBUTE_INVALID', 400), 'lookup.errorHide')).toBe('lookup.refusal.attributeInvalid');
      expect(lookupRefusalKey(coded('RATE_LIMITED', 429), 'lookup.errorHide')).toBe('lookup.refusal.rateLimited');
    });

    it("anything else says the action's own sentence, whatever message the server sent", () => {
      expect(lookupRefusalKey(serverError(), 'lookup.errorHide')).toBe('lookup.errorHide');
      expect(lookupRefusalKey(coded('SOMETHING_NEW'), 'lookup.errorDelete')).toBe('lookup.errorDelete');
      expect(lookupRefusalKey(new Error('offline'), 'lookup.errorOverride')).toBe('lookup.errorOverride');
    });
  });

  describe('the values page', () => {
    function renderValues(lang: 'en' | 'ar', fail: () => Observable<void>, confirm?: { accept: (() => void) | null }) {
      base(
        lang,
        {
          getCategoryByKey: () => of(CATEGORY),
          getValues: () => of([CHAIRMAN, OWN]),
          hideSystemValue: fail,
          unhideSystemValue: fail,
          removeValue: fail,
          overrideLabel: fail,
        },
        confirm,
      );
      const fixture = TestBed.createComponent(LookupValueListComponent);
      document.body.appendChild(fixture.nativeElement);
      return fixture;
    }

    it('a refused Hide, a 500 with an English message, says the Arabic sentence in an Arabic session', async () => {
      const fixture = renderValues('ar', () => throwError(serverError));
      await settle(fixture);
      fixture.componentInstance.onHide(CHAIRMAN);
      await settle(fixture);
      const line = (fixture.nativeElement as HTMLElement).querySelector('[data-lookup-error]');
      expect(text(line)).toBe(ar.lookup.errorHide);
      expect(text(fixture.nativeElement)).not.toContain(SERVER_ENGLISH);
      expectDangerInk(line, "the page's error");
      fixture.nativeElement.remove();
    });

    it('Unhide and Delete say their own sentences too, never the server message', async () => {
      const unhide = renderValues('ar', () => throwError(serverError));
      await settle(unhide);
      unhide.componentInstance.onUnhide(CHAIRMAN);
      await settle(unhide);
      expect(text((unhide.nativeElement as HTMLElement).querySelector('[data-lookup-error]'))).toBe(ar.lookup.errorUnhide);
      unhide.nativeElement.remove();

      const confirm = { accept: null as (() => void) | null };
      const del = renderValues('ar', () => throwError(serverError), confirm);
      await settle(del);
      del.componentInstance.onDelete(OWN);
      confirm.accept!();
      await settle(del);
      expect(text((del.nativeElement as HTMLElement).querySelector('[data-lookup-error]'))).toBe(ar.lookup.errorDelete);
      expect(text(del.nativeElement)).not.toContain(SERVER_ENGLISH);
      del.nativeElement.remove();
    });

    it('a rate-limited Hide says so, from its code', async () => {
      const fixture = renderValues('en', () => throwError(() => coded('RATE_LIMITED', 429)));
      await settle(fixture);
      fixture.componentInstance.onHide(CHAIRMAN);
      await settle(fixture);
      expect(text((fixture.nativeElement as HTMLElement).querySelector('[data-lookup-error]'))).toBe(en.lookup.refusal.rateLimited);
      fixture.nativeElement.remove();
    });

    it('the error follows a language switch (a key, translated at render)', async () => {
      const fixture = renderValues('en', () => throwError(serverError));
      await settle(fixture);
      fixture.componentInstance.onHide(CHAIRMAN);
      await settle(fixture);
      const line = () => (fixture.nativeElement as HTMLElement).querySelector('[data-lookup-error]');
      expect(text(line())).toBe(en.lookup.errorHide);
      TestBed.inject(TranslateService).use('ar');
      await settle(fixture);
      expect(text(line())).toBe(ar.lookup.errorHide);
      fixture.nativeElement.remove();
    });

    it("the override dialog's error: its own sentence, in the danger token", async () => {
      const fixture = renderValues('ar', () => throwError(serverError));
      await settle(fixture);
      fixture.componentInstance.openOverride(CHAIRMAN);
      await settle(fixture);
      fixture.componentInstance.onSaveOverride();
      await settle(fixture);
      const line = document.querySelector('[data-override-error]');
      expect(text(line)).toBe(ar.lookup.errorOverride);
      expect(text(document.body)).not.toContain(SERVER_ENGLISH);
      expectDangerInk(line, "the override dialog's error");
      fixture.nativeElement.remove();
      document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    });
  });

  describe('the Add/Edit value form', () => {
    function renderForm(lang: 'en' | 'ar', fail: () => Observable<LookupValueDto>) {
      base(lang, { getCategoryByKey: () => of(CATEGORY), addValue: fail, updateValue: fail });
      const fixture = TestBed.createComponent(LookupValueFormComponent);
      fixture.componentInstance.categoryKey = 'committee_member_role';
      fixture.componentInstance.value = null;
      document.body.appendChild(fixture.nativeElement);
      return fixture;
    }

    async function submit(fixture: ComponentFixture<LookupValueFormComponent>) {
      await settle(fixture);
      fixture.componentInstance.form.patchValue({ key: 'quality_lead', labelEn: 'Quality Lead' });
      fixture.componentInstance.onSubmit();
      await settle(fixture);
      return (fixture.nativeElement as HTMLElement).querySelector('[data-value-form-error]');
    }

    it('a 500 with an English message says the Arabic sentence in an Arabic session, in the danger token', async () => {
      const fixture = renderForm('ar', () => throwError(serverError));
      const line = await submit(fixture);
      expect(text(line)).toBe(ar.lookup.errorSaveValue);
      expect(text(fixture.nativeElement)).not.toContain(SERVER_ENGLISH);
      expectDangerInk(line, "the value form's error");
      fixture.nativeElement.remove();
    });

    it('LOOKUP_ATTRIBUTE_INVALID is said from its code', async () => {
      const fixture = renderForm('en', () => throwError(() => coded('LOOKUP_ATTRIBUTE_INVALID', 400)));
      const line = await submit(fixture);
      expect(text(line)).toBe(en.lookup.refusal.attributeInvalid);
      fixture.nativeElement.remove();
    });
  });

  describe('the categories page', () => {
    it('its error line uses the danger token (set directly: nothing on the page sets it today)', async () => {
      base('en', { getCategories: () => of([CATEGORY]) });
      const fixture = TestBed.createComponent(LookupCategoryListComponent);
      document.body.appendChild(fixture.nativeElement);
      await settle(fixture);
      fixture.componentInstance.error.set('Something went wrong.');
      await settle(fixture);
      expectDangerInk((fixture.nativeElement as HTMLElement).querySelector('[data-category-error]'), "the categories page's error");
      fixture.nativeElement.remove();
    });
  });
});
