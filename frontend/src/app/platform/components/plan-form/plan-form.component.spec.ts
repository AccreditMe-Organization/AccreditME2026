import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { PlanFormComponent } from './plan-form.component';
import { IPlan, PlanService } from '../../services/plan.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';

// ACC-263 — Full users and Staff on the plan form: a whole number of 1 or more,
// or Unlimited, which saves null.

function plan(over: Partial<IPlan> = {}): IPlan {
  return {
    id: 'plan-1',
    name: 'STARTER',
    nameEn: 'Starter',
    nameAr: 'المبتدئ',
    monthlyPrice: '0',
    annualPrice: '0',
    maxFullUsers: null,
    maxStaff: null,
    maxStorageGb: 10,
    aiCreditsPerMonth: 0,
    isActive: true,
    isPublic: true,
    sortOrder: 0,
    planModules: [],
    ...over,
  };
}

interface Rendered {
  fixture: ComponentFixture<PlanFormComponent>;
  component: PlanFormComponent;
  el: HTMLElement;
  service: jasmine.SpyObj<PlanService>;
}

async function render(stored: IPlan | null, language: 'en' | 'ar' = 'en'): Promise<Rendered> {
  TestBed.resetTestingModule();
  const service = jasmine.createSpyObj<PlanService>('PlanService', ['getPlanById', 'updatePlan', 'createPlan', 'upsertPlanModule']);
  if (stored) service.getPlanById.and.returnValue(of(stored));
  service.updatePlan.and.callFake((_id, dto) => of(plan(dto)));
  service.createPlan.and.callFake((dto) => of(plan(dto)));
  TestBed.configureTestingModule({
    imports: [PlanFormComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({ lang: 'en' }),
      provideFormatTesting(),
      { provide: PlanService, useValue: service },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(stored ? { id: stored.id } : {}) } } },
    ],
  });
  loadTranslationsForTest({ en, ar });
  TestBed.inject(TranslateService).use(language);
  const fixture = TestBed.createComponent(PlanFormComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, service };
}

const block = (el: HTMLElement, key: 'maxFullUsers' | 'maxStaff') =>
  el.querySelector(`[data-testid="limit-${key}"]`) as HTMLElement;
const numberInput = (el: HTMLElement, key: 'maxFullUsers' | 'maxStaff') =>
  el.querySelector(`input#${key}`) as HTMLInputElement;
const unlimitedBox = (el: HTMLElement, key: 'maxFullUsers' | 'maxStaff') =>
  el.querySelector(`input#${key}Unlimited`) as HTMLInputElement;
const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

function submit(r: Rendered): void {
  r.el.querySelector('form')!.dispatchEvent(new Event('submit'));
  r.fixture.detectChanges();
}
const sentUpdate = (r: Rendered) => r.service.updatePlan.calls.mostRecent().args[1];

