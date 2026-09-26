import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { IOrgUnitHeadStatus } from '../../services/org-unit-head.service';
import { SetActingHeadDialogComponent } from './set-acting-head-dialog.component';

/**
 * ACC-120 slice 2 — what these tests are for.
 *
 * The dialog's whole reason to exist is that TWO of the three things it sends
 * are not typed by anyone: the acting reason and who is being covered for are
 * derived from the unit's state, and the 90-day consequence of leaving the end
 * date empty is stated before it is chosen rather than 90 days later on Setup
 * health. So the tests that matter are the derivation, the request it produces,
 * and the empty-"Until" wording — not that a form renders.
 */
@Component({
  standalone: true,
  imports: [SetActingHeadDialogComponent],
  template: `
    <app-set-acting-head-dialog
      orgUnitId="unit-pharmacy"
      unitName="Pharmacy"
      [status]="status()"
      [people]="people"
      [visible]="visible()"
    />
  `,
})
class HostComponent {
  readonly status = signal<IOrgUnitHeadStatus>(VACANT);
  readonly visible = signal(true);
  readonly people = [
    { id: 'u-huda', name: 'Dr. Huda Zahrani', email: 'huda@example.com' },
    { id: 'u-fahad', name: 'Dr. Fahad Al-Anazi', email: 'fahad@example.com' },
  ];
}

const VACANT: IOrgUnitHeadStatus = {
  holders: [],
  pendingHeadUserId: null,
  headHandoverEffectiveDate: null,
  actingHeadUserId: null,
};

const HELD: IOrgUnitHeadStatus = {
  holders: [{ id: 'u-fahad', name: 'Dr. Fahad Al-Anazi', positionId: 'pos-director' }],
  pendingHeadUserId: null,
  headHandoverEffectiveDate: null,
  actingHeadUserId: null,
};

function setup(status: IOrgUnitHeadStatus): {
  fixture: ComponentFixture<HostComponent>;
  dialog: SetActingHeadDialogComponent;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      // EditDialogComponent asks before discarding unsaved work.
      ConfirmationService,
      // No loader: instant() returns the key, so assertions name the KEY and
      // cannot be broken by a copy edit — which is what we want here, because
      // the wording is reviewed in the browser and the branching is reviewed
      // in code.
      provideTranslateService({ lang: 'en' }),
    ],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.status.set(status);
  fixture.detectChanges();
  const dialog = fixture.debugElement.children[0].componentInstance as SetActingHeadDialogComponent;
  return { fixture, dialog };
}

const DAY = 24 * 60 * 60 * 1000;

