import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateService, provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { PositionFormComponent } from './position-form.component';
import { OrgPositionService } from '../../services/org-position.service';
import { RoleService } from '../../../roles/services/role.service';

// ACC-120 slice 6 — Next must not be a dead button.
//
// NEW FILE. Clicking Next with the required English name empty did NOTHING: the
// button was enabled, the step did not advance, the field reported
// aria-invalid="false", and no error element existed anywhere in the dialog. A
// disabled button would at least have signalled; this said nothing at all.
//
// am-field shows an error on blur only once the control is also DIRTY — a
// deliberate rule, because a dialog focuses its first field on open and opening
// a picker blurs it again. `forceShowErrors` is the wrapper's answer for the
// submit moment; this form simply did not pass it.
describe('PositionFormComponent — invalid step 1 (ACC-120)', () => {
  let fixture: ComponentFixture<PositionFormComponent>;
  let component: PositionFormComponent;

  function render(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PositionFormComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: OrgPositionService, useValue: { create: () => of({}), update: () => of({}) } },
        { provide: RoleService, useValue: { listAllRoles: () => of([]) } },
      ],
    });
    fixture = TestBed.createComponent(PositionFormComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
  }

  const el = <T extends HTMLElement>(sel: string): T | null =>
    (fixture.nativeElement as HTMLElement).querySelector<T>(sel);

  it('does not advance while step 1 is invalid', () => {
    render();
    component.next();
    fixture.detectChanges();
    expect(component.step()).toBe(1);
  });

  it('reveals the error rather than failing silently', () => {
    render();
    expect(component.showErrors()).toBe(false);
    component.next();
    fixture.detectChanges();
    expect(component.showErrors()).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('validation.required');
  });

  it('marks the invalid control invalid to assistive technology', () => {
    render();
    component.next();
    fixture.detectChanges();
    expect(el<HTMLInputElement>('#nameEn')?.getAttribute('aria-invalid')).toBe('true');
  });

  // ACC-111's own rule, and the half most easily left out.
  it('moves focus to the first invalid field', () => {
    render();
    el<HTMLInputElement>('#nameAr')?.focus();
    expect(document.activeElement?.id).toBe('nameAr');

    component.next();
    fixture.detectChanges();

    expect(document.activeElement?.id).toBe('nameEn');
  });

  it('advances once step 1 is valid', () => {
    render();
    component.form.patchValue({ nameEn: 'Unit Head', grade: 6 });
    component.next();
    fixture.detectChanges();
    expect(component.step()).toBe(2);
  });

  // Submitting from step 2 with an error left on step 1 must return the reader
  // to where the problem is, not refuse on a step that shows nothing wrong.
  it('returns to step 1 when submit finds it invalid', () => {
    render();
    component.form.patchValue({ nameEn: 'Unit Head', grade: 6 });
    component.next();
    expect(component.step()).toBe(2);

    component.form.patchValue({ nameEn: '' });
    component.onSubmit();
    fixture.detectChanges();

    expect(component.step()).toBe(1);
    expect(component.showErrors()).toBe(true);
  });
});

// ACC-154 — a POSITIONS blocker must be clearable in the app: emptying the role
// sends `roleId: null` (undefined kept the old role), and a deactivated role is
// said from its code, never the server's English.
describe('PositionFormComponent — the position’s role (ACC-154)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<PositionFormComponent>;
  let update: jasmine.Spy;

  const POSITION = {
    id: 'pos-1',
    organizationId: 'org-1',
    nameEn: 'Quality Lead',
    nameAr: null,
    grade: 5,
    isSingleAssignee: false,
    isUnitHeadPosition: false,
    roleId: 'role-1',
    isActive: true,
  };

  function render(lang: 'en' | 'ar', respond: () => Observable<unknown> = () => of(POSITION)): PositionFormComponent {
    TestBed.resetTestingModule();
    update = jasmine.createSpy('update').and.callFake(respond);
    TestBed.configureTestingModule({
      imports: [PositionFormComponent],
      providers: [
        provideTranslateService({ lang: 'en' }),
        { provide: OrgPositionService, useValue: { create: () => of(POSITION), update } },
        { provide: RoleService, useValue: { listAllRoles: () => of([]) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    fixture = TestBed.createComponent(PositionFormComponent);
    fixture.componentRef.setInput('position', POSITION);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('sends roleId null when the role field is emptied, so the server clears it', () => {
    const c = render('en');
    c.form.patchValue({ roleId: null });
    c.onSubmit();
    expect(update).toHaveBeenCalledWith('pos-1', jasmine.objectContaining({ roleId: null }));
  });

  it('keeps sending the role while it is set', () => {
    const c = render('en');
    c.onSubmit();
    expect(update).toHaveBeenCalledWith('pos-1', jasmine.objectContaining({ roleId: 'role-1' }));
  });

  for (const lang of ['en', 'ar'] as const) {
    it(`says ROLE_INACTIVE from its code (${lang})`, () => {
      const refusal = new HttpErrorResponse({ status: 409, error: { code: 'ROLE_INACTIVE', message: 'server text' } });
      const c = render(lang, () => throwError(() => refusal));
      c.onSubmit();
      expect(c.saveError()).toBe(
        lang === 'en'
          ? "This role has been deactivated, so it can't be given out. Reactivate it on Roles, or choose another role."
          : 'تم إلغاء تفعيل هذا الدور، فلا يمكن منحه. يلزم إعادة تفعيله في صفحة الأدوار أو اختيار دور آخر.',
      );
    });
  }
});
