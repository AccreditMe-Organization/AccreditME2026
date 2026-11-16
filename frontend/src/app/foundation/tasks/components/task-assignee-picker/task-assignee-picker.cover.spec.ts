import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { AssignGroup, TaskAssigneePickerComponent, createAssignGroup } from './task-assignee-picker.component';
import { TaskWorkloadHintStore } from './task-workload-hint.store';

// ACC-302 — the picker renders the server's `cover` and decides nothing from
// it. Plan: backend/Plans/step-302-task-cover-routing.md; the wording is the
// handoff's (step-302-handoff-lane-a.md). Measured against the 420px cap in
// task-cover.layout.spec.ts.

const API = `${environment.apiUrl}/tasks`;

@Component({
  standalone: true,
  imports: [TaskAssigneePickerComponent],
  providers: [TaskWorkloadHintStore],
  template: `
    <app-task-assignee-picker
      [group]="group"
      sourceType="COMMITTEE"
      sourceId="cmt-1"
      [purpose]="purpose()"
      [layout]="layout()"
      priority="HIGH"
    />
  `,
})
class HostComponent {
  readonly purpose = signal<'task' | 'stage-task'>('task');
  readonly layout = signal<'row' | 'stacked' | 'split'>('row');
  group: AssignGroup = createAssignGroup(false);
}

const COVER = { userId: 'cover-1', name: 'Omar Al-Harbi' };
/** Nora is away with a cover, and past the hint's threshold on the record. Sara is not away. */
function people(options: { noraCanSuggest?: boolean; noraCovered?: boolean } = {}) {
  return [
    {
      id: 'nora',
      name: 'Nora Al-Otaibi',
      positionNameEn: 'Quality Officer',
      positionNameAr: 'مسؤول الجودة',
      workload: { openCount: 12, overdueCount: 3, canSuggest: options.noraCanSuggest ?? false },
      cover: options.noraCovered === false ? null : COVER,
    },
    { id: 'sara', name: 'Sara Al-Mutairi', positionNameEn: 'Quality Officer', positionNameAr: 'مسؤول الجودة', workload: { openCount: 4, overdueCount: 0, canSuggest: false }, cover: null },
  ];
}

