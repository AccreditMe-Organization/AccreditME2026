// ACC-197 — "Draft with AI" on New task: the trigger, the suggestion, what each
// button does to the form, the refusals, and the rule that Create task waits
// while a draft is unsettled (plan §2.2).
//
// The real en.json and ar.json are loaded, so the words asserted here are the
// words a person reads.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { ITaskDraft, ITaskDto } from '../../services/task.service';
import { TaskFormComponent } from './task-form.component';

const API = environment.apiUrl;
const NOTE = 'follow up hand rub stock ward 6A';

const DRAFT: ITaskDraft = {
  draftId: 'log-1',
  title: 'Restock and check hand rub on ward 6A',
  lines: [
    { label: 'Purpose:', text: 'Keep ward 6A supplied with hand rub.' },
    { label: 'To do:', text: 'Check every dispenser and reorder through Supply.' },
    { label: 'Done when:', text: 'Every dispenser is full.' },
  ],
  description: 'Purpose: Keep ward 6A supplied with hand rub.\nTo do: Check every dispenser and reorder through Supply.\nDone when: Every dispenser is full.',
};

const FAR = { dueAt: '2100-01-01T00:00:00.000Z', limitAt: '2100-01-01T00:00:00.000Z' };
const FAR_LIMITS = { CRITICAL: FAR, HIGH: FAR, MEDIUM: FAR, LOW: FAR };

