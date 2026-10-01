import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { LookupValueListComponent } from './lookup-value-list.component';
import { LookupService, LookupCategoryDto, LookupValueDto } from '../../services/lookup.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

// ACC-120 slice 6 — the lookup values screen.
//
// This file is NEW. The screen had no spec at all before the migration, so
// nothing was proving its permission gating, its tag labels or — the one that
// matters most — that deleting a value asks first.
const category = (over: Partial<LookupCategoryDto> = {}): LookupCategoryDto =>
  ({
    key: 'document_type',
    labelEn: 'Document Type',
    labelAr: 'نوع الوثيقة',
    isSystem: true,
    isExtensible: true,
    isActive: true,
    ...over,
  }) as LookupCategoryDto;

const value = (over: Partial<LookupValueDto> = {}): LookupValueDto =>
  ({
    id: 'v1',
    key: 'policy',
    labelEn: 'Policy',
    labelAr: 'سياسة',
    labelOverrideEn: null,
    labelOverrideAr: null,
    layer: 'TENANT',
    isActive: true,
    isHidden: false,
    sortOrder: 0,
    ...over,
  }) as LookupValueDto;

describe('LookupValueListComponent (ACC-120)', () => {
  let fixture: ComponentFixture<LookupValueListComponent>;
  let component: LookupValueListComponent;
  let removeValue: jasmine.Spy;
  let confirmed: (() => void) | null;

  function render(held: string[], opts: { values?: LookupValueDto[]; category?: LookupCategoryDto } = {}) {
    confirmed = null;
    removeValue = jasmine.createSpy('removeValue').and.returnValue(of(undefined));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LookupValueListComponent],
      providers: [
        // app-data-list syncs its state to the URL, so it needs the real router
        // pieces. The real ActivatedRoute carries no :key here, which is fine:
        // the LookupService stub ignores the category key, and overriding
        // ActivatedRoute to supply one is a circular dependency on itself.
        provideRouter([]),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        {
          provide: ConfirmationService,
          // Captures the accept callback instead of running it, so a test can
          // assert that the dialog was raised AND that nothing happened until
          // it was accepted.
          useValue: {
            confirm: (opt: { accept: () => void }) => {
              confirmed = opt.accept;
            },
          },
        },
        {
          provide: LookupService,
          useValue: {
            getCategoryByKey: () => of(opts.category ?? category()),
            getValues: () => of(opts.values ?? [value()]),
            removeValue,
            hideSystemValue: () => of(undefined),
            unhideSystemValue: () => of(undefined),
            overrideLabel: () => of(undefined),
          },
        },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => held.includes(p) },
        },
      ],
    });
    fixture = TestBed.createComponent(LookupValueListComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
    return fixture;
  }

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const labels = (): string[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).map((b) =>
      (b.getAttribute('aria-label') ?? '').trim(),
    );

  // ── the tag CLAUDE.md recorded ────────────────────────────────────────────
  describe('the extensible tag beside the title', () => {
    it('names itself rather than reading a bare "Yes"', () => {
      render(['lookups:manage']);
      expect(text()).toContain('lookup.extensibleTag');
      // The old key said only "Yes", which has no column here to explain it.
      expect(text()).not.toContain('lookup.extensibleYes');
    });

    it('names the negative case too', () => {
      render(['lookups:manage'], { category: category({ isExtensible: false }) });
      expect(text()).toContain('lookup.notExtensibleTag');
    });
  });

  // ── delete asks ───────────────────────────────────────────────────────────
  describe('deleting a value', () => {
    it('raises a confirmation instead of deleting straight away', () => {
      render(['lookups:manage']);
      component.onDelete(value());
      expect(confirmed).not.toBeNull();
      expect(removeValue).not.toHaveBeenCalled();
    });

    it('deletes once the confirmation is accepted', () => {
      render(['lookups:manage']);
      component.onDelete(value());
      confirmed!();
      expect(removeValue).toHaveBeenCalledWith('v1');
    });
  });

  // ── permissions ───────────────────────────────────────────────────────────
  describe('with lookups:manage', () => {
    it('offers the row actions, named after the value', () => {
      render(['lookups:manage']);
      expect(labels().some((l) => l.startsWith('lookup.editFor'))).toBe(true);
      expect(labels().some((l) => l.startsWith('lookup.deleteFor'))).toBe(true);
    });

    it('offers Add Value on an extensible category', () => {
      render(['lookups:manage']);
      expect(text()).toContain('lookup.addValue');
    });

    it('offers no Add Value on a category that cannot be extended', () => {
      render(['lookups:manage'], { category: category({ isExtensible: false }) });
      expect(text()).not.toContain('lookup.addValue');
    });
  });

  describe('with lookups:view only', () => {
    // Proved in a browser against READ_ONLY_ADMIN, who gets no write control on
    // this screen at all; pinned here so the next change cannot drop it.
    it('offers no row actions', () => {
      render(['lookups:view']);
      expect(labels().filter((l) => l.startsWith('lookup.'))).toEqual([]);
    });

    it('offers no Add Value', () => {
      render(['lookups:view']);
      expect(text()).not.toContain('lookup.addValue');
    });

    it('still lists the values, which is what the screen is for', () => {
      render(['lookups:view']);
      expect(component.values().length).toBe(1);
    });
  });

  // ── a SYSTEM value cannot be edited or deleted, only hidden ───────────────
  it('offers hide but not delete on a SYSTEM value', () => {
    render(['lookups:manage'], { values: [value({ layer: 'SYSTEM' })] });
    expect(labels().some((l) => l.startsWith('lookup.hideFor'))).toBe(true);
    expect(labels().some((l) => l.startsWith('lookup.deleteFor'))).toBe(false);
  });
});
