import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMeeting, aSeries } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingDto } from '../../services/meeting.service';
import { MeetingScopeDialogComponent } from '../meeting-scope-dialog/meeting-scope-dialog.component';
import { MeetingEditDialogComponent } from './meeting-edit-dialog.component';

// ACC-316 PR 8c (Q3) — Edit details: Schedule's step 1 fields without Starts,
// filled from the meeting; only what changed is sent; in a series, Next and
// "Which meetings change?" first.
describe('MeetingEditDialogComponent (ACC-316 PR 8c)', () => {
  let update: jasmine.Spy;
  let formChoices: jasmine.Spy;

  const TYPES = [
    { id: 't-1', labelEn: 'Regular', labelAr: 'اعتيادي' },
    { id: 't-2', labelEn: 'Extraordinary', labelAr: 'استثنائي' },
  ];

  function create(overrides: Partial<MeetingDto> = {}) {
    update = jasmine.createSpy('update').and.returnValue(of(aMeeting()));
    formChoices = jasmine.createSpy('formChoices').and.returnValue(of({ types: TYPES }));
    TestBed.configureTestingModule({
      imports: [MeetingEditDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: MeetingService, useValue: { update, formChoices, scopePreview: () => of({ meetings: [], kept: [], clashes: [] }), clashes: () => of([]) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingEditDialogComponent);
    fixture.componentRef.setInput('meeting', aMeeting(overrides));
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    const saved: number[] = [];
    fixture.componentInstance.saved.subscribe(() => saved.push(1));
    const closed: boolean[] = [];
    fixture.componentInstance.visibleChange.subscribe((v) => closed.push(v));
    return { fixture, c: fixture.componentInstance, saved, closed };
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));
  const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

  it("opens filled from the meeting, its types loaded on opening; a committee meeting has no quorum field", () => {
    const { c } = create();
    expect(formChoices).toHaveBeenCalledTimes(1);
    expect(c.form.getRawValue()).toEqual({ typeValueId: 't-1', durationMinutes: 90, unitQuorum: '', location: 'Board room, Tower B, floor 3', meetingUrl: '' });
    expect(document.querySelector('[data-testid="edit-quorum"]')).toBeNull();
    expect(text('edit-submit')).toBe('Save');
  });

  it("a unit meeting shows its quorum, filled", () => {
    const { c } = create({ owner: { kind: 'UNIT', id: 'u-1', nameEn: 'Pharmacy', nameAr: null }, unitQuorum: 4 });
    expect(document.querySelector('[data-testid="edit-quorum"]')).not.toBeNull();
    expect(c.form.controls.unitQuorum.value).toBe('4');
  });

  it('sends only what changed, with the meeting as loaded, and no scope for one meeting', () => {
    const { c, saved, closed } = create();
    c.form.controls.location.setValue('  Room 4  ');
    c.form.controls.durationMinutes.setValue(120);
    c.submit();
    expect(update).toHaveBeenCalledOnceWith('m-1', { location: 'Room 4', durationMinutes: 120, expectedUpdatedAt: '2027-03-01T08:00:00.000Z' });
    expect(saved.length).toBe(1);
    expect(closed).toEqual([false]);
  });

  it('a cleared field is sent as null; a unit meeting\'s quorum as a number, or null for none', () => {
    const { c } = create({ owner: { kind: 'UNIT', id: 'u-1', nameEn: 'Pharmacy', nameAr: null }, unitQuorum: 4, meetingUrl: 'https://meet.example/x' });
    c.form.controls.meetingUrl.setValue('');
    c.form.controls.unitQuorum.setValue('');
    c.form.controls.typeValueId.setValue('t-2');
    c.submit();
    expect(update.calls.mostRecent().args[1]).toEqual({ meetingUrl: null, unitQuorum: null, typeValueId: 't-2', expectedUpdatedAt: '2027-03-01T08:00:00.000Z' });
  });

  it('nothing changed: the dialog closes with no write', () => {
    const { c, closed, saved } = create();
    c.submit();
    expect(update).not.toHaveBeenCalled();
    expect(closed).toEqual([false]);
    expect(saved).toEqual([]);
  });

  it('with neither a place nor a link, the place line turns red and nothing is sent', () => {
    const { fixture, c } = create();
    c.form.controls.location.setValue('');
    c.submit();
    fixture.detectChanges();
    expect(update).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="edit-place-hint"]')!.className).toContain('danger');
  });

  it('a refusal is said from its code', () => {
    const { fixture, c } = create();
    update.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_CHANGED' } })));
    c.form.controls.location.setValue('Room 4');
    c.submit();
    fixture.detectChanges();
    expect(c.error()).toBe('meeting.refusal.changed');
    expect(document.querySelector('[data-testid="edit-error"]')).not.toBeNull();
  });

  it('in a series: Next, then "Which meetings change?" with the changed fields, and Apply sends its scope', () => {
    const { fixture, c, saved } = create({ series: aSeries() });
    fixture.detectChanges();
    expect(text('edit-submit')).toBe('Next');
    c.form.controls.location.setValue('Room 4');
    c.submit();
    fixture.detectChanges();
    expect(update).withContext('nothing is written before Apply').not.toHaveBeenCalled();
    expect(c.scopeOpen()).toBeTrue();
    expect(c.scopeChange()).toEqual({ change: 'EDIT', location: 'Room 4' });
    const scope = fixture.debugElement.query(By.directive(MeetingScopeDialogComponent)).componentInstance as MeetingScopeDialogComponent;
    scope.applied.emit('THIS_AND_LATER');
    expect(update).toHaveBeenCalledOnceWith('m-1', { location: 'Room 4', expectedUpdatedAt: '2027-03-01T08:00:00.000Z', scope: 'THIS_AND_LATER' });
    expect(saved.length).toBe(1);
    expect(c.scopeOpen()).toBeFalse();
  });

  it('in a series, nothing changed asks no scope', () => {
    const { c, closed } = create({ series: aSeries() });
    c.submit();
    expect(c.scopeOpen()).toBeFalse();
    expect(closed).toEqual([false]);
  });

  it("the meeting's own type stays a choice even when it is no longer offered", () => {
    const { c } = create({ type: { id: 't-old', labelEn: 'Retired type', labelAr: null } });
    expect(c.typeOptions().map((o) => o.value)).toEqual(['t-old', 't-1', 't-2']);
    expect(c.form.controls.typeValueId.value).toBe('t-old');
  });

  it('a failed type list says so, with Retry', () => {
    const { fixture, c } = create();
    formChoices.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    c.loadTypes();
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="edit-types-error"]')).not.toBeNull();
    formChoices.and.returnValue(of({ types: TYPES }));
    (document.querySelector('[data-testid="edit-types-retry"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="edit-types-error"]')).toBeNull();
  });
});