describe('TaskFormComponent — Draft with AI (ACC-197)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<TaskFormComponent>;
  let component: TaskFormComponent;
  let http: HttpTestingController;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(selector: string): T | null => el().querySelector<T>(selector);
  const text = (selector: string): string => (q(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Opens New task from a committee (unless told otherwise), on step 2. */
  async function open(opts: { available?: boolean; locked?: boolean; language?: 'en' | 'ar' } = {}): Promise<void> {
    const { available = true, locked = true, language = 'en' } = opts;
    TestBed.configureTestingModule({
      imports: [TaskFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        provideRouter([]),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskFormComponent);
    component = fixture.componentInstance;
    if (locked) {
      fixture.componentRef.setInput('lockedSourceType', 'COMMITTEE');
      fixture.componentRef.setInput('lockedSourceId', 'cmt-1');
      fixture.componentRef.setInput('lockedSourceLabel', 'Infection Control Committee');
    }
    fixture.detectChanges();
    http.expectOne(`${API}/tasks/assignment/units`).flush([]);
    http.expectOne(`${API}/working-calendar`).flush({
      id: 'cal-1',
      organizationId: 'org-1',
      timezone: 'Asia/Riyadh',
      workingDays: [0, 1, 2, 3, 4],
      workingHoursStart: '07:30',
      workingHoursEnd: '17:00',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    http.expectOne(`${API}/working-calendar/holidays`).flush([]);
    http.expectOne(`${API}/tasks/sla-preview`).flush(FAR_LIMITS);
    http.expectOne(`${API}/tasks/draft/availability`).flush({ available });
    component.form.patchValue({ title: 'Hand rub' });
    component.step.set(2);
    await settle();
  }

  const trigger = (): HTMLButtonElement | null => q<HTMLButtonElement>('app-task-draft-trigger .am-ai__trigger');
  const card = (): HTMLElement | null => q('app-task-draft-card .am-draft');
  const evidenceBlock = (): HTMLElement | null => q('#requiresEvidence');
  /** The Description field's hint, which steps aside with the two lower blocks. */
  const descriptionHint = (): boolean => text('form').includes('What a surveyor will read');
  const sourceBlock = (): boolean => el().textContent!.includes('Infection Control Committee');
  const button = (selector: string): HTMLButtonElement => q<HTMLButtonElement>(selector)!;

  /** Types the note and presses the trigger; returns the draft request. */
  async function pressDraft(note = NOTE): Promise<TestRequest> {
    component.form.controls.description.setValue(note);
    await settle();
    trigger()!.click();
    await settle();
    return http.expectOne({ method: 'POST', url: `${API}/tasks/draft` });
  }

  async function showSuggestion(draft: ITaskDraft = DRAFT): Promise<void> {
    (await pressDraft()).flush(draft);
    await settle();
  }

  const refuse = (req: TestRequest, status: number, body: Record<string, unknown>): void =>
    req.flush({ statusCode: status, message: 'English, for a log', ...body }, { status, statusText: 'Refused' });

  /** Step 1, as Back does. Its assignment picker is rebuilt and reloads its units. */
  async function backToStepOne(): Promise<void> {
    component.step.set(1);
    await settle();
    http.expectOne(`${API}/tasks/assignment/units`).flush([]);
    await settle();
  }

  /** Presses Create task, as the footer does. */
  async function pressCreate(): Promise<void> {
    component.onSubmit();
    await settle();
  }

  afterEach(() => http.verify());

  // ── Where it is, and when it is not ────────────────────────────────────

  it('shows "Draft with AI" on the Description label row when AI is available', async () => {
    await open();
    expect(trigger()).not.toBeNull();
    expect(trigger()!.textContent).toContain('Draft with AI');
    expect(q('app-task-draft-trigger')!.parentElement!.querySelector('label[for="description"]')).not.toBeNull();
    expect(card()).toBeNull();
  });

  it('is absent, not disabled, when AI is not available: step 2 is exactly as it was', async () => {
    await open({ available: false });
    expect(trigger()).toBeNull();
    expect(card()).toBeNull();
    expect(evidenceBlock()).not.toBeNull();
    expect(sourceBlock()).toBe(true);
  });

  it('is absent when the availability request fails', async () => {
    TestBed.configureTestingModule({
      imports: [TaskFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), ConfirmationService, provideTranslateService({ lang: 'en' }), provideFormatTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne(`${API}/tasks/assignment/units`).flush([]);
    http.expectOne(`${API}/working-calendar`).flush({ id: 'c', organizationId: 'o', timezone: 'Asia/Riyadh', workingDays: [0, 1, 2, 3, 4], workingHoursStart: '07:30', workingHoursEnd: '17:00', createdAt: '', updatedAt: '' });
    http.expectOne(`${API}/working-calendar/holidays`).flush([]);
    http.expectOne(`${API}/tasks/sla-preview`).flush(FAR_LIMITS);
    http.expectOne(`${API}/tasks/draft/availability`).flush('down', { status: 500, statusText: 'Server Error' });
    component.step.set(2);
    await settle();
    expect(trigger()).toBeNull();
  });

  it('Edit task never asks for it and never shows it (not drawn)', async () => {
    TestBed.configureTestingModule({
      imports: [TaskFormComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), ConfirmationService, provideTranslateService({ lang: 'en' }), provideFormatTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskFormComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', { id: 'task-1', title: 'Existing', description: 'd', priority: 'MEDIUM', status: 'PENDING', dueAt: '2099-01-01T09:00:00.000Z' } as unknown as ITaskDto);
    fixture.detectChanges();
    http.expectOne(`${API}/working-calendar`).flush({ id: 'c', organizationId: 'o', timezone: 'Asia/Riyadh', workingDays: [0, 1, 2, 3, 4], workingHoursStart: '07:30', workingHoursEnd: '17:00', createdAt: '', updatedAt: '' });
    http.expectOne(`${API}/working-calendar/holidays`).flush([]);
    http.expectOne(`${API}/tasks/task-1/sla-preview`).flush(FAR_LIMITS);
    http.expectNone(`${API}/tasks/draft/availability`);
    await settle();
    expect(trigger()).toBeNull();
  });

  // ── The request ────────────────────────────────────────────────────────

  it('sends the note, the title typed so far, the session language and the record the dialog was opened from', async () => {
    await open();
    const req = await pressDraft();
    expect(req.request.body).toEqual({ note: NOTE, language: 'en', title: 'Hand rub', sourceType: 'COMMITTEE', sourceId: 'cmt-1' });
    req.flush(DRAFT);
  });

  it('in an Arabic session it asks for an Arabic draft', async () => {
    await open({ language: 'ar' });
    const req = await pressDraft();
    expect((req.request.body as { language: string }).language).toBe('ar');
    req.flush(DRAFT);
  });

  it('with no record (the standalone screen) it sends the note alone', async () => {
    await open({ locked: false });
    const req = await pressDraft();
    expect(req.request.body).toEqual({ note: NOTE, language: 'en', title: 'Hand rub' });
    req.flush(DRAFT);
  });

  it('a note of fewer than 8 letters shows its message and makes NO request', async () => {
    await open();
    component.form.controls.description.setValue('ward 6A');
    await settle();
    trigger()!.click();
    await settle();

    http.expectNone(`${API}/tasks/draft`);
    expect(text('app-task-draft-card')).toContain('Add a few words about the task, then try again.');
    // A refusal hides nothing.
    expect(evidenceBlock()).not.toBeNull();
    expect(sourceBlock()).toBe(true);
  });

  // ── Working ────────────────────────────────────────────────────────────

  it('while working: "Working…" with Cancel, the working line, the field still editable, and the two lower blocks give way', async () => {
    await open();
    const req = await pressDraft();

    expect(trigger()!.textContent).toContain('Working…');
    expect(trigger()!.disabled).toBe(true);
    expect(text('app-task-draft-trigger')).toContain('Cancel');
    expect(text('app-task-draft-card')).toContain('Drafting a description from your note…');
    expect(q<HTMLTextAreaElement>('#description')!.disabled).toBe(false);
    expect(evidenceBlock()).toBeNull();
    expect(sourceBlock()).toBe(false);
    expect(descriptionHint()).toBe(false);

    req.flush(DRAFT);
  });

  it('Cancel stops waiting: the request is cancelled, the card goes, the note is untouched', async () => {
    await open();
    const req = await pressDraft();
    button('app-task-draft-trigger .am-ai__text-button').click();
    await settle();

    expect(req.cancelled).toBe(true);
    expect(card()).toBeNull();
    expect(component.form.controls.description.value).toBe(NOTE);
    expect(evidenceBlock()).not.toBeNull();
    expect(descriptionHint()).toBe(true);
  });

  it('closing the dialog cancels the wait: no result arrives later', async () => {
    await open();
    const req = await pressDraft();
    fixture.destroy();
    expect(req.cancelled).toBe(true);
  });

  it('going Back to step 1 does not cancel: the suggestion is there on return', async () => {
    await open();
    const req = await pressDraft();
    await backToStepOne();
    expect(req.cancelled).toBe(false);
    req.flush(DRAFT);
    component.step.set(2);
    await settle();
    expect(el().querySelectorAll('.am-draft__line').length).toBe(3);
  });

  // ── The suggestion ─────────────────────────────────────────────────────

  it('shows the three labelled lines, the suggested title, and Accept · Edit · Discard', async () => {
    await open();
    await showSuggestion();

    expect(text('app-task-draft-card')).toContain('AI suggestion · check before using');
    const lines = Array.from(el().querySelectorAll('.am-draft__line')).map((l) => l.textContent!.replace(/\s+/g, ' ').trim());
    expect(lines).toEqual(['Purpose: Keep ward 6A supplied with hand rub.', 'To do: Check every dispenser and reorder through Supply.', 'Done when: Every dispenser is full.']);
    expect(text('.am-draft__title')).toContain('Title: “Restock and check hand rub on ward 6A”');
    // "Use this title" sits at the far end of the same row.
    expect(Array.from(el().querySelectorAll('.am-ai__actions button')).map((b) => b.textContent!.trim())).toEqual(['Accept', 'Edit', 'Discard', 'Use this title']);
    expect(descriptionHint()).toBe(false);
    expect(trigger()!.textContent).toContain('Draft again');
    // Nothing is in the form yet.
    expect(component.form.controls.description.value).toBe(NOTE);
    expect(component.form.controls.title.value).toBe('Hand rub');
  });

  it('Accept replaces the note with the description, changes nothing else, and brings the lower blocks back', async () => {
    await open();
    await showSuggestion();
    button('.am-ai__primary').click();
    await settle();

    expect(component.form.controls.description.value).toBe(DRAFT.description);
    expect(component.form.controls.title.value).toBe('Hand rub');
    expect(component.form.dirty).toBe(true);
    expect(card()).toBeNull();
    expect(evidenceBlock()).not.toBeNull();
    expect(sourceBlock()).toBe(true);
  });

  it('Edit does the same and puts the cursor in the Description field', async () => {
    await open();
    await showSuggestion();
    button('.am-ai__actions .am-ai__secondary').click();
    await settle();

    expect(component.form.controls.description.value).toBe(DRAFT.description);
    expect(document.activeElement).toBe(q('#description'));
  });

  it('Discard removes the suggestion and leaves the note as it was', async () => {
    await open();
    await showSuggestion();
    button('.am-ai__actions .am-ai__text-button').click();
    await settle();

    expect(card()).toBeNull();
    expect(component.form.controls.description.value).toBe(NOTE);
    expect(evidenceBlock()).not.toBeNull();
  });

  it('"Use this title" changes only the Title; the suggestion stays, without its title row', async () => {
    await open();
    await showSuggestion();
    button('.am-draft__title-button').click();
    await settle();

    expect(component.form.controls.title.value).toBe('Restock and check hand rub on ward 6A');
    expect(component.form.controls.description.value).toBe(NOTE);
    expect(q('.am-draft__title')).toBeNull();
    expect(q('.am-draft__title-button')).toBeNull();
    expect(el().querySelectorAll('.am-draft__line').length).toBe(3);
  });

  it('a draft with no title shows no title row', async () => {
    await open();
    await showSuggestion({ ...DRAFT, title: null });
    expect(q('.am-draft__title')).toBeNull();
    expect(q('.am-draft__title-button')).toBeNull();
  });

  it('"Draft again" replaces the suggestion: never two cards', async () => {
    await open();
    await showSuggestion();
    trigger()!.click();
    await settle();
    const second = http.expectOne({ method: 'POST', url: `${API}/tasks/draft` });
    expect(el().querySelectorAll('.am-draft__line').length).toBe(0);
    second.flush({ ...DRAFT, draftId: 'log-2', lines: [{ label: 'Purpose:', text: 'Second.' }, { label: 'To do:', text: 'Second.' }, { label: 'Done when:', text: 'Second.' }] });
    await settle();

    expect(el().querySelectorAll('app-task-draft-card .am-ai__result').length).toBe(1);
    expect(text('.am-draft__line')).toBe('Purpose: Second.');
  });

  // ── Refusals ───────────────────────────────────────────────────────────

  it('each refusal code shows its own words, and never the server\'s English message', async () => {
    const cases: Array<[number, Record<string, unknown>, string]> = [
      [409, { code: 'DRAFT_NOTHING_TO_SUGGEST' }, "AI couldn't suggest anything from this. Add more detail and try again."],
      [409, { code: 'DRAFT_NOTE_TOO_SHORT' }, 'Add a few words about the task, then try again.'],
      [409, { code: 'AI_CREDITS_EXHAUSTED', renewsAt: '2026-10-21T00:00:00.000Z' }, 'Your organization has used all its AI credits for this period.'],
      [429, { code: 'RATE_LIMITED', retryAfterSeconds: 30 }, "That's a lot of drafts in one minute. Wait a moment, then try again."],
      [502, { code: 'AI_PROVIDER_FAILED' }, "AI isn't available right now. Try again later."],
    ];
    await open();
    for (const [status, body, words] of cases) {
      refuse(await pressDraft(), status, body);
      await settle();
      expect(text('app-task-draft-card')).withContext(String(body['code'])).toContain(words);
      expect(text('app-task-draft-card')).not.toContain('English, for a log');
      // A refusal hides nothing, and the note is untouched.
      expect(evidenceBlock()).withContext(String(body['code'])).not.toBeNull();
      expect(descriptionHint()).withContext(String(body['code'])).toBe(true);
      expect(component.form.controls.description.value).toBe(NOTE);
    }
  });

  it('a failed call offers "Try again", which repeats the same request', async () => {
    await open();
    refuse(await pressDraft(), 502, { code: 'AI_PROVIDER_FAILED' });
    await settle();
    button('app-task-draft-card .am-ai__refusal .am-ai__secondary').click();
    await settle();

    const retry = http.expectOne({ method: 'POST', url: `${API}/tasks/draft` });
    expect((retry.request.body as { note: string }).note).toBe(NOTE);
    retry.flush(DRAFT);
    await settle();
    expect(el().querySelectorAll('.am-draft__line').length).toBe(3);
  });

  it('editing the note clears a refusal about the old one', async () => {
    await open();
    refuse(await pressDraft(), 409, { code: 'DRAFT_NOTHING_TO_SUGGEST' });
    await settle();
    expect(card()).not.toBeNull();
    component.form.controls.description.setValue(`${NOTE} and the store`);
    await settle();
    expect(card()).toBeNull();
  });

  // ── §2.2 — Create task waits while a draft is unsettled ────────────────

  describe('Create task and an unsettled draft (§2.2)', () => {
    it('with the WORKING line showing, Create sends nothing, says why, and moves focus to the card', async () => {
      await open();
      const req = await pressDraft();
      await pressCreate();

      http.expectNone({ method: 'POST', url: `${API}/tasks` });
      expect(text('.am-draft__settle')).toBe('Accept or discard the suggestion first.');
      expect(q('.am-draft__settle')!.getAttribute('role')).toBe('alert');
      expect(document.activeElement).toBe(card());
      req.flush(DRAFT);
    });

    it('with a SUGGESTION showing, Create sends nothing, says why, and moves focus to the card', async () => {
      await open();
      await showSuggestion();
      await pressCreate();

      http.expectNone({ method: 'POST', url: `${API}/tasks` });
      expect(text('.am-draft__settle')).toBe('Accept or discard the suggestion first.');
      expect(document.activeElement).toBe(card());
    });

    it('says it in Arabic in an Arabic session', async () => {
      await open({ language: 'ar' });
      await showSuggestion();
      await pressCreate();

      http.expectNone({ method: 'POST', url: `${API}/tasks` });
      expect(text('.am-draft__settle')).toBe('اقبل الاقتراح أو تجاهله أولًا.');
    });

    it('pressed from step 1, it takes the person to the suggestion', async () => {
      await open();
      await showSuggestion();
      await backToStepOne();
      expect(component.canCreateFromStep1()).toBe(true);
      await pressCreate();

      http.expectNone({ method: 'POST', url: `${API}/tasks` });
      expect(component.step()).toBe(2);
      expect(text('.am-draft__settle')).toBe('Accept or discard the suggestion first.');
      expect(document.activeElement).toBe(card());
    });

    it('a REFUSAL does not block Create: the task is sent with the note as it is', async () => {
      await open();
      refuse(await pressDraft(), 409, { code: 'DRAFT_NOTHING_TO_SUGGEST' });
      await settle();
      await pressCreate();

      const create = http.expectOne({ method: 'POST', url: `${API}/tasks` });
      expect((create.request.body as { description: string }).description).toBe(NOTE);
      expect(create.request.body).not.toEqual(jasmine.objectContaining({ aiDraft: jasmine.anything() }));
      expect(q('.am-draft__settle')).toBeNull();
      create.flush({});
    });

    it('after Accept, Create sends, and the message is gone', async () => {
      await open();
      await showSuggestion();
      await pressCreate();
      expect(q('.am-draft__settle')).not.toBeNull();
      button('.am-ai__primary').click();
      await settle();
      expect(q('.am-draft__settle')).toBeNull();
      await pressCreate();

      const create = http.expectOne({ method: 'POST', url: `${API}/tasks` });
      expect((create.request.body as { description: string }).description).toBe(DRAFT.description);
      create.flush({});
    });

    it('after Discard, Create sends the note, with no AI marker', async () => {
      await open();
      await showSuggestion();
      button('.am-ai__actions .am-ai__text-button').click();
      await settle();
      await pressCreate();

      const create = http.expectOne({ method: 'POST', url: `${API}/tasks` });
      expect((create.request.body as { description: string }).description).toBe(NOTE);
      expect('aiDraft' in (create.request.body as object)).toBe(false);
      create.flush({});
    });
  });

  // ── What Create task tells the server about the draft ──────────────────

  describe('the aiDraft claim on Create task', () => {
    const created = (): Record<string, unknown> => {
      const create = http.expectOne({ method: 'POST', url: `${API}/tasks` });
      create.flush({});
      return create.request.body as Record<string, unknown>;
    };

    // ACC-199 — "Assign … instead" in the picker: claimed on Create while that
    // person is still the one chosen; dropped once someone else is.
    it('an AI workload suggestion is claimed only while the person it named is still chosen', async () => {
      await open();
      const assign = component.form.controls.assignTo.controls;
      assign.scope.setValue('unit-1');
      assign.target.setValue('pos-qo');
      assign.userId.setValue('sara');
      component.workloadFollowed.set({ id: 'log-9', userId: 'sara' });
      await pressCreate();
      expect(created()['aiWorkloadHint']).toEqual({ id: 'log-9' });

      assign.userId.setValue('khalid');
      await pressCreate();
      expect('aiWorkloadHint' in created()).toBe(false);
    });

    it('nothing accepted, nothing claimed — even after a draft was made and discarded', async () => {
      await open();
      await showSuggestion();
      button('.am-ai__actions .am-ai__text-button').click();
      await settle();
      await pressCreate();
      expect('aiDraft' in created()).toBe(false);
    });

    it('an accepted description is claimed with its draft id', async () => {
      await open();
      await showSuggestion();
      button('.am-ai__primary').click();
      await settle();
      await pressCreate();
      expect(created()['aiDraft']).toEqual({ id: 'log-1', description: true, title: false });
    });

    it('"Use this title" then Discard claims the title only', async () => {
      await open();
      await showSuggestion();
      button('.am-draft__title-button').click();
      await settle();
      button('.am-ai__actions .am-ai__text-button').click();
      await settle();
      await pressCreate();
      expect(created()['aiDraft']).toEqual({ id: 'log-1', description: false, title: true });
    });

    it('an accepted description the person then deleted is not claimed', async () => {
      await open();
      await showSuggestion();
      button('.am-ai__primary').click();
      await settle();
      component.form.controls.description.setValue('');
      await settle();
      await pressCreate();
      expect('aiDraft' in created()).toBe(false);
    });

    it('a draft whose call could not be logged (no id) is never claimed', async () => {
      await open();
      await showSuggestion({ ...DRAFT, draftId: null });
      button('.am-ai__primary').click();
      await settle();
      await pressCreate();
      expect('aiDraft' in created()).toBe(false);
    });
  });
});
