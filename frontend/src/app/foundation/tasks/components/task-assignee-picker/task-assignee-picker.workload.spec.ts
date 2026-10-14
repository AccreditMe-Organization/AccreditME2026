import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { AssignGroup, COMMITTEE_SCOPE, TaskAssigneePickerComponent, createAssignGroup, toAssignTarget } from './task-assignee-picker.component';
import { followedHint } from './followed-hint';
import { TaskWorkloadHintStore } from './task-workload-hint.store';

// ACC-199 — counts on the record in the person rows, and "✦ Suggest someone".
// Plan: backend/Plans/step-199-workload-hint.md §2. Only a PRESS calls the
// model (Q2); the answer is kept per person for the dialog.

const API = `${environment.apiUrl}/tasks`;

@Component({
  standalone: true,
  imports: [TaskAssigneePickerComponent],
  providers: [TaskWorkloadHintStore],
  template: `
    @if (shown()) {
      <app-task-assignee-picker
        [group]="group"
        [sourceType]="sourceType()"
        [sourceId]="sourceId()"
        [purpose]="purpose()"
        [layout]="layout()"
        priority="HIGH"
        (hintFollowed)="followed.push($event)"
      />
    }
  `,
})
class HostComponent {
  readonly shown = signal(true);
  readonly sourceType = signal<string | null>('COMMITTEE');
  readonly sourceId = signal<string | null>('cmt-1');
  readonly purpose = signal<'task' | 'stage-task'>('task');
  readonly layout = signal<'row' | 'stacked'>('row');
  group: AssignGroup = createAssignGroup(false);
  readonly followed: { id: string; userId: string }[] = [];
}

const PEOPLE = [
  { id: 'nora', name: 'Nora Al-Otaibi', open: 12, overdue: 3, canSuggest: true },
  { id: 'sara', name: 'Sara Al-Mutairi', open: 4, overdue: 0, canSuggest: false },
  { id: 'khalid', name: 'Khalid Al-Zahrani', open: 7, overdue: 1, canSuggest: true },
];

const HINT = {
  interactionId: 'log-7',
  chosen: { userId: 'nora', openCount: 12, overdueCount: 3 },
  suggestion: {
    userId: 'sara',
    name: 'Sara Al-Mutairi',
    positionNameEn: 'Quality Officer',
    positionNameAr: 'مسؤول الجودة',
    openCount: 4,
    overdueCount: 0,
    dueSoonCount: 1,
  },
  // Nora has work due soon; Sara has some too, so "nothing due soon" is not said.
  dueSoonSeen: true,
};

