import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { NEVER, Subject, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { anAi } from '../../meeting-fixtures.testing';
import { DRAFT_MINUTES_WAIT_MS, MeetingMinutesAi } from '../../meeting-minutes-ai';
import { MinutesWriteOrder } from '../../minutes-write-order';
import { MeetingService, type MeetingAiDto } from '../../services/meeting.service';
import { MeetingRoughNotesComponent } from './meeting-rough-notes.component';

// ACC-322 PR 2 — Rough notes and Draft minutes: who sees them (the AI read's
// flags only), the notes saved as typed and never written back, the press
// saving them first, the long wait, and each refusal said from its code.
describe('MeetingRoughNotesComponent (ACC-322 PR 2)', () => {
  let svc: Record<string, jasmine.Spy>;
  let fixture: ComponentFixture<MeetingRoughNotesComponent>;
  let el: HTMLElement;

  function create(ai: MeetingAiDto, language: 'en' | 'ar' = 'en') {
    svc = {
      ai: jasmine.createSpy('ai').and.returnValue(of(ai)),
      saveAiNotes: jasmine.createSpy('saveAiNotes').and.callFake((_id: string, text: string | null) => of({ notes: text })),
      draftMinutes: jasmine.createSpy('draftMinutes').and.returnValue(of(anAi({ undecided: 2, leftToDraft: 1 }))),
    };
    TestBed.configureTestingModule({
      imports: [MeetingRoughNotesComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        MinutesWriteOrder,
        MeetingMinutesAi,
        { provide: MeetingService, useValue: svc },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(MeetingMinutesAi).load('m-1');
    fixture = TestBed.createComponent(MeetingRoughNotesComponent);
    fixture.componentRef.setInput('meetingId', 'm-1');
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const box = () => q('meeting-rough-notes-box') as HTMLTextAreaElement;
  const trigger = () => el.querySelector<HTMLButtonElement>('[data-testid="meeting-ai-draft"] .am-ai__trigger');
  const type = (value: string) => {
    box().value = value;
    box().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  it('whoever records a draft gets the box, its note that the notes go to the AI provider, and Draft minutes', async () => {
    create(anAi({ notes: 'Item 2: compliance 84%.' }));
    await fixture.whenStable();
    expect(box().value).toBe('Item 2: compliance 84%.');
    expect(q('meeting-rough-notes')!.textContent).toContain(en.meeting.ai.notesProvider);
    expect(trigger()?.textContent).toContain(en.meeting.ai.draftMinutes);
  });

  it('nobody else (may false: not the recorder, another stage, or after Return, M9) sees the box at all', () => {
    create(anAi({ minutes: { may: false, available: true, creditCost: 8, running: false } }));
    expect(q('meeting-rough-notes')).toBeNull();
  });

  it('no trigger where AI is not available, or nothing is left to draft (M8); the box stays', () => {
    create(anAi({ minutes: { may: true, available: false, creditCost: null, running: false } }));
    expect(box()).not.toBeNull();
    expect(trigger()).toBeNull();
    TestBed.resetTestingModule();
    create(anAi({ leftToDraft: 0 }));
    expect(trigger()).toBeNull();
  });

  it('"Draft again" once suggestions are undecided', () => {
    create(anAi({ undecided: 3 }));
    expect(trigger()?.textContent).toContain(en.meeting.ai.draftAgain);
  });

  it('the notes are saved after a pause, and the stored (trimmed) value is never written back into the box', fakeAsync(() => {
    create(anAi());
    tick(); // ngModel writes the loaded (empty) notes a microtask later
    type('Item 2: re-audit 4B ');
    tick(799);
    expect(svc['saveAiNotes']).not.toHaveBeenCalled();
    tick(1);
    expect(svc['saveAiNotes']).toHaveBeenCalledOnceWith('m-1', 'Item 2: re-audit 4B');
    fixture.detectChanges();
    // The trailing space under the cursor survives the save's answer, and a later read.
    expect(box().value).toBe('Item 2: re-audit 4B ');
    TestBed.inject(MeetingMinutesAi).set(anAi({ notes: 'Item 2: re-audit 4B' }));
    fixture.detectChanges();
    tick();
    expect(box().value).toBe('Item 2: re-audit 4B ');
  }));

  it('a press saves unsaved notes FIRST, then drafts in the interface language', () => {
    create(anAi(), 'ar');
    const calls: string[] = [];
    svc['saveAiNotes'].and.callFake((_id: string, text: string | null) => (calls.push('save'), of({ notes: text })));
    svc['draftMinutes'].and.callFake(() => (calls.push('draft'), of(anAi())));
    type('البند ٢: إعادة التدقيق');
    trigger()!.click();
    expect(svc['saveAiNotes']).toHaveBeenCalledWith('m-1', 'البند ٢: إعادة التدقيق');
    expect(svc['draftMinutes']).toHaveBeenCalledOnceWith('m-1', 'ar');
    expect(calls).toEqual(['save', 'draft']);
  });

  it('notes that could not be saved: no press is made, and the notes line says so', () => {
    create(anAi());
    svc['saveAiNotes'].and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    type('Item 2');
    trigger()!.click();
    fixture.detectChanges();
    expect(svc['draftMinutes']).not.toHaveBeenCalled();
    expect(q('meeting-rough-notes-error')!.textContent).toContain(en.meeting.ai.notesFailed);
  });

  it('empty notes: "Add notes first.", with no request', () => {
    create(anAi());
    trigger()!.click();
    fixture.detectChanges();
    expect(svc['draftMinutes']).not.toHaveBeenCalled();
    expect(q('meeting-ai-no-notes')!.textContent).toContain(en.meeting.refusal.aiNoNotes);
  });

  it('a draft that answers updates the suggestions and says so; the page re-reads the minutes (M2 count)', () => {
    create(anAi({ notes: 'notes' }));
    let counted = 0;
    TestBed.inject(MeetingMinutesAi).countChanged.subscribe(() => counted++);
    trigger()!.click();
    fixture.detectChanges();
    expect(TestBed.inject(MeetingMinutesAi).ai()!.undecided).toBe(2);
    expect(counted).toBe(1);
  });

  it("the AI gateway's refusals are said through ai-refusal.ts (credits used up, with the renewal date)", () => {
    create(anAi({ notes: 'notes' }));
    svc['draftMinutes'].and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'AI_CREDITS_EXHAUSTED', renewsAt: '2027-04-01T00:00:00.000Z' } })));
    trigger()!.click();
    fixture.detectChanges();
    expect(q('meeting-ai-outcome')!.textContent).toContain('Your organization has used all its AI credits for this period.');
  });

  it("the meeting's refusals are said from their code, never the server's English", () => {
    create(anAi({ notes: 'notes' }));
    svc['draftMinutes'].and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_AI_NOTHING_SUGGESTED', message: 'SERVER ENGLISH' } })));
    trigger()!.click();
    fixture.detectChanges();
    expect(q('meeting-ai-failure')!.textContent).toContain(en.meeting.refusal.aiNothingSuggested);
    expect(el.textContent).not.toContain('SERVER ENGLISH');
  });

  it('MEETING_AI_TOO_LONG is said for its feature', () => {
    create(anAi({ notes: 'notes' }));
    svc['draftMinutes'].and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_AI_TOO_LONG', feature: 'minutes' } })));
    trigger()!.click();
    fixture.detectChanges();
    expect(q('meeting-ai-failure')!.textContent).toContain(en.meeting.refusal.aiTooLong.minutes);
  });

  it('a stale page (MEETING_AI_NOT_OFFERED, MEETING_CHANGED) offers Reload, never Retry', () => {
    create(anAi({ notes: 'notes' }));
    let reloads = 0;
    fixture.componentInstance.reload.subscribe(() => reloads++);
    svc['draftMinutes'].and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_AI_NOT_OFFERED', stageNameEn: 'Minutes Review', stageNameAr: 'مراجعة المحضر' } })));
    trigger()!.click();
    fixture.detectChanges();
    expect(q('meeting-ai-failure')!.textContent).toContain(en.meeting.refusal.aiNotOffered);
    q('meeting-ai-reload')!.querySelector('button')!.click();
    expect(reloads).toBe(1);
  });

  it('MEETING_AI_IN_PROGRESS: the run is read and shown running, with Check again', () => {
    create(anAi({ notes: 'notes' }));
    svc['draftMinutes'].and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_AI_IN_PROGRESS' } })));
    svc['ai'].and.returnValue(of(anAi({ notes: 'notes', minutes: { may: true, available: true, creditCost: 8, running: true } })));
    trigger()!.click();
    fixture.detectChanges();
    expect(q('meeting-ai-running')!.textContent).toContain(en.meeting.ai.running);
    expect(q('meeting-ai-check-again')).not.toBeNull();
    expect(el.querySelector('.am-ai__refusal')).toBeNull();
  });

  it(`the press waits ${DRAFT_MINUTES_WAIT_MS / 1000} s, longer than the server's 300 s call; then reads the run: running, never Retry`, fakeAsync(() => {
    create(anAi({ notes: 'notes' }));
    svc['draftMinutes'].and.returnValue(NEVER);
    trigger()!.click();
    fixture.detectChanges();
    svc['ai'].calls.reset();
    tick(300_000);
    expect(svc['ai']).withContext('still waiting at 300 s').not.toHaveBeenCalled();
    svc['ai'].and.returnValue(of(anAi({ notes: 'notes', minutes: { may: true, available: true, creditCost: 8, running: true } })));
    tick(DRAFT_MINUTES_WAIT_MS - 300_000);
    fixture.detectChanges();
    expect(svc['ai']).toHaveBeenCalledTimes(1);
    expect(q('meeting-ai-running')).not.toBeNull();
    expect(el.textContent).not.toContain(en.ai.assist.retry);
  }));

  it('a lost connection (status 0) is the same: the run state, not Retry; its saved suggestions show when it finished', () => {
    create(anAi({ notes: 'notes' }));
    svc['draftMinutes'].and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    svc['ai'].and.returnValue(of(anAi({ notes: 'notes', undecided: 3 })));
    trigger()!.click();
    fixture.detectChanges();
    expect(TestBed.inject(MeetingMinutesAi).ai()!.undecided).toBe(3);
    expect(q('meeting-ai-running')).toBeNull();
    expect(el.textContent).not.toContain(en.ai.assist.retry);
  });

  it('Cancel stops waiting; the run goes on and is charged, so its state is read and said', () => {
    create(anAi({ notes: 'notes' }));
    const answer = new Subject<MeetingAiDto>();
    svc['draftMinutes'].and.returnValue(answer);
    trigger()!.click();
    fixture.detectChanges();
    svc['ai'].and.returnValue(of(anAi({ notes: 'notes', minutes: { may: true, available: true, creditCost: 8, running: true } })));
    el.querySelector<HTMLButtonElement>('[data-testid="meeting-ai-draft"] .am-ai__text-button')!.click();
    fixture.detectChanges();
    expect(answer.observed).toBeFalse();
    expect(q('meeting-ai-running')!.textContent).toContain(en.meeting.ai.stopped);
  });
});
