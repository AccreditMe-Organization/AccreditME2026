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
import {
  AssignGroup,
  COMMITTEE_SCOPE,
  TaskAssigneePickerComponent,
  createAssignGroup,
  toAssignTarget,
} from './task-assignee-picker.component';

// ACC-167 — the shared assignment picker. What is proven here: the outcome
// line states the server's rule for the current choice, a change empties
// what depended on it, a choice survives the picker being recreated, and the
// committee route appears only where it can work.

const API = `${environment.apiUrl}/tasks`;

@Component({
  standalone: true,
  imports: [TaskAssigneePickerComponent],
  template: `
    @if (shown()) {
      <app-task-assignee-picker
        [group]="group"
        [sourceType]="sourceType()"
        [sourceId]="sourceId()"
        [required]="required()"
      />
    }
  `,
})
class HostComponent {
  readonly shown = signal(true);
  readonly sourceType = signal<string | null>(null);
  readonly sourceId = signal<string | null>(null);
  readonly required = signal(false);
  group: AssignGroup = createAssignGroup(false);
}

describe('TaskAssigneePickerComponent (ACC-167)', () => {
  let http: HttpTestingController;

  function setup(
    options: { language?: 'en' | 'ar'; committee?: boolean; permissions?: string[]; required?: boolean } = {},
  ) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => (options.permissions ?? []).includes(p) },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(options.language ?? 'en');
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(HostComponent);
    if (options.committee) {
      fixture.componentInstance.sourceType.set('COMMITTEE');
      fixture.componentInstance.sourceId.set('committee-1');
    }
    if (options.required) {
      fixture.componentInstance.required.set(true);
      fixture.componentInstance.group = createAssignGroup(true);
    }
    fixture.detectChanges();
    http.expectOne(`${API}/assignment/units`).flush([
      { id: 'unit-1', parentId: null, nameEn: 'Pharmacy', nameAr: 'الصيدلية' },
      // Its parent is inactive, so not in the list: it must still be offered.
      { id: 'unit-2', parentId: 'unit-gone', nameEn: 'Night Pharmacy', nameAr: null },
    ]);
    fixture.detectChanges();
    const picker = () =>
      fixture.debugElement.query(By.directive(TaskAssigneePickerComponent))
        .componentInstance as TaskAssigneePickerComponent;
    return { fixture, picker, group: () => fixture.componentInstance.group };
  }

  function choose(
    group: AssignGroup,
    position: { isSingleAssignee: boolean; holderCount: number },
    holders: { id: string; name: string }[],
  ): void {
    group.controls.scope.setValue('unit-1');
    http
      .expectOne((r) => r.url === `${API}/assignment/positions`)
      .flush([{ id: 'pos-1', nameEn: 'Pharmacist', nameAr: null, ...position }]);
    group.controls.target.setValue('pos-1');
    http
      .expectOne((r) => r.url === `${API}/assignees`)
      .flush(holders.map((h) => ({ ...h, positionNameEn: 'Pharmacist', positionNameAr: null })));
  }

  afterEach(() => http.verify());

  describe('the outcome line', () => {
    it('says the task is created unassigned when nothing is chosen and nothing is required', () => {
      const { picker } = setup();
      expect(picker().outcome()).toBe('Nobody yet — the task is created unassigned.');
    });

    it('says nothing when a choice is required and none is made yet', () => {
      const { picker } = setup({ required: true });
      expect(picker().outcome()).toBe('');
    });

    it('describes a pool of several holders', () => {
      const { picker, group } = setup();
      choose(group(), { isSingleAssignee: false, holderCount: 3 }, []);
      expect(picker().outcome()).toBe('Goes to a pool of 3 — whoever picks it up first takes it.');
    });

    it('describes it with the Arabic plural form', () => {
      const { picker, group } = setup({ language: 'ar' });
      choose(group(), { isSingleAssignee: false, holderCount: 2 }, []);
      expect(picker().outcome()).toBe('تذهب إلى مجموعة من شخصين — من يستلمها أولًا يتولاها.');
    });

    it('names the holder of a single-holder position', () => {
      const { picker, group } = setup();
      choose(group(), { isSingleAssignee: true, holderCount: 1 }, [{ id: 'u1', name: 'Huda' }]);
      expect(picker().outcome()).toBe('Goes to Huda.');
    });

    it('says a vacant single-holder position leaves the task waiting, unassigned', () => {
      const { picker, group } = setup();
      choose(group(), { isSingleAssignee: true, holderCount: 0 }, []);
      expect(picker().outcome()).toBe(
        'Nobody holds this position here yet. The task waits, unassigned, until someone does.',
      );
    });

    it('says a pool nobody is in cannot be picked up', () => {
      const { picker, group } = setup();
      choose(group(), { isSingleAssignee: false, holderCount: 0 }, []);
      expect(picker().outcome()).toBe('Goes to a pool nobody is in yet. Nobody can pick it up until someone joins.');
    });

    it('names the chosen person', () => {
      const { picker, group } = setup();
      choose(group(), { isSingleAssignee: false, holderCount: 2 }, [
        { id: 'u1', name: 'Huda' },
        { id: 'u2', name: 'Omar' },
      ]);
      group().controls.userId.setValue('u2');
      expect(picker().outcome()).toBe('Goes to Omar.');
    });
  });

  it('empties the position and person when the unit changes', () => {
    const { group } = setup();
    choose(group(), { isSingleAssignee: false, holderCount: 2 }, [{ id: 'u1', name: 'Huda' }]);
    group().controls.userId.setValue('u1');

    group().controls.scope.setValue('unit-2');
    http.expectOne((r) => r.url === `${API}/assignment/positions`).flush([]);

    expect(group().controls.target.value).toBeNull();
    expect(group().controls.userId.value).toBeNull();
    expect(group().controls.target.hasError('required')).toBe(true);
  });

  // New task destroys the picker on step 2 and the date view, then brings it
  // back with the same group: the choice must still be there.
  it('keeps a choice in progress when it is recreated, and reloads its lists', () => {
    const { fixture, group } = setup();
    choose(group(), { isSingleAssignee: false, holderCount: 2 }, [{ id: 'u1', name: 'Huda' }]);
    group().controls.userId.setValue('u1');

    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();
    fixture.componentInstance.shown.set(true);
    fixture.detectChanges();
    http.expectOne(`${API}/assignment/units`).flush([]);
    http.expectOne((r) => r.url === `${API}/assignment/positions`).flush([]);
    http.expectOne((r) => r.url === `${API}/assignees`).flush([]);

    expect(group().getRawValue()).toEqual({ scope: 'unit-1', target: 'pos-1', userId: 'u1' });
  });

  it('offers a unit whose parent is inactive as a root, rather than dropping it', () => {
    const { picker } = setup();
    expect(picker().scopeOptions().map((o) => o.value)).toEqual(['unit-1', 'unit-2']);
  });

  describe('the committee route', () => {
    it('is offered first on a committee task, to someone who can see committees', () => {
      const { picker } = setup({ committee: true, permissions: ['committees:view'] });
      expect(picker().scopeOptions()[0]).toEqual({ label: "This task's committee", value: COMMITTEE_SCOPE });
    });

    it('is not offered without committees:view — the server would refuse its roles', () => {
      const { picker } = setup({ committee: true });
      expect(picker().scopeOptions().map((o) => o.value)).not.toContain(COMMITTEE_SCOPE);
    });

    it('is not offered on a task from anywhere else', () => {
      const { picker } = setup({ permissions: ['committees:view'] });
      expect(picker().scopeOptions().map((o) => o.value)).not.toContain(COMMITTEE_SCOPE);
    });

    it('always pools a role unless a member is chosen', () => {
      const { picker, group } = setup({ committee: true, permissions: ['committees:view'] });
      group().controls.scope.setValue(COMMITTEE_SCOPE);
      http
        .expectOne((r) => r.url === `${API}/assignment/committee-roles`)
        .flush([{ id: 'role-sec', labelEn: 'Secretary', labelAr: null, memberCount: 1 }]);
      group().controls.target.setValue('role-sec');
      http.expectOne((r) => r.url === `${API}/assignees/committee`).flush([{ id: 'u1', name: 'Huda' }]);

      expect(picker().outcome()).toBe('Goes to a pool of 1 — they pick it up.');
    });
  });
});

