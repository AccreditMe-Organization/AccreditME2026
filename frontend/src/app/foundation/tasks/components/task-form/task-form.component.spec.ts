// ACC-96 — the due-date layer and the payload it produces.
//
// This file exists because the suite was GREEN while the time picker was
// unreachable. The first cut of the layer closed it on every ngModelChange,
// copying public-holiday-form, whose date has no time. A due date does: every
// hour and minute arrow fires ngModelChange as well as a day click, so the
// layer shut on the first arrow press and the task kept whatever time it was
// when the calendar opened. Found by driving the picker in a browser; nothing
// here had failed.
//
// Both directions, so neither half can be satisfied by doing nothing:
//   - a pick (a day OR a time) leaves the layer OPEN
//   - Done, and only Done, closes it
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

describe('TaskFormComponent — due-date layer (ACC-96)', () => {
  let fixture: ComponentFixture<TaskFormComponent>;
  let component: TaskFormComponent;
  let httpMock: HttpTestingController;

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

    httpMock
      .expectOne(`${environment.apiUrl}/users?status=ACTIVE&pageSize=200`)
      .flush({ data: [], total: 0, page: 1, pageSize: 200 });
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('keeps the layer open when the picker reports a value, so the time is reachable', () => {
    component.toggleDuePanel();
    expect(component.duePanelOpen()).toBe(true);

    // A day click and a time arrow are indistinguishable here — both arrive as
    // one ngModelChange carrying the whole Date. That is the point: the handler
    // cannot close on one without closing on the other.
    component.onDueDatePicked(new Date(2026, 8, 25, 15, 13));
    expect(component.duePanelOpen())
      .withContext('a pick must not dismiss the layer — the time picker lives in it')
      .toBe(true);

    component.onDueDatePicked(new Date(2026, 8, 25, 9, 0));
    expect(component.duePanelOpen()).toBe(true);
    expect(component.form.controls.dueDate.value).toEqual(new Date(2026, 8, 25, 9, 0));
  });

  it('closes on Done, and returns the committed value', () => {
    component.toggleDuePanel();
    component.onDueDatePicked(new Date(2026, 8, 25, 9, 0));

    component.closeDuePanel();

    expect(component.duePanelOpen()).toBe(false);
    expect(component.form.controls.dueDate.value).toEqual(new Date(2026, 8, 25, 9, 0));
  });

  it('sends the picked instant unchanged — byte-for-byte the body the old picker sent', () => {
    // Pinned against a payload CAPTURED IN A BROWSER from the previous
    // implementation. Picking 25 Sep 2026 09:00 there posted exactly this, and
    // the same choice on this implementation posted the same bytes.
    //
    // Compared as the serialised string rather than the object, because the
    // wire format is what has to be identical: an absent `description` and a
    // `description: undefined` are the same request and different objects.
    const wire =
      '{"title":"ACC-96 payload probe","sourceType":"DOCUMENT","sourceId":"acc96-probe",' +
      '"priority":"MEDIUM","dueDate":"2026-09-25T06:00:00.000Z","assigneeUserIds":[]}';

    component.form.patchValue({
      title: 'ACC-96 payload probe',
      sourceType: 'DOCUMENT',
      sourceId: 'acc96-probe',
    });
    component.toggleDuePanel();
    component.onDueDatePicked(new Date('2026-09-25T06:00:00.000Z'));
    component.closeDuePanel();

    component.onSubmit();

    const req = httpMock.expectOne(`${environment.apiUrl}/tasks`);
    expect(req.request.method).toBe('POST');
    expect(JSON.stringify(req.request.body)).toBe(wire);
    req.flush({});
  });
});