describe('PlanFormComponent — seat limits (ACC-263)', () => {
  it('labels both limits, with Unlimited beside each', async () => {
    const r = await render(plan());
    expect(text(block(r.el, 'maxFullUsers'))).toContain('Full users');
    expect(text(block(r.el, 'maxFullUsers'))).toContain('People who sign in and work in the system.');
    expect(text(block(r.el, 'maxStaff'))).toContain('Staff');
    expect(text(block(r.el, 'maxStaff'))).toContain('People who only read and acknowledge documents.');
    expect(text(block(r.el, 'maxFullUsers').querySelector(`label[for="maxFullUsersUnlimited"]`))).toBe('Unlimited — Full users');
  });

  it('reads a stored null as Unlimited, with the number disabled', async () => {
    const r = await render(plan({ maxFullUsers: null, maxStaff: null }));
    expect(r.component.form.controls.fullUsersUnlimited.value).toBeTrue();
    expect(unlimitedBox(r.el, 'maxFullUsers').checked).toBeTrue();
    expect(numberInput(r.el, 'maxFullUsers').disabled).toBeTrue();
    expect(numberInput(r.el, 'maxStaff').disabled).toBeTrue();
    expect(r.component.form.valid).toBeTrue();
  });

  it('reads a stored number as that number, not Unlimited', async () => {
    const r = await render(plan({ maxFullUsers: 15, maxStaff: 250 }));
    expect(r.component.form.controls.fullUsersUnlimited.value).toBeFalse();
    expect(r.component.form.controls.maxFullUsers.value).toBe(15);
    expect(numberInput(r.el, 'maxFullUsers').disabled).toBeFalse();
    expect(numberInput(r.el, 'maxFullUsers').value).toBe('15');
    expect(numberInput(r.el, 'maxStaff').value).toBe('250');
  });

  it('saves a number that is set', async () => {
    const r = await render(plan({ maxFullUsers: 15, maxStaff: 250 }));
    r.component.form.controls.maxFullUsers.setValue(60);
    r.component.form.controls.maxStaff.setValue(1500);
    submit(r);
    expect(r.service.updatePlan).toHaveBeenCalledTimes(1);
    expect(sentUpdate(r).maxFullUsers).toBe(60);
    expect(sentUpdate(r).maxStaff).toBe(1500);
  });

  it('ticking Unlimited saves null, not the number left in the box', async () => {
    const r = await render(plan({ maxFullUsers: 15, maxStaff: 250 }));
    unlimitedBox(r.el, 'maxFullUsers').click();
    r.fixture.detectChanges();
    expect(numberInput(r.el, 'maxFullUsers').disabled).toBeTrue();
    expect(r.component.form.controls.maxFullUsers.value).toBe(15);
    submit(r);
    expect(sentUpdate(r).maxFullUsers).toBeNull();
    expect(sentUpdate(r).maxStaff).toBe(250);

    unlimitedBox(r.el, 'maxStaff').click();
    r.fixture.detectChanges();
    expect(r.component.form.controls.maxStaff.value).toBe(250);
    submit(r);
    expect(sentUpdate(r).maxStaff).toBeNull();
  });

  it('unticking Unlimited asks for a number, then saves it', async () => {
    const r = await render(plan({ maxStaff: null }));
    unlimitedBox(r.el, 'maxStaff').click();
    r.fixture.detectChanges();
    expect(numberInput(r.el, 'maxStaff').disabled).toBeFalse();
    expect(r.component.form.invalid).toBeTrue();
    expect(text(block(r.el, 'maxStaff'))).toContain('Enter a number, or tick Unlimited.');
    submit(r);
    expect(r.service.updatePlan).not.toHaveBeenCalled();

    r.component.form.controls.maxStaff.setValue(1500);
    r.fixture.detectChanges();
    expect(r.component.form.valid).toBeTrue();
    submit(r);
    expect(sentUpdate(r).maxStaff).toBe(1500);
    expect(sentUpdate(r).maxFullUsers).toBeNull();
  });

  it('a new plan starts Unlimited and creates with null limits', async () => {
    const r = await render(null);
    expect(unlimitedBox(r.el, 'maxFullUsers').checked).toBeTrue();
    expect(unlimitedBox(r.el, 'maxStaff').checked).toBeTrue();
    r.component.form.patchValue({ name: 'PRO', nameEn: 'Professional', nameAr: 'الاحترافية' });
    submit(r);
    const dto = r.service.createPlan.calls.mostRecent().args[0];
    expect(dto.maxFullUsers).toBeNull();
    expect(dto.maxStaff).toBeNull();
  });

  describe('validation', () => {
    const cases: [string, number | null, string][] = [
      ['empty', null, 'Enter a number, or tick Unlimited.'],
      ['zero', 0, 'The limit is at least 1.'],
      ['negative', -3, 'The limit is at least 1.'],
      ['a decimal', 1.5, 'Enter a whole number.'],
    ];
    for (const [name, value, message] of cases) {
      it(`refuses ${name}, says why, and does not save`, async () => {
        const r = await render(plan({ maxFullUsers: 15 }));
        r.component.form.controls.maxFullUsers.setValue(value);
        r.fixture.detectChanges();
        expect(r.component.form.controls.maxFullUsers.invalid).toBeTrue();
        expect(text(block(r.el, 'maxFullUsers'))).toContain(message);
        submit(r);
        expect(r.service.updatePlan).not.toHaveBeenCalled();
      });
    }

    it('accepts 1, the smallest limit', async () => {
      const r = await render(plan({ maxFullUsers: 15 }));
      r.component.form.controls.maxFullUsers.setValue(1);
      submit(r);
      expect(sentUpdate(r).maxFullUsers).toBe(1);
    });

    it('a ticked Unlimited is never an error, whatever the number', async () => {
      const r = await render(plan({ maxFullUsers: 15 }));
      r.component.form.controls.maxFullUsers.setValue(0);
      unlimitedBox(r.el, 'maxFullUsers').click();
      r.fixture.detectChanges();
      expect(r.component.form.valid).toBeTrue();
      expect(text(block(r.el, 'maxFullUsers'))).not.toContain('The limit is at least 1.');
    });
  });

  it('speaks Arabic', async () => {
    const r = await render(plan({ maxStaff: null }), 'ar');
    expect(text(block(r.el, 'maxFullUsers'))).toContain('المستخدمون الكاملون');
    expect(text(block(r.el, 'maxStaff'))).toContain('الموظفون');
    expect(text(block(r.el, 'maxStaff'))).toContain('غير محدود');
    unlimitedBox(r.el, 'maxStaff').click();
    r.fixture.detectChanges();
    expect(text(block(r.el, 'maxStaff'))).toContain('أدخل رقمًا، أو اختر «غير محدود».');
  });
});
