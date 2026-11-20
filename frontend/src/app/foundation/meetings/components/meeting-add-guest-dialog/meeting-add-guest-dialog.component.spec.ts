import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Subject, of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { aMeeting } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingClashDto } from '../../services/meeting.service';
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

  // ── PR 8c (R5-5, Q9) — the chosen person's clash line ──────────────────────

  describe('the clash line for the person chosen', () => {
    let clashes: jasmine.Spy;
    const huda = { id: 'u-7', name: 'Dr. Huda Zahrani', unit: null, position: null };
    const busy = (title: string | null): MeetingClashDto => ({
      startsAt: '2027-03-18T10:30:00.000Z',
      invitees: 1,
      people: [{ userId: 'u-7', name: 'Dr. Huda Zahrani', meetings: [{ id: title ? 'o-1' : null, title, startsAt: '2027-03-18T10:00:00.000Z', durationMinutes: 60 }] }],
    });

    function create(answer: unknown = of([busy('Infection Control')])) {
      clashes = jasmine.createSpy('clashes').and.returnValue(answer);
      TestBed.configureTestingModule({
        imports: [MeetingAddGuestDialogComponent],
        providers: [
          provideNoopAnimations(),
          provideTranslateService({ lang: 'en' }),
          provideFormatTesting(),
          providePrimeNG({}),
          ConfirmationService,
          { provide: MeetingService, useValue: { guestCandidates: () => of({ items: [], total: 0, matching: 0 }), addGuest: () => of({}), clashes } },
        ],
      });
      loadTranslationsForTest({ en, ar });
      TestBed.inject(TranslateService).use('en');
      const fixture = TestBed.createComponent(MeetingAddGuestDialogComponent);
      fixture.componentRef.setInput('meeting', aMeeting());
      fixture.componentRef.setInput('visible', true);
      fixture.detectChanges();
      return { fixture, c: fixture.componentInstance };
    }
    const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

    it('asks for that person alone, at the meeting\'s time and duration, and names them', () => {
      const { fixture, c } = create();
      expect(clashes).not.toHaveBeenCalled();
      c.onPicked(huda);
      fixture.detectChanges();
      expect(clashes).toHaveBeenCalledOnceWith({ meetingId: 'm-1', userIds: ['u-7'], times: [{ startsAt: '2027-03-18T10:30:00.000Z', durationMinutes: 90 }] });
      expect(Array.from(document.querySelectorAll('[data-testid="meeting-clash-line"] > *')).map((n) => n.textContent!.trim())).toEqual(['Dr. Huda Zahrani has another meeting then', 'Show which']);
      (document.querySelector('[data-testid="meeting-clash-toggle"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      // One row per meeting of theirs, without their name again.
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="meeting-clash-rows"] li')).map((n) => n.innerText.replace(/\s+/g, ' ').trim());
      // The time in the organisation's zone (the test's +03).
      expect(rows).toEqual(['Infection Control 13:00–14:00']);
      // A warning only: Add stays enabled.
      expect((document.querySelector('[data-testid="guest-submit"] button') as HTMLButtonElement).disabled).toBeFalse();
    });

    it('a meeting they may not open is "another meeting"; someone free has no line', () => {
      const { fixture, c } = create(of([busy(null)]));
      c.onPicked(huda);
      fixture.detectChanges();
      c.showWhich.set(true);
      fixture.detectChanges();
      expect(text('meeting-clash-rows')).toContain('another meeting');
      clashes.and.returnValue(of([{ startsAt: 'x', invitees: 1, people: [] }]));
      c.onPicked({ ...huda, id: 'u-8', name: 'Omar Haddad' });
      fixture.detectChanges();
      expect(document.querySelector('[data-testid="meeting-clash"]')).toBeNull();
      expect(c.showWhich()).toBeFalse();
    });

    it('the latest choice wins: an earlier answer arriving late is dropped', () => {
      const slow = new Subject<MeetingClashDto[]>();
      const { fixture, c } = create(slow);
      c.onPicked(huda);
      clashes.and.returnValue(of([{ startsAt: 'x', invitees: 1, people: [] }]));
      c.onPicked({ ...huda, id: 'u-8', name: 'Omar Haddad' });
      slow.next([busy('Infection Control')]);
      fixture.detectChanges();
      expect(document.querySelector('[data-testid="meeting-clash"]')).toBeNull();
    });

    it('an outside guest is never checked; back on the person, their line returns', () => {
      const { fixture, c } = create();
      c.onPicked(huda);
      c.setKind('outside');
      fixture.detectChanges();
      expect(document.querySelector('[data-testid="meeting-clash"]')).toBeNull();
      c.setKind('person');
      fixture.detectChanges();
      expect(clashes).toHaveBeenCalledTimes(2);
      expect(text('meeting-clash-line')).toContain('Dr. Huda Zahrani has another meeting then');
    });

    it('a new opening starts with nobody chosen and no line, and asks nothing', () => {
      const { fixture, c } = create();
      c.onPicked(huda);
      fixture.componentRef.setInput('visible', false);
      fixture.detectChanges();
      fixture.componentRef.setInput('visible', true);
      fixture.detectChanges();
      expect(c.clash()).toBeNull();
      expect(c.picked()).toBeNull();
      expect(clashes).toHaveBeenCalledTimes(1);
      // Choosing a person never resets the form (the opening's reset reads nobody).
      c.form.controls.outsideName.setValue('kept');
      c.onPicked(huda);
      fixture.detectChanges();
      expect(c.form.controls.outsideName.value).toBe('kept');
    });

    it('in Arabic: the line names the person in Arabic', () => {
      const { fixture, c } = create();
      TestBed.inject(TranslateService).use('ar');
      c.onPicked(huda);
      fixture.detectChanges();
      expect(text('meeting-clash-line')).toContain('لدى Dr. Huda Zahrani اجتماع آخر حينها');
    });
  });
});