describe('SetActingHeadDialogComponent (ACC-120 slice 2)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  describe('the reason is derived from the unit, never chosen', () => {
    it('is VACANCY on a unit with no head, and covers for nobody', () => {
      const { dialog } = setup(VACANT);

      expect(dialog.actingReason()).toBe('VACANCY');
      expect(dialog.coveredHead()).toBeNull();
      expect(dialog.stripLabel()).toBe('orgUnitHead.cover.stripPost');
      expect(dialog.stripMeta()).toBe('orgUnitHead.cover.stripNobodyCovered');
    });

    it('is ABSENCE on a unit that has a head, and covers for that head', () => {
      const { dialog } = setup(HELD);

      expect(dialog.actingReason()).toBe('ABSENCE');
      expect(dialog.coveredHead()?.id).toBe('u-fahad');
      expect(dialog.stripLabel()).toBe('orgUnitHead.cover.stripCoversFor');
      expect(dialog.stripValue()).toBe('Dr. Fahad Al-Anazi');
    });

    // The design's reason for deriving it: a user who could pick would be able
    // to record "the post is vacant" about a unit that has a head. There is no
    // control to assert the absence of, so the check is that the value tracks
    // the unit and nothing else can move it.
    it('follows the unit when the unit changes, with no input of its own', () => {
      const { fixture, dialog } = setup(VACANT);
      expect(dialog.actingReason()).toBe('VACANCY');

      fixture.componentInstance.status.set(HELD);
      fixture.detectChanges();

      expect(dialog.actingReason()).toBe('ABSENCE');
    });
  });

  describe('an empty "Until"', () => {
    it('warns on an ABSENCE, naming the day Setup health will flag it', () => {
      const { dialog } = setup(HELD);

      expect(dialog.validTo()).toBeNull();
      expect(dialog.messageKey()).toBe('orgUnitHead.cover.messageOpenAbsence');
      expect(dialog.messageSeverity()).toBe('warn');
    });

    // Not a warning: an open-ended cover for a vacant post is normal, and
    // styling it as a fault would train people to ignore the one that matters.
    it('informs on a VACANCY rather than warning', () => {
      const { dialog } = setup(VACANT);

      expect(dialog.messageKey()).toBe('orgUnitHead.cover.messageOpenVacancy');
      expect(dialog.messageSeverity()).toBe('info');
    });

    it('names the 90th day from the start, which is when the condition fires', () => {
      const { dialog } = setup(VACANT);
      const from = new Date(2026, 8, 25);
      dialog.validFrom.set(from);

      const expected = new Date(from);
      expected.setDate(expected.getDate() + 90);
      expect(dialog.flagDate()!.getTime()).toBe(expected.getTime());
      expect(SetActingHeadDialogComponent.OPEN_ENDED_ACTING_DAYS).toBe(90);
    });

    it('says so on the button too, so the open end is in the thing being clicked', () => {
      const { dialog } = setup(VACANT);

      expect(dialog.ctaKey()).toBe('orgUnitHead.cover.ctaOpen');

      dialog.validTo.set(new Date(dialog.validFrom()!.getTime() + 26 * DAY));
      expect(dialog.ctaKey()).toBe('orgUnitHead.cover.ctaUntil');
    });

    it('is still a valid save — an end date is optional here as it is in the API', () => {
      const { dialog } = setup(VACANT);
      dialog.form.controls.userId.setValue('u-huda');

      expect(dialog.canSave()).toBeTrue();
    });
  });

  describe('the range', () => {
    it('refuses an end on or before the start, and says which way round it goes', () => {
      const { dialog } = setup(VACANT);
      dialog.form.controls.userId.setValue('u-huda');
      dialog.validTo.set(new Date(dialog.validFrom()!.getTime() - DAY));

      expect(dialog.rangeInvalid()).toBeTrue();
      expect(dialog.messageKey()).toBe('orgUnitHead.cover.messageRangeInvalid');
      expect(dialog.messageSeverity()).toBe('error');
      expect(dialog.canSave()).toBeFalse();
    });

    it('treats an equal start and end as invalid, not as a zero-length cover', () => {
      const { dialog } = setup(VACANT);
      dialog.validTo.set(new Date(dialog.validFrom()!.getTime()));

      expect(dialog.rangeInvalid()).toBeTrue();
    });

    it('reports how long the cover runs once both ends are set', () => {
      const { dialog } = setup(VACANT);
      dialog.validTo.set(new Date(dialog.validFrom()!.getTime() + 26 * DAY));

      expect(dialog.messageKey()).toBe('orgUnitHead.cover.messageEnds');
      expect(dialog.messageParams()['duration']).toContain('26');
    });
  });

  describe('what it sends', () => {
    it('sends the derived reason and the covered head on an ABSENCE', () => {
      const { dialog } = setup(HELD);
      dialog.form.controls.userId.setValue('u-huda');
      const until = new Date(dialog.validFrom()!.getTime() + 26 * DAY);
      dialog.validTo.set(until);

      dialog.submit();

      const req = TestBed.inject(HttpTestingController).expectOne(
        `${environment.apiUrl}/organization/units/unit-pharmacy/head/acting-head`,
      );
      expect(req.request.body).toEqual({
        userId: 'u-huda',
        actingReason: 'ABSENCE',
        validFrom: dialog.validFrom()!.toISOString(),
        validTo: until.toISOString(),
        coveringForUserId: 'u-fahad',
      });
      req.flush(null);
    });

    // A VACANCY covers for nobody, so coveringForUserId is OMITTED rather than
    // sent as null: ACC-40 2.6.4 makes its absence the thing that means "pure
    // vacancy — workflow eligibility only, no role".
    it('omits coveringForUserId entirely on a VACANCY', () => {
      const { dialog } = setup(VACANT);
      dialog.form.controls.userId.setValue('u-huda');

      dialog.submit();

      const req = TestBed.inject(HttpTestingController).expectOne(
        `${environment.apiUrl}/organization/units/unit-pharmacy/head/acting-head`,
      );
      expect(req.request.body.actingReason).toBe('VACANCY');
      expect(req.request.body.coveringForUserId).toBeUndefined();
      expect(req.request.body.validTo).toBeUndefined();
      req.flush(null);
    });

    it('does not send at all without a person, and asks every field to speak', () => {
      const { dialog } = setup(VACANT);

      dialog.submit();

      TestBed.inject(HttpTestingController).expectNone(
        `${environment.apiUrl}/organization/units/unit-pharmacy/head/acting-head`,
      );
      expect(dialog.showErrors()).toBeTrue();
    });
  });

  // Escape and the close button ASK before discarding, and only if there is
  // something to discard. A date the user set is work, the same as a typed
  // field — without this, choosing an end date and pressing Escape throws it
  // away silently.
  describe('the unsaved-work guard', () => {
    it('is clean before anything is touched', () => {
      const { dialog } = setup(VACANT);

      expect(dialog.dirty()).toBeFalse();
    });

    it('is dirty once a person is chosen', () => {
      const { dialog } = setup(VACANT);
      dialog.form.controls.userId.setValue('u-huda');
      dialog.form.controls.userId.markAsDirty();

      expect(dialog.dirty()).toBeTrue();
    });

    it('is dirty once an end date is chosen, which no form control records', () => {
      const { dialog } = setup(VACANT);
      dialog.validTo.set(new Date(dialog.validFrom()!.getTime() + DAY));

      expect(dialog.dirty()).toBeTrue();
    });

    // FOUND IN A BROWSER, NOT HERE — the original guard counted only validTo,
    // so moving the START date and pressing Escape closed silently and threw it
    // away. The lesson is that "a date is not a form control" cuts both ways:
    // every such value has to be named in dirty explicitly.
    it('is dirty once the START date is moved, which the first version missed', () => {
      const { dialog } = setup(VACANT);
      dialog.validFrom.set(new Date(dialog.validFrom()!.getTime() + 4 * DAY));

      expect(dialog.dirty()).toBeTrue();
    });

    it('is NOT dirty when the start date is re-set to the same day', () => {
      const { dialog } = setup(VACANT);
      dialog.validFrom.set(new Date(dialog.validFrom()!.getTime()));

      expect(dialog.dirty()).toBeFalse();
    });

    // Escape does not blur first, so commitTyped() never runs on that path. A
    // half-written date is still work the user would not expect to lose.
    it('is dirty while a date is part-typed and not yet committed', () => {
      const { dialog } = setup(VACANT);
      dialog.onTyped('until', '20 Oct');

      expect(dialog.dirty()).toBeTrue();
    });
  });

  // ALSO FOUND IN A BROWSER. EditDialogComponent re-attaches the TEMPLATE on
  // reopen (ACC-29), but this component instance is never destroyed, so every
  // signal outlived the close. Set From to 30 Sep, discard, reopen, and it
  // still read 30 Sep — a user who believed they had abandoned a date could
  // reopen and submit it.
  describe('closing the dialog', () => {
    it('restores the start date to today, so a discard genuinely discards', () => {
      const { fixture, dialog } = setup(VACANT);
      const today = dialog.validFrom()!.getTime();
      dialog.validFrom.set(new Date(today + 4 * DAY));
      dialog.validTo.set(new Date(today + 30 * DAY));
      dialog.form.controls.userId.setValue('u-huda');
      dialog.onTyped('from', '30 Sep 20');

      fixture.componentInstance.visible.set(false);
      fixture.detectChanges();

      expect(dialog.validFrom()!.getTime()).toBe(today);
      expect(dialog.validTo()).toBeNull();
      expect(dialog.form.controls.userId.value).toBeNull();
      // The part-typed text is cleared too, not left hanging over a reset
      // value: fromText() prefers `typed` while it is non-null, so a stale
      // '30 Sep 20' would keep showing over a validFrom that had gone back to
      // today — the field and the value disagreeing.
      expect(dialog.fromText()).not.toBe('30 Sep 20');
      expect(dialog.untilText()).toBe('');
      expect(dialog.dirty()).toBeFalse();
    });

    it('leaves the reopened dialog clean, not merely blank', () => {
      const { fixture, dialog } = setup(VACANT);
      dialog.validTo.set(new Date(dialog.validFrom()!.getTime() + 30 * DAY));

      fixture.componentInstance.visible.set(false);
      fixture.detectChanges();
      fixture.componentInstance.visible.set(true);
      fixture.detectChanges();

      expect(dialog.dirty()).toBeFalse();
      expect(dialog.ctaKey()).toBe('orgUnitHead.cover.ctaOpen');
    });
  });
});
