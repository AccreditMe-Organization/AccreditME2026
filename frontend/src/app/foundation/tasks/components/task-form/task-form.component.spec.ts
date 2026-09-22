// ACC-96 — the two-step due control, and the payload it produces.
//
// ## What is inherited, and why it still matters after the rebuild
//
// The payload test is the same evidence the superseded root-layer branch
// produced: a body CAPTURED IN A BROWSER from the implementation that shipped
// on dev, before any of this existed. It survives the rebuild deliberately —
// the picker has now changed twice, and the one thing that must not change is
// what POST /tasks receives for the same choice. Part B is what changes that,
// on purpose, and nothing here does.
//
// The "does not close on a change" tests are also inherited. Their cause was a
// layer that dismissed on every ngModelChange, so the first press of an hour
// arrow shut the calendar and stranded the time at whatever "now" was. The
// mechanism is gone; the requirement is not, and the date view can regress the
// same way.
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { TaskFormComponent } from './task-form.component';

describe('TaskFormComponent — due control (ACC-96)', () => {
  let fixture: ComponentFixture<TaskFormComponent>;
  let component: TaskFormComponent;
  let httpMock: HttpTestingController;

  const flushReferenceData = (): void => {
    httpMock
      .expectOne(`${environment.apiUrl}/users?status=ACTIVE&pageSize=200`)
      .flush({ data: [], total: 0, page: 1, pageSize: 200 });
    httpMock.expectOne(`${environment.apiUrl}/working-calendar`).flush({
      id: 'cal-1',
      organizationId: 'org-1',
      timezone: 'Asia/Riyadh',
      workingDays: [0, 1, 2, 3, 4],
      workingHoursStart: '07:30',
      workingHoursEnd: '17:00',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    httpMock.expectOne(`${environment.apiUrl}/working-calendar/holidays`).flush([]);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TaskFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ConfirmationService,
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        provideRouter([]),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    flushReferenceData();
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  // ── The date view substitutes, and does not dismiss itself ──────────────

  it('opens and closes the date view from the calendar button, on the same step', () => {
    expect(component.dateView()).toBe(false);

    component.toggleDateView();
    expect(component.dateView()).toBe(true);
    expect(component.step())
      .withContext('the date view is the same step, not a third one')
      .toBe(1);

    component.toggleDateView();
    expect(component.dateView()).toBe(false);
  });

  it('keeps the date view open when a day or a time is set', () => {
    component.toggleDateView();

    component.onDayPicked(new Date(2026, 8, 25));
    expect(component.dateView())
      .withContext('picking a day must not dismiss the view — the time is set after the day')
      .toBe(true);

    component.onTimeTyped('09:00');
    expect(component.dateView()).toBe(true);
  });

  it('a day click keeps the time already chosen', () => {
    component.onTimeTyped('18:30');
    component.onDayPicked(new Date(2026, 8, 25));
    expect(component.dueTimeText()).toBe('18:30');
  });

  it('a time with no day yet still produces a value', () => {
    component.onTimeTyped('14:15');
    expect(component.dueTimeText()).toBe('14:15');
    expect(component.form.controls.dueDate.value).not.toBeNull();
  });

  // ── Presets ─────────────────────────────────────────────────────────────

  it('sets both date and time from one preset press', () => {
    const plus2h = component.presets().find((p) => p.key === 'plus2h')!;
    component.applyPreset(plus2h);

    expect(component.form.controls.dueDate.value).toEqual(plus2h.at);
    expect(component.dueDateText()).not.toBe('');
    expect(component.dueTimeText()).not.toBe('');
    expect(component.activePreset()).toBe('plus2h');
  });

  it('offers all four presets once the calendar is known', () => {
    expect(component.presets().map((p) => p.key)).toEqual([
      'plus1h',
      'plus2h',
      'endOfDay',
      'nextMorning',
    ]);
  });

  // ── Typing stays a complete path ────────────────────────────────────────

  // ── A date with no time (Ahmad, 2026-09-22) ─────────────────────────────
  //
  // Midnight is what the parser returns and almost never what anyone means. A
  // task "due Thursday" is due by the END of Thursday, and 00:00 also made
  // every typed date warn about being out of hours.

  describe('a date named with no time', () => {
    it('takes the end of the working day on a working day', () => {
      // 24 Sep 2026 is a Thursday — a working day in this tenant's Sun–Thu week.
      component.onDateTyped('24 Sep 2026');
      component.commitTypedDate();

      expect(component.dueTimeText()).toBe('17:00');
      expect(component.warning().kind)
        .withContext('17:00 is the end of the day, so nothing to warn about')
        .toBe('none');
    });

    it('takes the SAME end time on a non-working day, and warns', () => {
      // 25 Sep 2026 is a Friday. The configured end time still applies — the
      // alternative, rolling to the next working day, would change the DAY the
      // user was explicit about. The warning is what makes that visible.
      component.onDateTyped('25 Sep 2026');
      component.commitTypedDate();

      expect(component.dueTimeText()).toBe('17:00');
      expect(component.form.controls.dueDate.value?.getDate())
        .withContext('the day the user typed, not the next working one')
        .toBe(25);
      expect(component.warning().kind).toBe('nonWorkingDay');
    });

    it('never overrides a time the user set — typed, picked or from a preset', () => {
      component.onTimeTyped('08:15');
      component.onDateTyped('24 Sep 2026');
      component.commitTypedDate();
      expect(component.dueTimeText()).toBe('08:15');

      // And the same through the grid, which answers the question the same way.
      component.onDayPicked(new Date(2026, 8, 28));
      expect(component.dueTimeText()).toBe('08:15');
    });

    it('applies the same default to a day picked in the grid', () => {
      component.onDayPicked(new Date(2026, 8, 24));
      expect(component.dueTimeText())
        .withContext('picking 24 Sep and typing "24 Sep 2026" are the same statement')
        .toBe('17:00');
    });
  });

  it('accepts a typed date and keeps the typed time', () => {
    component.onTimeTyped('16:45');
    component.onDateTyped('25 Sep 2026');
    component.commitTypedDate();

    const value = component.form.controls.dueDate.value!;
    expect(value.getFullYear()).toBe(2026);
    expect(value.getMonth()).toBe(8);
    expect(value.getDate()).toBe(25);
    expect(component.dueTimeText()).toBe('16:45');
  });

  it('flags an unparseable date and clears the flag once it parses', () => {
    component.onDateTyped('not a date');
    component.commitTypedDate();
    expect(component.form.controls.dueDate.hasError('invalidDate')).toBe(true);

    component.onDateTyped('25 Sep 2026');
    component.commitTypedDate();
    expect(component.form.controls.dueDate.hasError('invalidDate')).toBe(false);
  });

  // ── Create on step 1 ────────────────────────────────────────────────────

  describe('Create on step 1', () => {
    it('is withheld while a required field lives on step 2', () => {
      // No locked source, so sourceType and sourceId are required and live on
      // step 2. Template 3: "use Create from there when step 2 has no required
      // fields" — here it has two.
      component.form.patchValue({ title: 'Raise an urgent task' });
      expect(component.canCreateFromStep1()).toBe(false);
    });

    it('is offered once the source is locked and the title is valid', () => {
      fixture.componentRef.setInput('lockedSourceType', 'COMMITTEE');
      fixture.componentRef.setInput('lockedSourceId', 'cmt-1');
      fixture.componentRef.setInput('lockedSourceLabel', 'Infection Prevention & Control');
      fixture.detectChanges();

      expect(component.canCreateFromStep1())
        .withContext('an empty title is still required')
        .toBe(false);

      component.form.patchValue({ title: 'Raise an urgent task' });
      fixture.detectChanges();
      expect(component.canCreateFromStep1()).toBe(true);
    });

    it('is withheld while the chosen time is already past', () => {
      fixture.componentRef.setInput('lockedSourceType', 'COMMITTEE');
      fixture.componentRef.setInput('lockedSourceId', 'cmt-1');
      fixture.componentRef.setInput('lockedSourceLabel', 'IPC');
      component.form.patchValue({ title: 'Raise an urgent task' });
      fixture.detectChanges();

      component.onDayPicked(new Date(2020, 0, 1));
      fixture.detectChanges();

      // A past due time is the one case artboard 12 calls an error rather than
      // a warning, so it blocks rather than warns.
      expect(component.warning().kind).toBe('past');
      expect(component.canCreateFromStep1()).toBe(false);
    });
  });

  // ── Dirty ───────────────────────────────────────────────────────────────

  it('reports dirty outward so the dialog can ask before discarding', () => {
    const seen: boolean[] = [];
    component.dirtyChange.subscribe((d) => seen.push(d));

    // Opening the calendar is not a change — artboard 12's own rule for what
    // counts as dirty, so that a user who looked at next month does not get a
    // discard prompt.
    component.toggleDateView();
    expect(seen).toEqual([]);

    component.form.controls.title.markAsDirty();
    component.form.patchValue({ title: 'Something' });
    expect(seen.at(-1)).toBe(true);
  });

  // ── The calendar toggle (Rev 7) ─────────────────────────────────────────

  it('names what the next press will do, and reports its state', () => {
    expect(component.dateView()).toBe(false);
    expect(component.calendarToggleLabel()).toBe('task.due.toggleCalendar');

    component.toggleDateView();
    // Not "Choose a due date" while the calendar is already open: a toggle
    // whose label describes the current state instead of the next action
    // tells the user the opposite of what will happen.
    expect(component.calendarToggleLabel()).toBe('task.due.hideCalendar');

    component.toggleDateView();
    expect(component.calendarToggleLabel()).toBe('task.due.toggleCalendar');
  });

  // ── A due date may not be in the past ───────────────────────────────────

  describe('past due dates', () => {
    const lockSource = (): void => {
      fixture.componentRef.setInput('lockedSourceType', 'COMMITTEE');
      fixture.componentRef.setInput('lockedSourceId', 'cmt-1');
      fixture.componentRef.setInput('lockedSourceLabel', 'IPC');
      component.form.patchValue({ title: 'Raise an urgent task' });
      fixture.detectChanges();
    };

    it('blocks BOTH Creates, not just step 1s', () => {
      lockSource();
      expect(component.canCreateFromStep1()).toBe(true);

      component.onDateTyped('1 Jan 2020');
      component.commitTypedDate();
      fixture.detectChanges();

      expect(component.isPast()).toBe(true);
      expect(component.canCreateFromStep1()).toBe(false);
      // Step 2's Create gates on form.invalid, so the fact has to reach the
      // CONTROL. A note only step 1 consulted let a past date through there.
      expect(component.form.controls.dueDate.hasError('pastDate')).toBe(true);
      expect(component.form.invalid).toBe(true);
    });

    it('counts today at a time already gone as past', () => {
      lockSource();
      const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      component.onDayPicked(anHourAgo);
      component.onTimeTyped(
        `${`${anHourAgo.getHours()}`.padStart(2, '0')}:${`${anHourAgo.getMinutes()}`.padStart(2, '0')}`,
      );
      fixture.detectChanges();

      // The comparison is against the INSTANT, not the day — today is a
      // perfectly good due date, an hour ago is not.
      expect(component.isPast()).toBe(true);
      expect(component.form.controls.dueDate.hasError('pastDate')).toBe(true);
    });

    it('clears the error once the value moves into the future', () => {
      lockSource();
      component.onDateTyped('1 Jan 2020');
      component.commitTypedDate();
      expect(component.form.controls.dueDate.hasError('pastDate')).toBe(true);

      component.onDateTyped('1 Jan 2099');
      component.commitTypedDate();
      fixture.detectChanges();

      expect(component.form.controls.dueDate.hasError('pastDate')).toBe(false);
      expect(component.canCreateFromStep1()).toBe(true);
    });

    it('hands the calendar today as its floor', () => {
      const floor = component.today();
      expect(floor.getHours()).toBe(0);
      expect(floor.getMinutes()).toBe(0);
      expect(floor.toDateString()).toBe(new Date().toDateString());
    });
  });

  // ── The payload ─────────────────────────────────────────────────────────

  it('sends the picked instant unchanged — byte-for-byte the body dev sends', () => {
    // CAPTURED IN A BROWSER from the implementation on dev: picking
    // 25 Sep 2026 09:00 posted exactly this. Compared as the serialised string
    // rather than the object, because the wire format is what has to match —
    // an absent `description` and `description: undefined` are the same
    // request and different objects.
    const wire =
      '{"title":"ACC-96 payload probe","sourceType":"DOCUMENT","sourceId":"acc96-probe",' +
      '"priority":"MEDIUM","dueDate":"2026-09-25T06:00:00.000Z","assigneeUserIds":[]}';

    component.form.patchValue({
      title: 'ACC-96 payload probe',
      sourceType: 'DOCUMENT',
      sourceId: 'acc96-probe',
    });
    component.onDayPicked(new Date('2026-09-25T06:00:00.000Z'));
    component.onTimeTyped('09:00');

    component.onSubmit();

    const req = httpMock.expectOne(`${environment.apiUrl}/tasks`);
    expect(req.request.method).toBe('POST');
    expect(JSON.stringify(req.request.body)).toBe(wire);
    req.flush({});
  });
});
