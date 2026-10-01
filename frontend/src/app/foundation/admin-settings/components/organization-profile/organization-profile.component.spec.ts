import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { OrganizationProfileComponent } from './organization-profile.component';
import { TenantService } from '../../../tenant/services/tenant.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

// ACC-123 — the page is gated on tenant:view, but SAVING is PATCH /tenant, which
// enforces tenant:update (tenant.controller.ts). Two different permissions, and
// nothing in the component knew it: a holder of tenant:view alone got the whole
// form, editable, with a live Save the server would have refused.
//
// Found by standing on it as READ_ONLY_ADMIN. The scan could not see it — a
// Save is not in WRITE_ICONS and is not a create action, so neither
// check:action-gating nor check:create-gating looks at it.
describe('OrganizationProfileComponent read-only gating (ACC-123)', () => {
  function render(held: string[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [OrganizationProfileComponent],
      providers: [
        provideTranslateService({ lang: 'en' }),
        {
          provide: TenantService,
          useValue: {
            getCurrent: () =>
              of({ name: 'Al Nakheel Specialist Hospital', country: 'SA', logo: null }),
            update: jasmine.createSpy('update').and.returnValue(of({})),
          },
        },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => held.includes(p) },
        },
      ],
    });
    const fixture = TestBed.createComponent(OrganizationProfileComponent);
    fixture.detectChanges();
    return fixture;
  }

  const inputs = (f: ReturnType<typeof render>): HTMLInputElement[] =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll('input'));

  const buttons = (f: ReturnType<typeof render>): string[] =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );

  describe('with tenant:view only', () => {
    it('disables every field', () => {
      expect(inputs(render(['tenant:view'])).filter((i) => !i.disabled)).toEqual([]);
    });

    it('does not render Save', () => {
      expect(buttons(render(['tenant:view']))).not.toContain('common.save');
    });

    it('says what is missing rather than leaving the absence unexplained', () => {
      const text = (render(['tenant:view']).nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('adminSettings.profileReadOnly');
    });

    // The form still LOADS: an inspector is here to read the organisation's
    // details, so a blank disabled form would be worse than no page.
    it('still shows the organization it loaded', () => {
      expect(inputs(render(['tenant:view']))[0]!.value).toBe(
        'Al Nakheel Specialist Hospital',
      );
    });

    // getRawValue() reads disabled controls, and a disabled control is excluded
    // from validation, so form.invalid is FALSE on a read-only form. Neither the
    // disabled state nor the existing invalid check stops a submit — only the
    // explicit guard does. Mutation-tested: removing it fails this.
    it('sends nothing if onSubmit is reached anyway', () => {
      const fixture = render(['tenant:view']);
      const tenant = TestBed.inject(TenantService);
      fixture.componentInstance.onSubmit();
      expect(tenant.update).not.toHaveBeenCalled();
      expect(fixture.componentInstance.saving()).toBe(false);
    });
  });

  describe('with tenant:update', () => {
    const HELD = ['tenant:view', 'tenant:update'];

    it('leaves every field editable', () => {
      expect(inputs(render(HELD)).filter((i) => i.disabled)).toEqual([]);
    });

    it('renders Save, so the gate did not remove the control for everyone', () => {
      expect(buttons(render(HELD))).toContain('common.save');
    });

    it('shows no read-only notice', () => {
      const text = (render(HELD).nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('adminSettings.profileReadOnly');
    });

    it('saves', () => {
      const fixture = render(HELD);
      const tenant = TestBed.inject(TenantService);
      fixture.componentInstance.onSubmit();
      expect(tenant.update).toHaveBeenCalled();
    });
  });
});