describe('TaskAssigneePickerComponent — workload on the record and "Suggest someone" (ACC-199)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;

  function setup(options: { language?: 'en' | 'ar'; record?: boolean; purpose?: 'task' | 'stage-task'; layout?: 'row' | 'stacked' } = {}) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(options.language ?? 'en');
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    if (options.record === false) {
      fixture.componentInstance.sourceType.set(null);
      fixture.componentInstance.sourceId.set(null);
    }
    if (options.purpose) fixture.componentInstance.purpose.set(options.purpose);
    if (options.layout) fixture.componentInstance.layout.set(options.layout);
    fixture.detectChanges();
    http.expectOne(`${API}/assignment/units`).flush([{ id: 'unit-1', parentId: null, nameEn: 'Cardiology', nameAr: 'أمراض القلب' }]);
    fixture.detectChanges();
    const picker = () => fixture.debugElement.query(By.directive(TaskAssigneePickerComponent)).componentInstance as TaskAssigneePickerComponent;
    const el = () => fixture.nativeElement as HTMLElement;
    const render = () => {
      fixture.detectChanges();
      fixture.detectChanges();
    };
    return { fixture, picker, el, render, host: fixture.componentInstance, group: () => fixture.componentInstance.group };
  }

  /** Unit, position, and the people list — answered with or without workload. */
  function choosePosition(group: AssignGroup, withWorkload = true): TestRequest {
    group.controls.scope.setValue('unit-1');
    http.expectOne((r) => r.url === `${API}/assignment/positions`).flush([
      { id: 'pos-qo', nameEn: 'Quality Officer', nameAr: 'مسؤول الجودة', isSingleAssignee: false, holderCount: 3 },
    ]);
    group.controls.target.setValue('pos-qo');
    const req = http.expectOne((r) => r.url === `${API}/assignees`);
    req.flush(
      PEOPLE.map((p) => ({
        id: p.id,
        name: p.name,
        positionNameEn: 'Quality Officer',
        positionNameAr: 'مسؤول الجودة',
        workload: withWorkload ? { openCount: p.open, overdueCount: p.overdue, canSuggest: p.canSuggest } : null,
      })),
    );
    return req;
  }

  const availability = () => http.expectOne(`${API}/assignment/workload-hint/availability`);
  const press = () => http.expectOne({ method: 'POST', url: `${API}/assignment/workload-hint` });
  const text = (el: HTMLElement, selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (el: HTMLElement, selector: string) => el.querySelector<HTMLButtonElement>(selector)!;

  afterEach(() => http.verify());

  describe('counts in the person rows', () => {
    it('asks for the people WITH the record, and shows each person\'s open and overdue tasks on it', () => {
      const { picker, group } = setup();
      const req = choosePosition(group());
      expect(req.request.params.get('sourceType')).toBe('COMMITTEE');
      expect(req.request.params.get('sourceId')).toBe('cmt-1');
      expect(picker().peopleOptions().map((o) => [o.label, o.open, o.overdue])).toEqual([
        ['Nora Al-Otaibi', '12 open', '3 overdue'],
        ['Sara Al-Mutairi', '4 open', undefined],
        ['Khalid Al-Zahrani', '7 open', '1 overdue'],
      ]);
    });

    it('in Arabic, Latin digits and the Arabic words', () => {
      const { picker, group } = setup({ language: 'ar' });
      choosePosition(group());
      expect(picker().peopleOptions()[0]).toEqual(jasmine.objectContaining({ open: '12 مفتوحة', overdue: '3 متأخرة' }));
    });

    it('withheld by the server (null): no counts, and the rows are as before', () => {
      const { picker, group } = setup();
      choosePosition(group(), false);
      expect(picker().peopleOptions().every((o) => o.open === undefined && o.overdue === undefined)).toBe(true);
    });

    it('with no record (New task from the Tasks page), the record is not sent and nothing is offered', () => {
      const { group, el, render } = setup({ record: false });
      const req = choosePosition(group(), false);
      expect(req.request.params.has('sourceType')).toBe(false);
      group().controls.userId.setValue('nora');
      render();
      expect(el().querySelector('app-task-workload-hint')).toBeNull();
    });

    it('never on a stage task definition, even with a record named', () => {
      const { group } = setup({ purpose: 'stage-task' });
      const req = choosePosition(group(), false);
      expect(req.request.params.has('sourceType')).toBe(false);
    });
  });

  describe('"✦ Suggest someone"', () => {
    it('is offered for a person past the threshold once AI is known available — asked once, only when it could matter', () => {
      const { group, el, render } = setup();
      choosePosition(group());
      // Sara is not past the threshold: nothing is asked.
      group().controls.userId.setValue('sara');
      render();
      http.expectNone(`${API}/assignment/workload-hint/availability`);
      expect(el().querySelector('.am-wh__suggest')).toBeNull();

      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: true });
      render();
      expect([text(el(), '.am-wh__outcome'), text(el(), '.am-wh__suggest')]).toEqual(['Goes to Nora Al-Otaibi.', '✦ Suggest someone']);

      // Khalid is past it too: availability is not asked again.
      group().controls.userId.setValue('khalid');
      render();
      http.expectNone(`${API}/assignment/workload-hint/availability`);
      expect(el().querySelector('.am-wh__suggest')).not.toBeNull();
    });

    it('AI not available: counts only, no button', () => {
      const { group, el, render } = setup();
      choosePosition(group());
      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: false });
      render();
      expect(el().querySelector('.am-wh__suggest')).toBeNull();
      expect(text(el(), '.am-picker__outcome')).toBe('Goes to Nora Al-Otaibi.');
    });

    it('choosing a person calls nothing: only a press does, with the record, the priority and the target', () => {
      const { group, el, render } = setup();
      choosePosition(group());
      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: true });
      render();
      http.expectNone({ method: 'POST', url: `${API}/assignment/workload-hint` });

      button(el(), '.am-wh__suggest').click();
      render();
      const req = press();
      expect(req.request.body).toEqual({
        orgUnitId: 'unit-1',
        positionId: 'pos-qo',
        chosenUserId: 'nora',
        sourceType: 'COMMITTEE',
        sourceId: 'cmt-1',
        priority: 'HIGH',
      });
      expect(text(el(), '.am-wh__suggest')).toBe('◌ Suggesting…');
      expect(button(el(), '.am-wh__suggest').disabled).toBe(true);
      req.flush(HINT);
    });

    it('the answer: the drawn hint, marked as AI, with Assign … instead and Keep …', () => {
      const { group, el, render } = setup();
      choosePosition(group());
      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: true });
      render();
      button(el(), '.am-wh__suggest').click();
      press().flush(HINT);
      render();
      expect(text(el(), '.am-wh__text')).toBe(
        '✦ AI · Goes to Nora Al-Otaibi, who has 12 open tasks on this committee, 3 overdue. Sara Al-Mutairi (Quality Officer) has 4 open, none overdue.',
      );
      // Short on screen; the accessible name starts with those words and says who.
      const actions = Array.from(el().querySelectorAll('.am-wh__action'));
      expect(actions.map((b) => b.textContent!.trim())).toEqual(['Assign instead', 'Keep']);
      expect(actions.map((b) => b.getAttribute('aria-label'))).toEqual(['Assign instead: Sara Al-Mutairi', 'Keep: Nora Al-Otaibi']);
      expect(el().querySelector('.am-wh--ai')).not.toBeNull();
    });

    it('in Arabic, worded with no gender, Latin digits', () => {
      const { group, el, render } = setup({ language: 'ar' });
      choosePosition(group());
      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: true });
      render();
      expect(text(el(), '.am-wh__suggest')).toBe('✦ اقتراح شخص آخر');
      button(el(), '.am-wh__suggest').click();
      press().flush(HINT);
      render();
      expect(text(el(), '.am-wh__text')).toBe(
        '✦ ذكاء اصطناعي · تذهب إلى Nora Al-Otaibi: 12 مهمة مفتوحة في هذه اللجنة، منها 3 مهام متأخرة. لدى Sara Al-Mutairi (مسؤول الجودة) 4 مهام مفتوحة، ولا شيء متأخر.',
      );
      const actions = Array.from(el().querySelectorAll('.am-wh__action'));
      expect(actions.map((b) => b.textContent!.trim())).toEqual(['اعتماد الاقتراح', 'الإبقاء على الاختيار']);
      expect(actions.map((b) => b.getAttribute('aria-label'))).toEqual(['اعتماد الاقتراح: Sara Al-Mutairi', 'الإبقاء على الاختيار: Nora Al-Otaibi']);
    });

    // The other person's clause explains the pick by a number on screen.
    const clauses: ReadonlyArray<readonly ['en' | 'ar', number, number, boolean, string]> = [
      ['en', 2, 0, true, 'Sara Al-Mutairi (Quality Officer) has 4 open, nothing due within 2 working days.'],
      ['en', 0, 0, true, 'Sara Al-Mutairi (Quality Officer) has 4 open, none overdue or due within 2 working days.'],
      ['en', 0, 0, false, 'Sara Al-Mutairi (Quality Officer) has 4 open, none overdue.'],
      ['en', 1, 2, true, 'Sara Al-Mutairi (Quality Officer) has 4 open.'],
      ['ar', 0, 0, true, 'لدى Sara Al-Mutairi (مسؤول الجودة) 4 مهام مفتوحة، ولا شيء متأخر أو مستحق خلال يومي عمل.'],
      ['ar', 2, 0, true, 'لدى Sara Al-Mutairi (مسؤول الجودة) 4 مهام مفتوحة، ولا شيء مستحق خلال يومي عمل.'],
      ['ar', 1, 2, true, 'لدى Sara Al-Mutairi (مسؤول الجودة) 4 مهام مفتوحة.'],
    ];
    for (const [language, overdue, dueSoon, seen, expected] of clauses) {
    it(`[${language}] overdue ${overdue}, due soon ${dueSoon}, due-soon seen ${seen} → "${expected}"`, () => {
      const { group, el, render } = setup({ language });
      choosePosition(group());
      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: true });
      render();
      button(el(), '.am-wh__suggest').click();
      press().flush({ ...HINT, suggestion: { ...HINT.suggestion, overdueCount: overdue, dueSoonCount: dueSoon }, dueSoonSeen: seen });
      render();
      expect(text(el(), '.am-wh__text').endsWith(expected)).withContext(text(el(), '.am-wh__text')).toBe(true);
    });
    }

    it('Assign … instead sets Person, tells the host, and offers nothing for the new person', () => {
      const { group, el, render, host } = setup();
      choosePosition(group());
      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: true });
      render();
      button(el(), '.am-wh__suggest').click();
      press().flush(HINT);
      render();
      button(el(), '.am-wh__action').click();
      render();
      expect(group().controls.userId.value).toBe('sara');
      expect(host.followed).toEqual([{ id: 'log-7', userId: 'sara' }]);
      expect(text(el(), '.am-picker__outcome')).toBe('Goes to Sara Al-Mutairi.');
      expect(el().querySelector('app-task-workload-hint')).toBeNull();
      // What the dialog will send on save, while Sara is still the one chosen.
      expect(followedHint(host.followed[0]!, toAssignTarget(group(), 'cmt-1'))).toEqual({ id: 'log-7' });
    });

    it('Keep … returns the plain outcome with the button; a second press shows the kept answer and costs nothing', () => {
      const { group, el, render } = setup();
      choosePosition(group());
      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: true });
      render();
      button(el(), '.am-wh__suggest').click();
      press().flush(HINT);
      render();
      Array.from(el().querySelectorAll<HTMLButtonElement>('.am-wh__action'))[1]!.click();
      render();
      expect([text(el(), '.am-wh__outcome'), text(el(), '.am-wh__suggest')]).toEqual(['Goes to Nora Al-Otaibi.', '✦ Suggest someone']);

      button(el(), '.am-wh__suggest').click();
      render();
      http.expectNone({ method: 'POST', url: `${API}/assignment/workload-hint` });
      expect(text(el(), '.am-wh__text')).toContain('Sara Al-Mutairi (Quality Officer) has 4 open, none overdue.');
    });

    it('the answer is kept for the DIALOG: the picker rebuilt (a step switch) still costs nothing', () => {
      const { group, el, render, host } = setup();
      choosePosition(group());
      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: true });
      render();
      button(el(), '.am-wh__suggest').click();
      press().flush(HINT);
      render();

      host.shown.set(false);
      render();
      host.shown.set(true);
      render();
      // The rebuilt picker reloads its lists for the choice in progress.
      http.expectOne(`${API}/assignment/units`).flush([{ id: 'unit-1', parentId: null, nameEn: 'Cardiology', nameAr: null }]);
      http.expectOne((r) => r.url === `${API}/assignment/positions`).flush([
        { id: 'pos-qo', nameEn: 'Quality Officer', nameAr: null, isSingleAssignee: false, holderCount: 3 },
      ]);
      http.expectOne((r) => r.url === `${API}/assignees`).flush(
        PEOPLE.map((p) => ({ id: p.id, name: p.name, positionNameEn: 'Quality Officer', positionNameAr: null, workload: { openCount: p.open, overdueCount: p.overdue, canSuggest: p.canSuggest } })),
      );
      render();
      // Availability was already known for the dialog: not asked again.
      button(el(), '.am-wh__suggest').click();
      render();
      http.expectNone({ method: 'POST', url: `${API}/assignment/workload-hint` });
      expect(el().querySelector('.am-wh--ai')).not.toBeNull();
    });

    it('a committee role sends the committee and the role, never a unit', () => {
      const { group, el, render } = setup();
      group().controls.scope.setValue(COMMITTEE_SCOPE);
      http.expectOne((r) => r.url === `${API}/assignment/committee-roles`).flush([{ id: 'role-m', labelEn: 'Member', labelAr: null, memberCount: 3 }]);
      group().controls.target.setValue('role-m');
      const people = http.expectOne((r) => r.url === `${API}/assignees/committee`);
      expect(people.request.params.get('sourceId')).toBe('cmt-1');
      people.flush(PEOPLE.map((p) => ({ id: p.id, name: p.name, positionNameEn: null, positionNameAr: null, workload: { openCount: p.open, overdueCount: p.overdue, canSuggest: p.canSuggest } })));
      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: true });
      render();
      button(el(), '.am-wh__suggest').click();
      const req = press();
      expect(req.request.body).toEqual(jasmine.objectContaining({ committeeId: 'cmt-1', roleValueId: 'role-m', chosenUserId: 'nora' }));
      expect(req.request.body.orgUnitId).toBeUndefined();
      req.flush({ ...HINT, suggestion: { ...HINT.suggestion, positionNameEn: null, positionNameAr: null } });
      render();
      expect(text(el(), '.am-wh__text')).toContain('Sara Al-Mutairi has 4 open, none overdue.');
    });

    describe('refusals, worded by code', () => {
      function pressed(language: 'en' | 'ar' = 'en') {
        const ctx = setup({ language });
        choosePosition(ctx.group());
        ctx.group().controls.userId.setValue('nora');
        ctx.render();
        availability().flush({ available: true });
        ctx.render();
        button(ctx.el(), '.am-wh__suggest').click();
        return ctx;
      }

      it('"nobody is clearly better placed": said, kept — a second press costs nothing', () => {
        const { el, render } = pressed();
        press().flush({ statusCode: 409, message: 'x', code: 'WORKLOAD_NO_SUGGESTION' }, { status: 409, statusText: 'Conflict' });
        render();
        expect(text(el(), '.am-wh__refusal')).toBe('Nobody here is clearly better placed to take it.');
        expect(text(el(), '.am-wh__refusal')).not.toContain('No credits');
      });

      it('credits used up: the shared sentence with its date, and no Try again', () => {
        const { el, render } = pressed();
        press().flush({ statusCode: 409, message: 'x', code: 'AI_CREDITS_EXHAUSTED', renewsAt: '2026-10-21T00:00:00.000Z' }, { status: 409, statusText: 'Conflict' });
        render();
        expect(text(el(), '.am-wh__refusal')).toContain('21 Oct 2026');
        expect(el().querySelector('.am-wh__refusal .am-wh__action')).toBeNull();
      });

      it('a failed call: the shared sentence with Try again, which calls again (a failure is not kept)', () => {
        const { el, render } = pressed();
        press().flush({ statusCode: 502, message: 'x', code: 'AI_PROVIDER_FAILED' }, { status: 502, statusText: 'Bad Gateway' });
        render();
        expect(el().querySelector('.am-wh__refusal--failed')).not.toBeNull();
        button(el(), '.am-wh__refusal .am-wh__action').click();
        render();
        press().flush(HINT);
        render();
        expect(el().querySelector('.am-wh--ai')).not.toBeNull();
      });

      it('too many presses: its own words', () => {
        const { el, render } = pressed();
        press().flush({ statusCode: 429, message: 'x', code: 'RATE_LIMITED', retryAfterSeconds: 30 }, { status: 429, statusText: 'Too Many Requests' });
        render();
        expect(text(el(), '.am-wh__refusal')).toBe("That's a lot of suggestions in one minute. Wait a moment, then try again.");
      });
    });

    it('Reassign (stacked): the answer\'s actions follow its text, and the person field carries no second outcome', () => {
      const { group, el, render } = setup({ layout: 'stacked' });
      choosePosition(group());
      group().controls.userId.setValue('nora');
      render();
      availability().flush({ available: true });
      render();
      button(el(), '.am-wh__suggest').click();
      press().flush(HINT);
      render();
      expect(el().querySelector('.am-wh__text .am-wh__actions--inline')).not.toBeNull();
      expect(el().querySelector('.am-picker__person .am-hint, .am-picker__person small')?.textContent?.trim() ?? '').not.toContain('Goes to');
    });
  });
});

describe('followedHint (ACC-199)', () => {
  const followed = { id: 'log-7', userId: 'sara' };
  it('is sent only while the person it named is still the one chosen', () => {
    expect(followedHint(followed, { kind: 'POSITION', orgUnitId: 'u', positionId: 'p', userId: 'sara' })).toEqual({ id: 'log-7' });
    expect(followedHint(followed, { kind: 'POSITION', orgUnitId: 'u', positionId: 'p', userId: 'khalid' })).toBeNull();
    expect(followedHint(followed, { kind: 'POSITION', orgUnitId: 'u', positionId: 'p' })).toBeNull();
    expect(followedHint(null, { kind: 'POSITION', orgUnitId: 'u', positionId: 'p', userId: 'sara' })).toBeNull();
    expect(followedHint(followed, null)).toBeNull();
  });
});
