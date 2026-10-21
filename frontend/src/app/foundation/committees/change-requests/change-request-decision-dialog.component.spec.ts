import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { ChangeRequestDecision, ChangeRequestDecisionDialogComponent } from './change-request-decision-dialog.component';
import { ChangeRequestDto, ChangeRequestService } from './change-request.service';
import { REQUEST } from './change-request.testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';

@Component({
  standalone: true,
  imports: [ChangeRequestDecisionDialogComponent],
  template: `<am-change-request-decision-dialog [kind]="kind()" [request]="request" [visible]="open()" (visibleChange)="open.set($event)" (decided)="decided = $event" />`,
})
class Host {
  readonly kind = signal<ChangeRequestDecision>('return');
  readonly open = signal(true);
  readonly request = REQUEST();
  decided: ChangeRequestDto | null = null;
}

const REFUSALS = [
  'CHANGE_REQUEST_NOT_UNDER_REVIEW',
  'CHANGE_REQUEST_OWN_DECISION',
  'CHANGE_REQUEST_NOT_ALLOWED',
  'CHANGE_REQUEST_NOT_OPEN',
  'CHANGE_REQUEST_COMMITTEE_DISSOLVING',
] as const;

// ACC-240 — Return for changes and Reject (plan §3.4).
describe('ChangeRequestDecisionDialogComponent (ACC-240)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<Host>;
  let answer: () => Observable<ChangeRequestDto>;
  let returned: jasmine.Spy;
  let rejected: jasmine.Spy;

  beforeEach(() => {
    answer = () => of(REQUEST({ status: 'returned' }));
    returned = jasmine.createSpy('return').and.callFake(() => answer());
    rejected = jasmine.createSpy('reject').and.callFake(() => answer());
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: ChangeRequestService, useValue: { returnForChanges: returned, reject: rejected } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
  });

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  async function render(kind: ChangeRequestDecision): Promise<HTMLElement> {
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.kind.set(kind);
    fixture.detectChanges();
    for (let i = 0; i < 50 && !document.querySelector('[data-crd-body]'); i++) {
      await new Promise((r) => setTimeout(r, 20));
      fixture.detectChanges();
    }
    return document.querySelector('.p-dialog') as HTMLElement;
  }

  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const action = () => document.querySelector<HTMLButtonElement>('[data-testid="crd-decide"] button')!;
  const type = (value: string) => {
    const area = document.querySelector<HTMLTextAreaElement>('#crd-note')!;
    area.value = value;
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  it('Return: its header, context, sentence and button', async () => {
    const d = await render('return');
    expect(text(d.querySelector('.am-dialog__title, .p-dialog-title'))).toContain('Return for changes');
    expect(text(d)).toContain('Change request 3 · back to Nora Al-Otaibi as a draft');
    expect(text(d.querySelector('.am-crd__sentence'))).toBe('Nora Al-Otaibi can edit and resubmit it.');
    expect(text(action())).toBe('Return');
  });

  it('Reject: its header, and the action is the danger one', async () => {
    const d = await render('reject');
    expect(text(d)).toContain('Reject change request 3');
    expect(text(d)).toContain('Nothing is changed');
    expect(action().classList).toContain('p-button-danger');
  });

  for (const kind of ['return', 'reject'] as const) {
    it(`${kind}: never disabled; pressed empty, the slot says what is missing and nothing is sent`, async () => {
      await render(kind);
      expect(action().disabled).toBeFalse();
      type('   ');
      action().click();
      fixture.detectChanges();
      expect(text(document.querySelector('[data-crd-body] .am-field__message'))).toBe(
        kind === 'return' ? 'Say what needs changing.' : 'Say why it is rejected.',
      );
      expect(returned).not.toHaveBeenCalled();
      expect(rejected).not.toHaveBeenCalled();
    });
  }

  it('Return sends the trimmed note, then closes and hands the moved request back', async () => {
    await render('return');
    type('  Name the two new members.  ');
    action().click();
    fixture.detectChanges();
    expect(returned).toHaveBeenCalledWith('cr-1', 'Name the two new members.');
    expect(fixture.componentInstance.decided?.status).toBe('returned');
    expect(fixture.componentInstance.open()).toBeFalse();
  });

  it('Reject sends the reason', async () => {
    await render('reject');
    type('Not this year.');
    action().click();
    expect(rejected).toHaveBeenCalledWith('cr-1', 'Not this year.');
  });

  it('a typed note makes the dialog dirty, so closing asks Keep editing · Discard', async () => {
    await render('return');
    const shell = fixture.debugElement.query((d) => d.componentInstance instanceof EditDialogComponent).componentInstance as EditDialogComponent;
    expect(shell.dirty()).toBeFalse();
    type('x');
    expect(shell.dirty()).toBeTrue();
  });

  for (const language of ['en', 'ar'] as const) {
    for (const code of REFUSALS) {
      it(`${code} is said from its code [${language}], with no Retry`, async () => {
        TestBed.inject(TranslateService).use(language);
        answer = () => throwError(() => new HttpErrorResponse({ status: 409, error: { code, message: 'English from the server' } }));
        await render('reject');
        type('x');
        action().click();
        fixture.detectChanges();
        const files = { en, ar };
        expect(text(document.querySelector('[data-testid="crd-refusal"]'))).toBe(files[language].committee.changeRequest.refusal[code]);
        expect(document.querySelector('[data-testid="crd-retry"]')).toBeNull();
        expect(fixture.componentInstance.open()).toBeTrue();
      });
    }
  }

  it('unreachable: said, and Retry instead of the action, which sends again', async () => {
    answer = () => throwError(() => new HttpErrorResponse({ status: 0 }));
    await render('return');
    type('x');
    action().click();
    fixture.detectChanges();
    expect(text(document.querySelector('[data-testid="crd-refusal"]'))).toBe("Nothing was changed: the server couldn't be reached.");
    answer = () => of(REQUEST({ status: 'returned' }));
    document.querySelector<HTMLButtonElement>('[data-testid="crd-retry"] button')!.click();
    expect(returned).toHaveBeenCalledTimes(2);
  });

  it('a failure the screen has no words for says something went wrong, never the server English', async () => {
    answer = () => throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Internal' } }));
    await render('return');
    type('x');
    action().click();
    fixture.detectChanges();
    expect(text(document.querySelector('[data-testid="crd-refusal"]'))).toBe('Something went wrong, so nothing was changed.');
  });
});
