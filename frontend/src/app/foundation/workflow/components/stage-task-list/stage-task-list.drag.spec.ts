import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { StageTaskDefinitionListItemDto, WorkflowStageDto, WorkflowTemplateDto } from '../../services/workflow-template.service';
import { StageTaskListComponent } from './stage-task-list.component';

// ACC-212 — the drag handle on each "Tasks on entry" row (drawing section 1):
// a pointer drag through Angular CDK, and keyboard pick-up on the same handle
// (Space lifts, the arrows move, Space drops, Escape puts it back), announced in
// the one live line, focus following the row. Both save through the existing
// order endpoint; a failed save puts the rows back and says so.

const API = `${environment.apiUrl}/workflow-templates`;
const ORDER = `${API}/stages/stage-1/task-definitions/order`;
const LIST = `${API}/stages/stage-1/task-definitions`;

const STAGE: WorkflowStageDto = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Terms Review',
  nameAr: 'مراجعة الشروط',
  description: null,
  order: 20,
  slaWorkingHours: 40,
  isInitial: false,
  isFinal: false,
  escalationConfig: null,
};

const TEMPLATE: WorkflowTemplateDto = {
  id: 'template-1',
  organizationId: 'org',
  nameEn: 'Committee Management',
  nameAr: null,
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  recordRoutes: { unit: true, committee: true },
  taskDueHours: { LOW: 80, MEDIUM: 40, HIGH: 16, CRITICAL: 4 },
};

function definition(id: string, titleEn: string, titleAr: string): StageTaskDefinitionListItemDto {
  return {
    id,
    stageId: 'stage-1',
    order: 10,
    titleEn,
    titleAr,
    description: null,
    isMandatory: true,
    requiresEvidence: false,
    priority: 'HIGH',
    assignKind: 'POSITION',
    orgUnitId: 'unit-1',
    positionId: 'pos-1',
    userId: null,
    committeeId: null,
    committeeRoleValueId: null,
    orgUnit: { id: 'unit-1', nameEn: 'Cardiology', nameAr: 'أمراض القلب' },
    position: { id: 'pos-1', nameEn: 'Quality Officer', nameAr: 'مسؤول الجودة' },
    user: null,
    committee: null,
    committeeRole: null,
    dueAfterHours: 16,
    createdAt: '',
    updatedAt: '',
    warning: null,
    createdTaskCount: 0,
  };
}

const THREE = [
  definition('def-1', 'Interview the staff involved', 'مقابلة الموظفين المعنيين'),
  definition('def-2', 'Collect the records', 'جمع السجلات'),
  definition('def-3', 'Inform the committee', 'إبلاغ اللجنة'),
];

@Component({
  standalone: true,
  imports: [StageTaskListComponent],
  template: `<div style="width: 760px"><app-stage-task-list [stage]="stage()" [template]="template" [canManage]="canManage()" /></div>`,
})
class HostComponent {
  readonly stage = signal(STAGE);
  readonly canManage = signal(true);
  readonly template = TEMPLATE;
}

