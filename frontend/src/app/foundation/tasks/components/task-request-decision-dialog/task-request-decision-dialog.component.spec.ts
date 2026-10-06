import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { TaskRequestForDecisionDto } from '../../services/task.service';
import { TaskRequestDecisionDialogComponent } from './task-request-decision-dialog.component';

// ACC-173 — approve as asked (an optional note), or decline with a note the
// person who asked will read.

const API = `${environment.apiUrl}/tasks`;

const REQUEST: TaskRequestForDecisionDto = {
  id: 'req-1',
  type: 'EXTENSION',
  requestedDueAt: '2099-02-01T13:00:00.000Z',
  holdUntil: null,
  requestedById: 'sara',
  requestedByName: 'Sara',
  reason: 'Waiting on the lab',
  createdAt: '2026-10-06T08:00:00.000Z',
  task: {
    id: 'task-1',
    title: 'Collect the audit sample',
    sourceType: 'COMMITTEE',
    sourceId: 'c1',
    status: 'PENDING',
    priority: 'MEDIUM',
    dueAt: '2099-01-20T13:00:00.000Z',
  },
};

@Component({
  standalone: true,
  imports: [TaskRequestDecisionDialogComponent],
  template: `
    <app-task-request-decision-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [request]="request"
      (decided)="decidedCount = decidedCount + 1"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly request = REQUEST;
  decidedCount = 0;
}

describe('TaskRequestDecisionDialogComponent (ACC-173)', () => {
  let http: HttpTestingController;

  function setup(language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(TaskRequestDecisionDialogComponent))
      .componentInstance as TaskRequestDecisionDialogComponent;
    return { fixture, dialog };
  }

  afterEach(() => http.verify());

  it('shows exactly what was asked, by whom and why', () => {
    setup();
    expect(document.body.textContent).toContain('Sara asks for the due date to move to 1 Feb 2099');
    expect(document.body.textContent).toContain('Reason: Waiting on the lab');
  });

  it('approves as asked, with no note required, then tells the host and closes', () => {
    const { fixture, dialog } = setup();
    dialog.approve();

    const req = http.expectOne(`${API}/task-1/requests/req-1/approve`);
    expect(req.request.body).toEqual({});
    req.flush({});
    expect(fixture.componentInstance.decidedCount).toBe(1);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('refuses to decline without a note, and says why', () => {
    const { dialog } = setup();
    dialog.form.controls.note.setValue('   ');
    dialog.decline();

    expect(dialog.form.controls.note.hasError('required')).toBe(true);
    expect(dialog.showErrors()).toBe(true);
    http.expectNone(`${API}/task-1/requests/req-1/decline`);
  });

  it('declines with the trimmed note', () => {
    const { dialog } = setup();
    dialog.form.controls.note.setValue('  The audit date cannot move  ');
    dialog.decline();

    expect(http.expectOne(`${API}/task-1/requests/req-1/decline`).request.body).toEqual({
      note: 'The audit date cannot move',
    });
  });

  it('approving after a failed decline no longer demands a note', () => {
    const { dialog } = setup();
    dialog.decline();
    dialog.approve();
    http.expectOne(`${API}/task-1/requests/req-1/approve`).flush({});
  });

  it('reads in Arabic', () => {
    setup('ar');
    expect(document.body.textContent).toContain('يطلب Sara نقل تاريخ الاستحقاق إلى');
    expect(document.body.textContent).toContain('موافقة');
    expect(document.body.textContent).toContain('رفض');
  });
});
