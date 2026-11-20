// ACC-316 PR 7c-2 — a move its record's precondition holds (`blockedBy`): drawn
// disabled with "Why?" when the page can say the code (`explains`), pressed as
// before when it can't, and a press the server refuses with an explained code
// (it changed since the read) opens the same reason and reads the moves again.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateNoOpLoader, provideTranslateLoader, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import type { WorkflowInstanceDto, WorkflowMoveDto } from '../../services/workflow.service';
import { WorkflowTransitionActionsComponent, type MoveBlock } from './workflow-transition-actions.component';

const INSTANCE: WorkflowInstanceDto = {
  id: 'instance-1',
  organizationId: 'org-a',
  workflowTemplateId: 'template-1',
  objectType: 'MEETING',
  objectId: 'meeting-1',
  status: 'IN_PROGRESS',
  currentStageId: 'stage-review',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  unassignedTaskWarnings: [],
};
const MOVES_URL = `${environment.apiUrl}/workflows/instances/instance-1/moves`;
const PRESS_URL = `${environment.apiUrl}/workflows/instances/instance-1/transitions`;

const APPROVE: WorkflowMoveDto = {
  id: 't-approve',
  labelEn: 'Approve Minutes',
  labelAr: 'اعتماد المحضر',
  kind: 'ADVANCE',
  toStageId: 'stage-approved',
  toStageNameEn: 'Minutes Approved',
  toStageNameAr: 'المحضر معتمد',
};
const BLOCK: MoveBlock = { code: 'MEETING_SUGGESTION_OPEN', open: 2 };

describe('WorkflowTransitionActionsComponent — held moves (ACC-316 PR 7c-2)', () => {
  let fixture: ComponentFixture<WorkflowTransitionActionsComponent>;
  let component: WorkflowTransitionActionsComponent;
  let http: HttpTestingController;
  let why: jasmine.Spy;

  function setup(move: WorkflowMoveDto, explains: string[]): HTMLElement {
    TestBed.configureTestingModule({
      imports: [WorkflowTransitionActionsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        provideRouter([]),
        ConfirmationService,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowTransitionActionsComponent);
    component = fixture.componentInstance;
    why = jasmine.createSpy('why');
    component.why.subscribe(why);
    fixture.componentRef.setInput('instance', INSTANCE);
    fixture.componentRef.setInput('explains', new Set(explains));
    fixture.detectChanges();
    http.expectOne(MOVES_URL).flush({ transitionIds: [move.id], moves: [move] });
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => http.verify());

  it('a move held for a code the page explains is disabled, with Why? beside it', () => {
    const el = setup({ ...APPROVE, blockedBy: BLOCK }, [BLOCK.code]);
    const held = el.querySelector('[data-move-held="t-approve"]')!;
    expect(held).not.toBeNull();
    expect(held.querySelector<HTMLButtonElement>('button')!.disabled).toBeTrue();
    el.querySelector<HTMLElement>('[data-move-why="t-approve"] button')!.click();
    expect(why).toHaveBeenCalledOnceWith({ move: jasmine.objectContaining({ id: 't-approve' }), blockedBy: BLOCK });
    http.expectNone(PRESS_URL);
  });

  it("a block the page can't explain leaves the move pressable, as before", () => {
    const el = setup({ ...APPROVE, blockedBy: BLOCK }, []);
    expect(el.querySelector('[data-move-held]')).toBeNull();
    expect(el.querySelector<HTMLButtonElement>('button')!.disabled).toBeFalse();
  });

  it('a move with no block is pressed as usual', () => {
    const el = setup({ ...APPROVE, blockedBy: null }, [BLOCK.code]);
    expect(el.querySelector('[data-move-held]')).toBeNull();
    el.querySelector<HTMLElement>('p-button button')!.click();
    http.expectOne(PRESS_URL).flush({ ...INSTANCE });
  });

  it('a press refused with an explained code (held since the read) says why and reads the moves again', () => {
    const el = setup({ ...APPROVE, blockedBy: null }, [BLOCK.code]);
    el.querySelector<HTMLElement>('p-button button')!.click();
    http.expectOne(PRESS_URL).flush({ statusCode: 409, message: 'x', code: BLOCK.code, open: 2 }, { status: 409, statusText: 'Conflict' });
    expect(why).toHaveBeenCalledTimes(1);
    expect(why.calls.mostRecent().args[0].blockedBy).toEqual(jasmine.objectContaining({ code: BLOCK.code, open: 2 }));
    expect(component.error()).toBeNull();
    // The moves are read again, so the button now shows held.
    http.expectOne(MOVES_URL).flush({ transitionIds: [APPROVE.id], moves: [{ ...APPROVE, blockedBy: BLOCK }] });
    fixture.detectChanges();
    expect(el.querySelector('[data-move-held="t-approve"]')).not.toBeNull();
  });

  it('a refusal with a code the page does not explain is said as before', () => {
    const el = setup({ ...APPROVE, blockedBy: null }, [BLOCK.code]);
    el.querySelector<HTMLElement>('p-button button')!.click();
    http.expectOne(PRESS_URL).flush({ statusCode: 403, message: 'x', code: 'NOT_IN_STAGE_POOL' }, { status: 403, statusText: 'Forbidden' });
    expect(why).not.toHaveBeenCalled();
    expect(component.error()).not.toBeNull();
  });
});