describe('toAssignTarget (ACC-167)', () => {
  const group = (scope: string | null, target: string | null, userId: string | null = null) => {
    const g = createAssignGroup(false);
    g.setValue({ scope, target, userId });
    return g;
  };

  it('is null until a scope and a target are both chosen', () => {
    expect(toAssignTarget(group(null, null), null)).toBeNull();
    expect(toAssignTarget(group('unit-1', null), null)).toBeNull();
  });

  it('builds a position target, with the person only when one is chosen', () => {
    expect(toAssignTarget(group('unit-1', 'pos-1'), null)).toEqual({
      kind: 'POSITION',
      orgUnitId: 'unit-1',
      positionId: 'pos-1',
    });
    expect(toAssignTarget(group('unit-1', 'pos-1', 'u1'), null)).toEqual({
      kind: 'POSITION',
      orgUnitId: 'unit-1',
      positionId: 'pos-1',
      userId: 'u1',
    });
  });

  it('builds a committee role target on the given committee, and nothing without one', () => {
    expect(toAssignTarget(group(COMMITTEE_SCOPE, 'role-sec'), 'committee-1')).toEqual({
      kind: 'COMMITTEE_ROLE',
      committeeId: 'committee-1',
      roleValueId: 'role-sec',
    });
    expect(toAssignTarget(group(COMMITTEE_SCOPE, 'role-sec'), null)).toBeNull();
  });
});
