import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Observable, Subject, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { LookupCategoryDto, LookupService, LookupValueDto } from '../../services/lookup.service';
import { LookupValueListComponent } from './lookup-value-list.component';

// ACC-286 — "Required seat" on the committee seats' values page. A toggle on
// each SHARED seat for lookups:manage, read-only for everyone else, absent on
// an organisation's own seat (its value form sets it). A press sends true or
// false and reads the list again; a refusal is said from its code under the
// row, never in the server's English.

const MANAGE = 'lookups:manage';

const seatCategory = (over: Partial<LookupCategoryDto> = {}): LookupCategoryDto =>
  ({
    id: 'cat-seat',
    key: 'committee_member_role',
    labelEn: 'Committee Member Role',
    labelAr: 'دور عضو اللجنة',
    isSystem: true,
    isExtensible: true,
    isActive: true,
    attributeSchema: { type: 'object', properties: { required: { type: 'boolean', label: 'Required seat' } } },
    ...over,
  }) as LookupCategoryDto;

const seat = (id: string, labelEn: string, labelAr: string, over: Partial<LookupValueDto> = {}): LookupValueDto =>
  ({
    id,
    key: id,
    labelEn,
    labelAr,
    labelOverrideEn: null,
    labelOverrideAr: null,
    layer: 'SYSTEM',
    attributes: null,
    isActive: true,
    isHidden: false,
    sortOrder: 0,
    ...over,
  }) as LookupValueDto;

const CHAIRMAN = seat('chairman', 'Chairman', 'رئيس اللجنة', { attributes: { required: true } });
const MEMBER = seat('member', 'Member', 'عضو');
const OWN = seat('quality_lead', 'Quality Lead', 'قائد الجودة', { layer: 'TENANT', attributes: { required: true } });