describe('TaskAssigneePickerComponent — a person out of office (ACC-302)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;

  function setup(options: { language?: 'en' | 'ar'; purpose?: 'task' | 'stage-task'; layout?: 'row' | 'stacked' | 'split' } = {}) {
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
    if (options.purpose) fixture.componentInstance.purpose.set(options.purpose);
    if (options.layout) fixture.componentInstance.layout.set(options.layout);
    fixture.detectChanges();
    http.expectOne(`${API}/assignment/units`).flush([{ id: 'unit-1', parentId: null, nameEn: 'Cardiology', nameAr: 'أمراض القلب' }]);
    fixture.detectChanges();
    const picker = () => fixture.debugElement.query(By.directive(TaskAssigneePickerComponent)).componentInstance as TaskAssigneePickerComponent;
    const store = fixture.debugElement.injector.get(TaskWorkloadHintStore);
    const render = () => {
      fixture.detectChanges();
      fixture.detectChanges();
    };
    return { picker, store, render, el: () => fixture.nativeElement as HTMLElement, group: fixture.componentInstance.group };
  }

  function choose(group: AssignGroup, rows: unknown[], singleHolder = false): void {
    group.controls.scope.setValue('unit-1');
    http.expectOne((r) => r.url === `${API}/assignment/positions`).flush([
      { id: 'pos-qo', nameEn: 'Quality Officer', nameAr: 'مسؤول الجودة', isSingleAssignee: singleHolder, holderCount: rows.length },
    ]);
    group.controls.target.setValue('pos-qo');
    http.expectOne((r) => r.url === `${API}/assignees`).flush(rows);
  }

  describe('the person rows', () => {
    for (const [language, coverLine] of [
      ['en', 'Out of office · goes to Omar Al-Harbi'],
      ['ar', 'خارج المكتب · تُسند إلى Omar Al-Harbi'],
    ] as const) {
      it(`[${language}] a covered person's row says where a new task goes; a row without a cover is unchanged`, () => {
        const { picker, group } = setup({ language });
        choose(group, people());
        const [nora, sara] = picker().peopleOptions();
        expect(nora!.cover).toBe(coverLine);
        expect(sara!.cover).toBeUndefined();
        // The rest of the row is as before: the counts are the person's own.
        expect(nora!.open).toBe(language === 'ar' ? '12 مفتوحة' : '12 open');
      });
    }

    it('a stage task definition shows the cover on the row too (it is true now), with its own outcome line', () => {
      const { picker, group } = setup({ purpose: 'stage-task', layout: 'stacked' });
      choose(group, people());
      expect(picker().peopleOptions()[0]!.cover).toBe('Out of office · goes to Omar Al-Harbi');
      group.controls.userId.setValue('nora');
      // Placed at each entry, not now: the stage task's own sentence, never the cover's.
      expect(picker().outcome()).not.toContain('out of office');
    });
  });

  describe('the outcome line', () => {
    for (const [language, sentence] of [
      ['en', 'Nora Al-Otaibi is out of office. This task will go to Omar Al-Harbi.'],
      ['ar', 'Nora Al-Otaibi خارج المكتب. ستُسنَد هذه المهمة إلى Omar Al-Harbi.'],
    ] as const) {
      it(`[${language}] names both when the person chosen is covered, in every layout`, () => {
        for (const layout of ['row', 'split', 'stacked'] as const) {
          TestBed.resetTestingModule();
          const { picker, group } = setup({ language, layout });
          choose(group, people());
          group.controls.userId.setValue('nora');
          expect(picker().outcome()).withContext(layout).toBe(sentence);
        }
      });
    }

    it("names both for a one-holder position whose holder is covered, with no person chosen", () => {
      const { picker, group } = setup();
      choose(group, [people()[0]], true);
      expect(picker().outcome()).toBe('Nora Al-Otaibi is out of office. This task will go to Omar Al-Harbi.');
    });

    it('is as before for someone not covered', () => {
      const { picker, group } = setup();
      choose(group, people());
      group.controls.userId.setValue('sara');
      expect(picker().outcome()).toBe('Goes to Sara Al-Mutairi.');
    });

    it('renders only what the server sends: no cover in the row, no cover sentence', () => {
      const { picker, group } = setup();
      choose(group, people({ noraCovered: false }));
      group.controls.userId.setValue('nora');
      expect(picker().outcome()).toBe('Goes to Nora Al-Otaibi.');
      expect(picker().peopleOptions()[0]!.cover).toBeUndefined();
    });
  });

  describe('"✦ Suggest someone" for a covered person', () => {
    it('is hidden, and availability is never asked, even if a stale row still said canSuggest', () => {
      const { group, el, render } = setup();
      choose(group, people({ noraCanSuggest: true }));
      group.controls.userId.setValue('nora');
      render();
      http.expectNone(`${API}/assignment/workload-hint/availability`);
      expect(el().querySelector('app-task-workload-hint')).toBeNull();
      expect(el().querySelector('.am-wh__suggest')).toBeNull();
      // The cover sentence is the line shown instead.
      expect(el().querySelector('[data-testid="picker-outcome"]')!.textContent).toContain('is out of office');
    });

    it('never shows an answer already kept for that person', () => {
      const { group, el, render, store } = setup();
      store.available.set(true);
      store.keep('pos-qo|nora', {
        kind: 'hint',
        hint: {
          interactionId: 'log-7',
          chosen: { userId: 'nora', openCount: 12, overdueCount: 3 },
          suggestion: { userId: 'sara', name: 'Sara Al-Mutairi', positionNameEn: null, positionNameAr: null, openCount: 4, overdueCount: 0, dueSoonCount: 0 },
          dueSoonSeen: false,
        },
      });
      choose(group, people({ noraCanSuggest: true }));
      group.controls.userId.setValue('nora');
      render();
      expect(el().querySelector('app-task-workload-hint')).toBeNull();
      expect(el().textContent).not.toContain('Assign instead');
    });
  });

  afterEach(() => http.verify());
});
