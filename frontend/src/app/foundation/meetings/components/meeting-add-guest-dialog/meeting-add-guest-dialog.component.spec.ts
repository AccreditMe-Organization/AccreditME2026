import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { aMeeting } from '../../meeting-fixtures.testing';
import { MeetingService } from '../../services/meeting.service';
import { MeetingAddGuestDialogComponent } from './meeting-add-guest-dialog.component';

// ACC-316 PR 6 review (P184) — the person picker is its own layer above Add a
// guest: Escape closes the picker only, never the dialog beneath it, and never
// asks "Discard changes?" about the form it did not close (LayerStackService).
describe('MeetingAddGuestDialogComponent (ACC-316 PR 6)', () => {
  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  it('Escape on the person picker closes the picker; Add a guest stays open, with no "Discard changes?"', async () => {
    TestBed.configureTestingModule({
      imports: [MeetingAddGuestDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: MeetingService, useValue: { guestCandidates: () => of({ items: [], total: 0, matching: 0 }), addGuest: () => of({}) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const ask = spyOn(TestBed.inject(AmConfirmService), 'ask').and.callThrough();
    const fixture = TestBed.createComponent(MeetingAddGuestDialogComponent);
    fixture.componentRef.setInput('meeting', aMeeting());
    fixture.componentRef.setInput('visible', true);
    const closed = jasmine.createSpy('visibleChange');
    fixture.componentInstance.visibleChange.subscribe(closed);
    fixture.autoDetectChanges(true);
    await fixture.whenStable();
    const c = fixture.componentInstance;
    // Unsaved work, so a wrong Escape WOULD ask.
    c.form.controls.userId.setValue('u-9');
    c.form.markAsDirty();

    document.querySelector<HTMLButtonElement>('p-button[icon="pi pi-search"] button')!.click();
    await fixture.whenStable();
    expect(c.pickerOpen()).withContext('the picker opened').toBeTrue();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await fixture.whenStable();

    expect(c.pickerOpen()).withContext('the picker closed').toBeFalse();
    expect(closed).not.toHaveBeenCalledWith(false);
    expect(ask).not.toHaveBeenCalled();
    expect(document.querySelector('.am-dialog__body')).withContext('Add a guest is still there').not.toBeNull();
  });
});