describe('LookupValueListComponent — Required seat (ACC-286)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<LookupValueListComponent>;
  let attributeCalls: { id: string; attributes: Record<string, boolean | null> }[];
  let reads: number;

  function render(
    held: string[],
    opts: {
      category?: LookupCategoryDto;
      values?: LookupValueDto[];
      /** What the PATCH answers; success by default. */
      answer?: () => Observable<void>;
      language?: 'en' | 'ar';
    } = {},
  ): HTMLElement {
    attributeCalls = [];
    reads = 0;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LookupValueListComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        providePrimeNG({}),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        {
          provide: LookupService,
          useValue: {
            getCategoryByKey: () => of(opts.category ?? seatCategory()),
            getValues: () => {
              reads++;
              return of(opts.values ?? [CHAIRMAN, MEMBER, OWN]);
            },
            overrideAttributes: (id: string, attributes: Record<string, boolean | null>) => {
              attributeCalls.push({ id, attributes });
              return opts.answer ? opts.answer() : of(undefined);
            },
          },
        },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => held.includes(p) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    const language = opts.language ?? 'en';
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    fixture = TestBed.createComponent(LookupValueListComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const text = (node: Element | null) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const toggleRow = (id: string) => el().querySelector(`[data-required-seat="${id}"]`);
  const switchOf = (id: string) => toggleRow(id)?.querySelector('p-toggleswitch') as HTMLElement | null;
  // What a screen reader hears, and what the switch's look follows.
  const checked = (id: string) => switchOf(id)?.querySelector('input')?.getAttribute('aria-checked') === 'true';
  const press = async (id: string) => {
    switchOf(id)!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const errorOf = (id: string) => el().querySelector(`[data-required-seat-error="${id}"]`);

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  describe('which rows carry it', () => {
    it('every SHARED seat, with lookups:manage, showing the stored value', async () => {
      render([MANAGE]);
      await settle();
      expect(toggleRow('chairman')).withContext('Chairman').not.toBeNull();
      expect(toggleRow('member')).withContext('Member').not.toBeNull();
      expect(checked('chairman')).toBe(true);
      expect(checked('member')).toBe(false);
      expect(text(toggleRow('chairman'))).toBe('Required seat');
      expect(switchOf('chairman')!.querySelector('input')!.getAttribute('aria-label')).toBe('Required seat: Chairman');
    });

    it("never an organisation's OWN seat: its value form sets it", async () => {
      render([MANAGE]);
      await settle();
      expect(toggleRow('quality_lead')).toBeNull();
      expect(el().querySelector('[data-required-seat-readonly="quality_lead"]')).toBeNull();
    });

    it('not on another category, even one with a "required" attribute', async () => {
      render([MANAGE], { category: seatCategory({ key: 'document_type' }) });
      await settle();
      expect(el().querySelector('[data-required-seat]')).toBeNull();
    });

    it('not before the server declares the attribute (no schema, no toggle)', async () => {
      render([MANAGE], { category: seatCategory({ attributeSchema: null }) });
      await settle();
      expect(el().querySelector('[data-required-seat]')).toBeNull();
    });

    it('without lookups:manage: the value read-only, and no switch anywhere', async () => {
      render(['lookups:view']);
      await settle();
      expect(el().querySelector('p-toggleswitch')).toBeNull();
      expect(text(el().querySelector('[data-required-seat-readonly="chairman"]'))).toBe('Required seat');
      expect(text(el().querySelector('[data-required-seat-readonly="member"]'))).toBe('Not a required seat');
    });

    it('says what a required seat means ONCE, above the list, in both languages', async () => {
      render([MANAGE]);
      await settle();
      const hints = () => el().querySelectorAll('[data-required-seat-hint]');
      const count = (needle: string) => text(el()).split(needle).length - 1;
      expect(hints().length).toBe(1);
      expect(text(hints()[0]!)).toBe(en.lookup.attribute.requiredHint);
      expect(count(en.lookup.attribute.requiredHint)).withContext('not repeated under each seat').toBe(1);
      expect(hints()[0]!.closest('app-data-list')).withContext('above the list, not inside a row').toBeNull();

      render([MANAGE], { language: 'ar' });
      await settle();
      expect(hints().length).toBe(1);
      expect(text(hints()[0]!)).toBe(ar.lookup.attribute.requiredHint);
      expect(count(ar.lookup.attribute.requiredHint)).toBe(1);
      expect(text(toggleRow('chairman'))).toBe('مقعد مطلوب');
      expect(switchOf('chairman')!.querySelector('input')!.getAttribute('aria-label')).toBe('مقعد مطلوب: رئيس اللجنة');
    });

    it('the read-only view says it once too', async () => {
      render(['lookups:view']);
      await settle();
      expect(el().querySelectorAll('[data-required-seat-hint]').length).toBe(1);
    });

    it('no hint line on another category', async () => {
      render([MANAGE], { category: seatCategory({ key: 'document_type' }) });
      await settle();
      expect(el().querySelector('[data-required-seat-hint]')).toBeNull();
    });
  });

  describe('a press', () => {
    it('on a required seat sends false, then reads the list again', async () => {
      render([MANAGE]);
      await settle();
      const before = reads;
      await press('chairman');
      expect(attributeCalls).toEqual([{ id: 'chairman', attributes: { required: false } }]);
      expect(reads).withContext('the list is read again').toBe(before + 1);
    });

    it('on a seat that is not required sends true, then reads the list again', async () => {
      render([MANAGE]);
      await settle();
      const before = reads;
      await press('member');
      expect(attributeCalls).toEqual([{ id: 'member', attributes: { required: true } }]);
      expect(reads).toBe(before + 1);
    });

    it('while the save is on its way, the switch shows the press and takes no second one', async () => {
      const answer = new Subject<void>();
      render([MANAGE], { answer: () => answer });
      await settle();
      await press('member');
      expect(checked('member')).withContext('shows the press').toBe(true);
      await press('member');
      expect(attributeCalls.length).withContext('no second save while one is on its way').toBe(1);
      answer.next();
      answer.complete();
      await settle();
      expect(attributeCalls).toEqual([{ id: 'member', attributes: { required: true } }]);
    });

    it('never sends null: "the default" is not offered', async () => {
      render([MANAGE]);
      await settle();
      await press('chairman');
      await press('member');
      expect(attributeCalls.every((c) => c.attributes['required'] !== null)).toBe(true);
      expect(text(el())).not.toMatch(/default/i);
    });
  });

  describe('a refused press', () => {
    const invalid = () =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { code: 'LOOKUP_ATTRIBUTE_INVALID', key: 'required', message: 'Attribute "required" is invalid.' },
          }),
      );

    it('LOOKUP_ATTRIBUTE_INVALID is said from its code under the row, in English', async () => {
      render([MANAGE], { answer: invalid });
      await settle();
      await press('member');
      expect(text(errorOf('member'))).toBe(en.lookup.refusal.attributeInvalid);
      // Its colour (the danger token) is pinned with every other Lookups error line in lookup-error-lines.spec.ts.
      expect(text(el())).not.toContain('is invalid');
      expect(errorOf('chairman')).withContext('only under its own row').toBeNull();
    });

    it('and in Arabic', async () => {
      render([MANAGE], { answer: invalid, language: 'ar' });
      await settle();
      await press('member');
      expect(text(errorOf('member'))).toBe(ar.lookup.refusal.attributeInvalid);
    });

    it('the switch goes back to the stored value once the list is read again', async () => {
      render([MANAGE], { answer: invalid });
      await settle();
      await press('member');
      await settle();
      expect(checked('member')).withContext('the stored value, not the press').toBe(false);
    });

    it('a 404 says the value is gone; anything else is our own sentence, never the server message', async () => {
      render([MANAGE], { answer: () => throwError(() => new HttpErrorResponse({ status: 404 })) });
      await settle();
      await press('member');
      expect(text(errorOf('member'))).toBe(en.lookup.refusal.valueGone);

      render([MANAGE], {
        answer: () => throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Database unavailable' } })),
      });
      await settle();
      await press('member');
      expect(text(errorOf('member'))).toBe(en.lookup.errorRequiredSeat);
      expect(text(el())).not.toContain('Database unavailable');
    });
  });
});
