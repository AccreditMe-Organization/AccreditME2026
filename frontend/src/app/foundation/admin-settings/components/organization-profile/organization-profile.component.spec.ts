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
  let update: jasmine.Spy;

  function render(held: string[], tenant: Record<string, unknown> = {}) {
    update = jasmine.createSpy('update').and.returnValue(of({}));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [OrganizationProfileComponent],
      providers: [
        provideTranslateService({ lang: 'en' }),
        {
          provide: TenantService,
          useValue: {
            // ACC-120 — `country` is no longer part of this screen's shape, so
            // the stub no longer supplies it. nameAr is null, which is what
            // every tenant actually has.
            getCurrent: () =>
              of({
                name: 'Al Nakheel Specialist Hospital',
                nameAr: null,
                logo: null,
                ...tenant,
              }),
            update,
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

// ── ACC-120: the name pair, and the save that used to 400 ────────────────────
describe('OrganizationProfileComponent — the organisation name pair (ACC-120)', () => {
  let update: jasmine.Spy;

  function render(tenant: Record<string, unknown> = {}) {
    update = jasmine.createSpy('update').and.returnValue(of({}));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [OrganizationProfileComponent],
      providers: [
        provideTranslateService({ lang: 'en' }),
        {
          provide: TenantService,
          useValue: {
            getCurrent: () =>
              of({
                name: 'Al Nakheel Specialist Hospital',
                nameAr: null,
                logo: null,
                ...tenant,
              }),
            update,
          },
        },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: () => true },
        },
      ],
    });
    const fixture = TestBed.createComponent(OrganizationProfileComponent);
    fixture.detectChanges();
    return fixture;
  }

  const control = (f: ReturnType<typeof render>, id: string): HTMLInputElement =>
    (f.nativeElement as HTMLElement).querySelector<HTMLInputElement>(`#${id}`)!;

  it('renders both halves of the pair', () => {
    const fixture = render();
    expect(control(fixture, 'name')).toBeTruthy();
    expect(control(fixture, 'nameAr')).toBeTruthy();
  });

  // THE PRODUCT RULE. Arabic fields are never mandatory, because the product is
  // sold to customers who do not operate in Arabic — which is why every other
  // nameAr column in the schema is nullable too. A sibling of the English name,
  // not a condition on it.
  it('does NOT require the Arabic name, while the English one IS required', () => {
    const fixture = render();
    const form = fixture.componentInstance.form;

    form.controls.name.setValue('');
    form.controls.nameAr.setValue('');
    expect(form.controls.nameAr.valid).withContext('Arabic name is optional').toBe(true);
    expect(form.controls.name.valid).withContext('English name is required').toBe(false);
  });

  it('writes the Arabic name right-to-left', () => {
    expect(control(render(), 'nameAr').getAttribute('dir')).toBe('rtl');
  });

  it('refuses an Arabic name longer than the column allows', () => {
    const fixture = render();
    fixture.componentInstance.form.controls.nameAr.setValue('ا'.repeat(256));
    expect(fixture.componentInstance.form.controls.nameAr.valid).toBe(false);
  });

  it('loads an existing Arabic name into the field', () => {
    const fixture = render({ nameAr: 'مستشفى النخيل التخصصي' });
    expect(control(fixture, 'nameAr').value).toBe('مستشفى النخيل التخصصي');
  });

  // THE LIVE BUG THIS SLICE FIXES. The component sent `country`,
  // UpdateTenantDto never declared it, and main.ts runs ValidationPipe with
  // forbidNonWhitelisted — so the backend refused the whole request and EVERY
  // save failed. Asserted on the payload rather than on a status code, because
  // the status code is not reachable from a unit test and the payload is the
  // thing that was wrong.
  it('does not send country, which is what made every save fail', () => {
    const fixture = render();
    fixture.componentInstance.form.controls.name.setValue('Renamed');

    fixture.componentInstance.onSubmit();

    expect(update).toHaveBeenCalled();
    const payload = update.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['nameAr', 'name'].sort());
    expect('country' in payload).toBe(false);
  });

  it('sends the Arabic name when one is typed', () => {
    const fixture = render();
    fixture.componentInstance.form.controls.name.setValue('Al Nakheel');
    fixture.componentInstance.form.controls.nameAr.setValue('النخيل');

    fixture.componentInstance.onSubmit();

    expect(update.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ nameAr: 'النخيل' }),
    );
  });

  // The S3-key text box asked an administrator to type a storage path. It is
  // replaced by what is true today: a monogram, and a note that upload is not
  // live. No dropzone, because there is no upload endpoint, bucket or signed
  // URL anywhere in the product.
  it('has no S3-key box, and no logo field at all', () => {
    const fixture = render();
    const inputs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('input'),
    );
    expect(inputs.map((i) => i.id).sort()).toEqual(['name', 'nameAr']);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('S3 key');
  });

  it('shows the monogram at the three sizes a logo would appear at', () => {
    const fixture = render();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // "Al Nakheel Specialist Hospital" -> AN: the first letter of each of the
    // first TWO WORDS, not the first two letters of the first word. My first
    // version of this expectation said 'AL' and the code was right.
    expect(fixture.componentInstance.monogram()).toBe('AN');
    expect(text).toContain('adminSettings.logoWhereSignIn');
    expect(text).toContain('adminSettings.logoWhereSidebar');
    expect(text).toContain('adminSettings.logoWhereReport');
  });

  // The drawing's own example, so the rule is pinned against the artboard
  // rather than against one fixture.
  it('matches the drawing: King Fahad Medical City gives KF', () => {
    expect(render({ name: 'King Fahad Medical City' }).componentInstance.monogram()).toBe('KF');
  });

  it('falls back to a dash rather than an empty square', () => {
    expect(render({ name: '   ' }).componentInstance.monogram()).toBe('—');
  });

  it('says upload is not live rather than offering an upload that is not', () => {
    const text = (render().nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('adminSettings.logoNotActiveYet');
  });
});
