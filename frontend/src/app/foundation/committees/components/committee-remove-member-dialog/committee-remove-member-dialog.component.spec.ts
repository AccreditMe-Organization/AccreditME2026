import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeRemoveMemberDialogComponent, RemoveMemberTarget } from './committee-remove-member-dialog.component';

// ACC-298 (Ahmad, 11 Nov): "removal from committee requires a reason." The
// dialog asks for it, names the person, keeps ACC-240's consequence line, and
// sends { reason }. Read from the REAL translation files.

const URL = `${environment.apiUrl}/committees/c-1/members/m-1`;
const TARGET: RemoveMemberTarget = { memberId: 'm-1', name: 'Sara Al-Mutairi' };

@Component({
  standalone: true,
  imports: [CommitteeRemoveMemberDialogComponent],
  template: `
    <app-committee-remove-member-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      committeeId="c-1"
      [target]="target"
      (removed)="removedCount = removedCount + 1"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly target = TARGET;
  removedCount = 0;
}

describe('CommitteeRemoveMemberDialogComponent (ACC-298)', () => {
  preserveDocumentLanguage();
  let http: HttpTestingController;
  let fixture: ComponentFixture<HostComponent>;
  let dialog: CommitteeRemoveMemberDialogComponent;

  function setup(language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    dialog = fixture.debugElement.query(By.directive(CommitteeRemoveMemberDialogComponent))
      .componentInstance as CommitteeRemoveMemberDialogComponent;
  }

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    TestBed.resetTestingModule();
  });

  const textarea = () => document.querySelector<HTMLTextAreaElement>('#committeeRemoveMemberReason')!;
  const type = (value: string) => {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const fieldError = () => document.querySelector('.am-field__message--error')?.textContent?.trim() ?? null;
  const removeButton = () => document.querySelector<HTMLButtonElement>('[data-testid="remove-member-submit"] button')!;
  const header = () => document.querySelector('.p-dialog-title, .am-dialog__title, [data-pc-section="title"]')?.textContent?.trim();

  it('English: the title names the person, and the consequence line is kept', () => {
    setup('en');
    expect(header()).toBe('Remove Sara Al-Mutairi from this committee?');
    expect(document.querySelector('[data-testid="remove-member-consequence"]')?.textContent?.trim()).toBe(
      "Their membership ends today and stays in the committee's history.",
    );
    expect(document.body.textContent).toContain('Reason for removing');
    expect(document.body.textContent).toContain("Kept in the committee's membership history.");
  });

  it('Arabic: the same, in Arabic, with the name as stored', () => {
    setup('ar');
    expect(header()).toBe('إزالة Sara Al-Mutairi من هذه اللجنة؟');
    expect(document.querySelector('[data-testid="remove-member-consequence"]')?.textContent?.trim()).toBe(
      'تنتهي العضوية اليوم وتبقى في سجل اللجنة.',
    );
    expect(document.body.textContent).toContain('سبب الإزالة');
  });

  it('Remove is never disabled', () => {
    setup();
    expect(removeButton().disabled).toBeFalse();
  });

  it('an empty reason reveals the error, moves focus to the field, and sends nothing', () => {
    setup();
    expect(fieldError()).withContext('no error before Remove is pressed').toBeNull();
    // A real press puts focus on the button; start there, so the move is the dialog's.
    removeButton().focus();
    expect(document.activeElement).withContext('focus starts on Remove').toBe(removeButton());
    removeButton().click();
    fixture.detectChanges();
    expect(fieldError()).toBe('Give a reason for removing.');
    expect(document.activeElement).withContext('focus moved to the reason').toBe(textarea());
    http.expectNone(URL);
    expect(fixture.componentInstance.removedCount).toBe(0);
  });

  it('a reason that is only whitespace is refused the same way', () => {
    setup();
    type('   \n  ');
    removeButton().focus();
    removeButton().click();
    fixture.detectChanges();
    expect(fieldError()).toBe('Give a reason for removing.');
    expect(document.activeElement).toBe(textarea());
    http.expectNone(URL);
  });

  it('Arabic: the error is said in Arabic', () => {
    setup('ar');
    removeButton().click();
    fixture.detectChanges();
    expect(fieldError()).toBe('سبب الإزالة مطلوب.');
  });

  it('sends { reason }, trimmed, then tells the page and closes', () => {
    setup();
    type('  Moved to the Pharmacy committee  ');
    removeButton().click();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ reason: 'Moved to the Pharmacy committee' });
    req.flush(null);
    fixture.detectChanges();
    expect(fixture.componentInstance.removedCount).toBe(1);
    expect(fixture.componentInstance.visible()).toBeFalse();
  });

  it("a stage refusal is said from its code, naming the stage, and the dialog stays open with the reason", () => {
    setup();
    type('Left the hospital');
    removeButton().click();
    http
      .expectOne(URL)
      .flush(
        { code: 'STAGE_ACTION_NOT_ALLOWED', action: 'remove_member', stageNameEn: 'Dissolved', stageNameAr: 'منحلّة', message: 'English only' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="committee-stage-refusal"]')?.textContent?.trim()).toBe(
      "Members can't be changed while the committee is Dissolved.",
    );
    expect(document.body.textContent).not.toContain('English only');
    expect(fixture.componentInstance.visible()).toBeTrue();
    expect(textarea().value).toBe('Left the hospital');
    expect(fixture.componentInstance.removedCount).toBe(0);
    expect(dialog.saving()).toBeFalse();
  });

  // ACC-286 — removing the last holder of a required seat of a committee in
  // force: said from its code, naming the seat in the reader's language.
  for (const [lang, sentence] of [
    ['en', 'Appoint another Chairman first.'],
    ['ar', 'يلزم تعيين عضو في مقعد «رئيس اللجنة» أولاً.'],
  ] as const) {
    it(`the last holder of a required seat is said from its code, naming the seat (${lang}), and the dialog stays open`, () => {
      setup(lang);
      type('Moving on');
      removeButton().click();
      http.expectOne(URL).flush(
        {
          code: 'COMMITTEE_REQUIRED_SEAT_LAST_HOLDER',
          seat: { id: 'seat-chair', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
          message: 'English only',
        },
        { status: 409, statusText: 'Conflict' },
      );
      fixture.detectChanges();
      expect(document.querySelector('[data-testid="committee-seat-refusal"]')?.textContent?.trim()).toBe(sentence);
      expect(document.querySelector('[data-testid="committee-stage-refusal"]')).toBeNull();
      expect(document.body.textContent).not.toContain('English only');
      expect(fixture.componentInstance.visible()).toBeTrue();
      expect(fixture.componentInstance.removedCount).toBe(0);
    });
  }

  it('any other error is said through extractErrorMessage', () => {
    setup();
    type('Left the hospital');
    removeButton().click();
    http.expectOne(URL).flush({ statusCode: 404, message: 'Active committee member not found' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="committee-stage-refusal"]')).toBeNull();
    expect(document.querySelector('[data-testid="remove-member-error"]')?.textContent?.trim()).toBe('Active committee member not found');
    expect(fixture.componentInstance.visible()).toBeTrue();
  });

  it('opening again starts clean: no reason, no error', () => {
    setup();
    type('Typed for someone else');
    removeButton().click();
    http.expectOne(URL).flush(null);
    fixture.detectChanges();
    expect(fixture.componentInstance.visible()).withContext('closed after the removal').toBeFalse();
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();
    expect(textarea().value).toBe('');
    expect(fieldError()).toBeNull();
  });
});