describe('StageTaskListComponent — drag and keyboard pick-up (ACC-212)', () => {
  // The pointer drags read the rows' boxes, so they measure in the real font.
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();

  let http: HttpTestingController;
  let fixture: ComponentFixture<HostComponent>;

  async function setup(language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    http.expectOne(LIST).flush(THREE);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const order = () => Array.from(el.querySelectorAll<HTMLElement>('[data-stage-task]')).map((r) => r.getAttribute('data-stage-task'));
    const handle = (id: string) => el.querySelector<HTMLButtonElement>(`[data-handle="${id}"] button`)!;
    const announced = () => el.querySelector('[data-stage-tasks-announcement]')?.textContent?.trim() ?? '';
    const error = () => el.querySelector('.am-stage-tasks__action-error')?.textContent?.trim() ?? null;
    return { el, order, handle, announced, error };
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    fixture.detectChanges();
  }

  function key(target: HTMLElement, k: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }

  /** A real pointer drag through the CDK: press on the handle, move in steps, release. */
  async function dragBy(handle: HTMLElement, dy: number): Promise<void> {
    const r = handle.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const mouse = (type: string, clientY: number) =>
      new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY, button: 0, buttons: 1, detail: 1, view: window });
    handle.dispatchEvent(mouse('mousedown', y));
    for (let step = 1; step <= 10; step++) {
      document.dispatchEvent(mouse('mousemove', y + (dy * step) / 10));
      fixture.detectChanges();
    }
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    document.dispatchEvent(mouse('mouseup', y + dy));
    await settle();
  }

  afterEach(() => {
    http.verify();
    fixture?.destroy();
    TestBed.resetTestingModule();
    document.documentElement.dir = 'ltr';
  });

  it('each row has a named handle (non-vacuity: three rows, three handles)', async () => {
    const { el, handle } = await setup();
    expect(el.querySelectorAll('[data-handle] button').length).toBe(3);
    expect(handle('def-2').getAttribute('aria-label')).toBe('Reorder task 2: Collect the records');
    expect(handle('def-2').tagName).toBe('BUTTON');
  });

  describe('a pointer drag', () => {
    it('moves the row, saves the new order through the order endpoint, and announces it', async () => {
      const { order, handle, announced } = await setup();
      const rowHeight = handle('def-1').closest('li')!.getBoundingClientRect().height;
      await dragBy(handle('def-1'), rowHeight * 1.6);

      const req = http.expectOne(ORDER);
      expect(req.request.body).toEqual({ ids: ['def-2', 'def-1', 'def-3'] });
      expect(order()).withContext('shown at once, before the save answers').toEqual(['def-2', 'def-1', 'def-3']);
      req.flush([THREE[1], THREE[0], THREE[2]]);
      await settle();
      expect(order()).toEqual(['def-2', 'def-1', 'def-3']);
      expect(announced()).toBe('“Interview the staff involved” moved to position 2 of 3');
    });

    it('in Arabic, right to left: the drag works, and its preview stays inside the list, so it inherits the direction', async () => {
      const { el, order, handle } = await setup('ar');
      const list = el.querySelector<HTMLElement>('[data-stage-tasks-list]')!;
      expect(getComputedStyle(list).direction).toBe('rtl');
      const rowHeight = handle('def-3').closest('li')!.getBoundingClientRect().height;

      // Mid-drag: the preview is a child of the list.
      const h = handle('def-3');
      const r = h.getBoundingClientRect();
      const mouse = (type: string, clientY: number) =>
        new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY, button: 0, buttons: 1, detail: 1, view: window });
      const y = r.top + r.height / 2;
      h.dispatchEvent(mouse('mousedown', y));
      for (let step = 1; step <= 10; step++) {
        document.dispatchEvent(mouse('mousemove', y - (rowHeight * 2.6 * step) / 10));
        fixture.detectChanges();
      }
      const preview = document.querySelector<HTMLElement>('.cdk-drag-preview');
      expect(preview).withContext('a drag is under way').not.toBeNull();
      expect(list.contains(preview)).withContext('the preview is inside the list').toBeTrue();
      expect(getComputedStyle(preview!).direction).toBe('rtl');
      document.dispatchEvent(mouse('mouseup', y - rowHeight * 2.6));
      await settle();

      const req = http.expectOne(ORDER);
      expect(req.request.body).toEqual({ ids: ['def-3', 'def-1', 'def-2'] });
      req.flush([THREE[2], THREE[0], THREE[1]]);
      await settle();
      expect(order()).toEqual(['def-3', 'def-1', 'def-2']);
    });
  });

  describe('keyboard pick-up on the handle', () => {
    it('Space lifts, ↓ moves (shown, not saved), Space drops and saves; each step announced; focus follows the row', async () => {
      const { order, handle, announced } = await setup();
      handle('def-1').focus();

      key(handle('def-1'), ' ');
      await settle();
      expect(handle('def-1').getAttribute('aria-pressed')).toBe('true');
      expect(announced()).toBe('“Interview the staff involved” picked up, position 1 of 3');

      key(handle('def-1'), 'ArrowDown');
      await settle();
      expect(order()).toEqual(['def-2', 'def-1', 'def-3']);
      expect(announced()).toBe('“Interview the staff involved”, position 2 of 3');
      expect(document.activeElement).withContext('focus follows the row').toBe(handle('def-1'));
      http.expectNone(ORDER);

      key(handle('def-1'), ' ');
      const req = http.expectOne(ORDER);
      expect(req.request.body).toEqual({ ids: ['def-2', 'def-1', 'def-3'] });
      req.flush([THREE[1], THREE[0], THREE[2]]);
      await settle();
      expect(handle('def-1').getAttribute('aria-pressed')).toBe('false');
      expect(announced()).toBe('“Interview the staff involved” moved to position 2 of 3');
      expect(document.activeElement).toBe(handle('def-1'));
    });

    it('in Arabic, the same keys move the row, and the announcement is Arabic', async () => {
      const { order, handle, announced } = await setup('ar');
      handle('def-2').focus();
      key(handle('def-2'), ' ');
      await settle();
      expect(announced()).toContain('التُقطت «جمع السجلات»، الموضع 2 من 3');
      key(handle('def-2'), 'ArrowUp');
      await settle();
      expect(order()).toEqual(['def-2', 'def-1', 'def-3']);
      key(handle('def-2'), ' ');
      http.expectOne(ORDER).flush([THREE[1], THREE[0], THREE[2]]);
      await settle();
      expect(announced()).toBe('نُقلت «جمع السجلات» إلى الموضع 1 من 3');
    });

    it('Escape puts the row back where it was, saves nothing, and says so', async () => {
      const { order, handle, announced } = await setup();
      handle('def-1').focus();
      key(handle('def-1'), ' ');
      await settle();
      key(handle('def-1'), 'ArrowDown');
      await settle();
      key(handle('def-1'), 'ArrowDown');
      await settle();
      expect(order()).toEqual(['def-2', 'def-3', 'def-1']);

      key(handle('def-1'), 'Escape');
      await settle();
      expect(order()).toEqual(['def-1', 'def-2', 'def-3']);
      expect(announced()).toBe('Reorder cancelled. “Interview the staff involved” is back at position 1 of 3');
      expect(handle('def-1').getAttribute('aria-pressed')).toBe('false');
      expect(document.activeElement).toBe(handle('def-1'));
      http.expectNone(ORDER);
    });

    it('a drop where it started saves nothing and says the row stays', async () => {
      const { handle, announced } = await setup();
      handle('def-2').focus();
      key(handle('def-2'), ' ');
      await settle();
      key(handle('def-2'), ' ');
      await settle();
      http.expectNone(ORDER);
      expect(announced()).toBe('“Collect the records” stays at position 2 of 3');
    });

    it('the arrows, Edit and Delete wait while a row is lifted', async () => {
      const { el, handle } = await setup();
      handle('def-1').focus();
      key(handle('def-1'), ' ');
      await settle();
      const arrow = el.querySelector<HTMLButtonElement>('[data-move="def-2:up"] button')!;
      expect(arrow.disabled).toBeTrue();
      key(handle('def-1'), 'Escape');
      await settle();
      expect(arrow.disabled).toBeFalse();
    });
  });

  describe('a failed save', () => {
    it('puts the rows back as they were and says so, without re-reading the list', async () => {
      const { order, handle, announced, error } = await setup();
      handle('def-3').focus();
      key(handle('def-3'), ' ');
      await settle();
      key(handle('def-3'), 'ArrowUp');
      await settle();
      key(handle('def-3'), ' ');
      expect(order()).withContext('shown before the save answers').toEqual(['def-1', 'def-3', 'def-2']);
      http.expectOne(ORDER).flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
      await settle();

      expect(order()).toEqual(['def-1', 'def-2', 'def-3']);
      expect(error()).toBe('The new order couldn’t be saved. The tasks are back in their previous order.');
      expect(announced()).toBe('The new order couldn’t be saved. The tasks are back in their previous order.');
      http.expectNone(LIST);
    });

    it('after a pointer drag too', async () => {
      const { order, handle, error } = await setup();
      const rowHeight = handle('def-1').closest('li')!.getBoundingClientRect().height;
      await dragBy(handle('def-1'), rowHeight * 1.6);
      http.expectOne(ORDER).flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
      await settle();
      expect(order()).toEqual(['def-1', 'def-2', 'def-3']);
      expect(error()).toBe('The new order couldn’t be saved. The tasks are back in their previous order.');
    });

    it('a list someone else changed is re-read, as the arrows do', async () => {
      const { order, handle, error } = await setup();
      handle('def-1').focus();
      key(handle('def-1'), ' ');
      await settle();
      key(handle('def-1'), 'ArrowDown');
      await settle();
      key(handle('def-1'), ' ');
      http
        .expectOne(ORDER)
        .flush({ statusCode: 400, code: 'STAGE_TASK_ORDER_MISMATCH', message: 'x' }, { status: 400, statusText: 'Bad Request' });
      http.expectOne(LIST).flush(THREE.slice(0, 2));
      await settle();
      expect(order()).toEqual(['def-1', 'def-2']);
      expect(error()).toBe('Someone else changed this list, so it has been reloaded.');
    });
  });

  it('leaving the lifted handle (Tab away) puts the row back, unsaved', async () => {
    const { order, handle } = await setup();
    handle('def-1').focus();
    key(handle('def-1'), ' ');
    await settle();
    key(handle('def-1'), 'ArrowDown');
    await settle();
    expect(order()).toEqual(['def-2', 'def-1', 'def-3']);
    handle('def-1').blur();
    await settle();
    expect(order()).toEqual(['def-1', 'def-2', 'def-3']);
    expect(handle('def-1').getAttribute('aria-pressed')).toBe('false');
    http.expectNone(ORDER);
  });

  // ── P188 review fixes ────────────────────────────────────────────────────

  describe('P188 review fixes', () => {
    it('Enter drops a lifted row, and saves', async () => {
      const { handle } = await setup();
      handle('def-1').focus();
      key(handle('def-1'), ' ');
      await settle();
      key(handle('def-1'), 'ArrowDown');
      await settle();
      key(handle('def-1'), 'Enter');
      const req = http.expectOne(ORDER);
      expect(req.request.body).toEqual({ ids: ['def-2', 'def-1', 'def-3'] });
      req.flush([THREE[1], THREE[0], THREE[2]]);
      await settle();
      expect(handle('def-1').getAttribute('aria-pressed')).toBe('false');
    });

    it('the keys are described by the hint only while nothing is lifted, and the pick-up says only the position', async () => {
      const { el, handle, announced } = await setup();
      const hint = handle('def-1').getAttribute('aria-describedby')!;
      expect(el.querySelector('#' + hint)?.textContent?.trim()).toBe(
        'Space picks it up, the arrow keys move it, Space drops it, Escape cancels.',
      );
      handle('def-1').focus();
      key(handle('def-1'), ' ');
      await settle();
      expect(handle('def-1').hasAttribute('aria-describedby')).withContext('no hint while lifted').toBeFalse();
      expect(announced()).toBe('“Interview the staff involved” picked up, position 1 of 3');
      expect(announced()).not.toContain('Space');
      key(handle('def-1'), 'Escape');
      await settle();
      expect(handle('def-1').getAttribute('aria-describedby')).withContext('the hint is back').toBe(hint);
    });

    for (const how of ['keyboard', 'pointer'] as const) {
      it(`a list someone else changed: after the re-read, focus is on the moved row's handle (${how}), never the page body`, async () => {
        const { order, handle } = await setup();
        handle('def-1').focus();
        if (how === 'keyboard') {
          key(handle('def-1'), ' ');
          await settle();
          key(handle('def-1'), 'ArrowDown');
          await settle();
          key(handle('def-1'), ' ');
        } else {
          await dragBy(handle('def-1'), handle('def-1').closest('li')!.getBoundingClientRect().height * 1.6);
        }
        http
          .expectOne(ORDER)
          .flush({ statusCode: 400, code: 'STAGE_TASK_ORDER_MISMATCH', message: 'x' }, { status: 400, statusText: 'Bad Request' });
        await settle();
        http.expectOne(LIST).flush([THREE[2], THREE[0]]);
        await settle();
        expect(order()).toEqual(['def-3', 'def-1']);
        expect(document.activeElement).withContext('focus on the moved row').toBe(handle('def-1'));
      });
    }

    it('a list re-read WITHOUT the moved row: focus goes to the list, never the page body', async () => {
      const { el, handle } = await setup();
      handle('def-1').focus();
      key(handle('def-1'), ' ');
      await settle();
      key(handle('def-1'), 'ArrowDown');
      await settle();
      key(handle('def-1'), ' ');
      http
        .expectOne(ORDER)
        .flush({ statusCode: 400, code: 'STAGE_TASK_ORDER_MISMATCH', message: 'x' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      http.expectOne(LIST).flush([THREE[1], THREE[2]]);
      await settle();
      expect(document.activeElement).toBe(el.querySelector('[data-stage-tasks-list]'));
    });

    it('a drag refused for another reason says the same refusal the arrows say', async () => {
      const { order, handle, error, announced } = await setup();
      await dragBy(handle('def-1'), handle('def-1').closest('li')!.getBoundingClientRect().height * 1.6);
      http.expectOne(ORDER).flush(
        { statusCode: 409, code: 'WORKFLOW_TEMPLATE_PROTECTED', edit: 'STAGE_TASKS', message: 'x' },
        { status: 409, statusText: 'Conflict' },
      );
      await settle();
      const said = 'Tasks cannot be added to the committee change request workflow' + "'" + 's stages: its moves are made by the request itself.';
      expect(error()).toBe(said);
      expect(announced()).toBe(said);
      expect(order()).withContext('put back').toEqual(['def-1', 'def-2', 'def-3']);
      http.expectNone(LIST);
    });

    it('a lifted row is put back when the viewer can no longer reorder', async () => {
      const { order, handle } = await setup();
      handle('def-1').focus();
      key(handle('def-1'), ' ');
      await settle();
      key(handle('def-1'), 'ArrowDown');
      await settle();
      expect(order()).toEqual(['def-2', 'def-1', 'def-3']);
      fixture.componentInstance.canManage.set(false);
      await settle();
      expect(order()).toEqual(['def-1', 'def-2', 'def-3']);
      http.expectNone(ORDER);
    });

    it('a lifted row is put back when the stage changes under it', async () => {
      const { order, handle } = await setup();
      handle('def-1').focus();
      key(handle('def-1'), ' ');
      await settle();
      key(handle('def-1'), 'ArrowDown');
      await settle();
      fixture.componentInstance.stage.set({ ...STAGE, slaWorkingHours: 48 });
      await settle();
      expect(order()).toEqual(['def-1', 'def-2', 'def-3']);
      expect(handle('def-1').getAttribute('aria-pressed')).toBe('false');
      http.expectNone(ORDER);
    });

    it('the drag preview carries the strong border on every side (no tie lost to the list row rule)', async () => {
      const { el, handle } = await setup();
      const h = handle('def-1');
      const r = h.getBoundingClientRect();
      const y = r.top + r.height / 2;
      const mouse = (type: string, clientY: number) =>
        new MouseEvent(type, { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY, button: 0, buttons: 1, detail: 1, view: window });
      h.dispatchEvent(mouse('mousedown', y));
      for (let step = 1; step <= 5; step++) {
        document.dispatchEvent(mouse('mousemove', y + step * 6));
        fixture.detectChanges();
      }
      const preview = el.querySelector<HTMLElement>('.cdk-drag-preview')!;
      expect(preview).withContext('a drag is under way').not.toBeNull();
      const probe = document.createElement('span');
      probe.style.color = 'var(--am-border-strong)';
      document.body.appendChild(probe);
      const strong = getComputedStyle(probe).color;
      probe.remove();
      const cs = getComputedStyle(preview);
      expect([cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor]).toEqual([strong, strong, strong, strong]);
      expect(cs.borderBottomWidth).toBe(cs.borderTopWidth);
      document.dispatchEvent(mouse('mouseup', y));
      await settle();
    });
  });
});
