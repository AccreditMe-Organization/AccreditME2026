import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AmConfirmService, type AmConfirmOptions } from '../../../../shared/components/confirm/am-confirm.service';
import { aMinutes, aMinutesItem } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingMinutesItemDto } from '../../services/meeting.service';
import { MeetingItemMinutesComponent } from './meeting-item-minutes.component';

// ACC-316 PR 7b — one item's minutes: the discussion, decisions with votes (all
// three or none) and "Taken without quorum", the action item drafts, and only
// for whoever records the minutes, the controls.
describe('MeetingItemMinutesComponent (ACC-316 PR 7b)', () => {
  let svc: Record<string, jasmine.Spy>;
  let asked: AmConfirmOptions[];

  function create(item: MeetingMinutesItemDto = aMinutesItem(), canWrite = true) {
    svc = {
      saveDiscussion: jasmine.createSpy('saveDiscussion').and.returnValue(of(aMinutes())),
      addDecision: jasmine.createSpy('addDecision').and.returnValue(of(aMinutes())),
      updateDecision: jasmine.createSpy('updateDecision').and.returnValue(of(aMinutes())),
      removeDecision: jasmine.createSpy('removeDecision').and.returnValue(of(aMinutes())),
      removeAction: jasmine.createSpy('removeAction').and.returnValue(of(aMinutes())),
    };
    asked = [];
    TestBed.configureTestingModule({
      imports: [MeetingItemMinutesComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        { provide: MeetingService, useValue: svc },
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingItemMinutesComponent);
    fixture.componentRef.setInput('meetingId', 'm-1');
    fixture.componentRef.setInput('item', item);
    fixture.componentRef.setInput('canWrite', canWrite);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };

  it('the discussion is saved trimmed, and an emptied one is null', () => {
    const { el, fixture } = create(aMinutesItem({ discussion: 'Alarm sounded twice.' }));
    const box = el.querySelector<HTMLTextAreaElement>('[data-item-discussion]')!;
    type(box, '  Alarm sounded twice; sensor replaced.  ');
    fixture.detectChanges();
    el.querySelector<HTMLElement>('[data-item-discussion-save] button')!.click();
    expect(svc['saveDiscussion']).toHaveBeenCalledWith('m-1', 'i-1', 'Alarm sounded twice; sensor replaced.');
    type(box, '   ');
    fixture.detectChanges();
    el.querySelector<HTMLElement>('[data-item-discussion-save] button')!.click();
    expect(svc['saveDiscussion']).toHaveBeenCalledWith('m-1', 'i-1', null);
  });

  it('a decision with its three vote counts sends them as numbers', () => {
    const { el, fixture } = create();
    el.querySelector<HTMLElement>('[data-decision-add] button')!.click();
    fixture.detectChanges();
    type(el.querySelector('[data-decision-text]')!, 'Replace the sensor.');
    type(el.querySelector('[data-vote="for"]')!, '5');
    type(el.querySelector('[data-vote="against"]')!, '1');
    type(el.querySelector('[data-vote="abstain"]')!, '0');
    fixture.detectChanges();
    el.querySelector<HTMLElement>('[data-decision-save] button')!.click();
    expect(svc['addDecision']).toHaveBeenCalledOnceWith('m-1', 'i-1', { text: 'Replace the sensor.', votesFor: 5, votesAgainst: 1, votesAbstain: 0 });
  });

  it('with no votes typed, the votes are null (the server takes all three or none)', () => {
    const { el, fixture } = create();
    el.querySelector<HTMLElement>('[data-decision-add] button')!.click();
    fixture.detectChanges();
    type(el.querySelector('[data-decision-text]')!, 'Noted.');
    fixture.detectChanges();
    el.querySelector<HTMLElement>('[data-decision-save] button')!.click();
    expect(svc['addDecision']).toHaveBeenCalledOnceWith('m-1', 'i-1', { text: 'Noted.', votesFor: null, votesAgainst: null, votesAbstain: null });
  });

  it('a refusal is said from its code, and the form stays open', () => {
    const { el, fixture } = create();
    svc['addDecision']!.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'MEETING_VOTES_PARTIAL' } })));
    el.querySelector<HTMLElement>('[data-decision-add] button')!.click();
    fixture.detectChanges();
    type(el.querySelector('[data-decision-text]')!, 'Replace the sensor.');
    fixture.detectChanges();
    el.querySelector<HTMLElement>('[data-decision-save] button')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-item-minutes-error]')?.textContent?.trim()).toBe(en.meeting.refusal.votesPartial);
    expect(el.querySelector('[data-decision-form]')).not.toBeNull();
  });

  it('a decision below quorum carries "Taken without quorum", and its votes in words', () => {
    const { el } = create(aMinutesItem({ decisions: [{ id: 'd-1', order: 1, text: 'Approved.', votes: { for: 4, against: 0, abstain: 1 }, takenWithoutQuorum: true }] }), false);
    expect(el.querySelector('[data-decision="d-1"] [data-decision-no-quorum]')?.textContent?.trim()).toBe('Taken without quorum');
    expect(el.querySelector('[data-decision="d-1"] [data-decision-votes]')?.textContent?.trim()).toBe('For 4 · Against 0 · Abstain 1');
  });

  it('removing a decision asks first', () => {
    const { el } = create(aMinutesItem({ decisions: [{ id: 'd-1', order: 1, text: 'Approved.', votes: null, takenWithoutQuorum: false }] }));
    el.querySelector<HTMLElement>('[data-decision-remove="d-1"] button')!.click();
    expect(svc['removeDecision']).not.toHaveBeenCalled();
    expect(asked[0]!.tone).toBe('destructive');
    asked[0]!.accept();
    expect(svc['removeDecision']).toHaveBeenCalledOnceWith('m-1', 'i-1', 'd-1');
  });

  it('an action draft shows its owner and due date, marked a draft; Raise action item asks the page', () => {
    const { el, c } = create(aMinutesItem({ actionItems: [{ id: 'x-1', title: 'Repair the alarm', owner: { id: 'u-2', name: 'Eng. Khalid' }, dueAt: '2027-03-30T13:00:00.000Z', task: null }] }));
    expect(el.querySelector('[data-action="x-1"]')?.textContent).toContain('Eng. Khalid');
    expect(el.querySelector('[data-action="x-1"] [data-action-draft]')).not.toBeNull();
    const raised = jasmine.createSpy('raised');
    c.raiseAction.subscribe(raised);
    el.querySelector<HTMLElement>('[data-action-raise] button')!.click();
    expect(raised).toHaveBeenCalledTimes(1);
  });

  it('without the right to write: the text, and no control at all', () => {
    const { el } = create(aMinutesItem({ discussion: 'Agreed to re-audit.', decisions: [{ id: 'd-1', order: 1, text: 'Re-audit.', votes: null, takenWithoutQuorum: false }] }), false);
    expect(el.querySelector('[data-item-discussion]')).toBeNull();
    expect(el.textContent).toContain('Agreed to re-audit.');
    expect(el.querySelector('[data-decision-add]')).toBeNull();
    expect(el.querySelector('[data-decision-edit="d-1"]')).toBeNull();
    expect(el.querySelector('[data-action-raise]')).toBeNull();
  });
});
