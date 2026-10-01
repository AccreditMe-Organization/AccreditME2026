import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { of } from 'rxjs';
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
