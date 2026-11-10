import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { MyWorkEvents } from '../../../../core/my-work/my-work-events';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { TaskFormComponent } from '../task-form/task-form.component';
import { TaskNewDialogComponent, TaskNewLockedRecord } from './task-new-dialog.component';

// ACC-280 — THE New task dialog (plan §5, decision 5): one component for /tasks,
// Home and a record's page. Unlocked, the record is picked from the server's
// types; locked, it is set and shown. The payload carries the picked record, a
// closed record is refused from its code, and a create tells My work.

const API = environment.apiUrl;
const FAR = { dueAt: '2100-01-01T00:00:00.000Z', limitAt: '2100-01-01T00:00:00.000Z' };

@Component({
  standalone: true,
  imports: [TaskNewDialogComponent],
  template: `<app-task-new-dialog [(visible)]="visible" [createTypes]="types()" [locked]="locked()" (created)="created = created + 1" />`,
})
class HostComponent {
  readonly visible = signal(true);
  readonly types = signal<string[]>(['COMMITTEE']);
  readonly locked = signal<TaskNewLockedRecord | null>(null);
  created = 0;
}

describe('TaskNewDialogComponent (ACC-280)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;

  const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
  const dialog = () =>
    fixture.debugElement.query((d) => d.componentInstance instanceof TaskNewDialogComponent).componentInstance as TaskNewDialogComponent;
  const form = (): TaskFormComponent => dialog().formRef()!;

  /** Opens the dialog; New task's own reads are answered. */
  function setup(opts: { types?: string[]; locked?: TaskNewLockedRecord | null; language?: 'en' | 'ar' } = {}): void {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(opts.language ?? 'en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.types.set(opts.types ?? ['COMMITTEE']);
    fixture.componentInstance.locked.set(opts.locked ?? null);
    fixture.detectChanges();
    http.match((r) => r.url.startsWith(`${API}/tasks/assignment/`)).forEach((r) => r.flush([]));
    http.match((r) => r.url.startsWith(`${API}/tasks/assignees`)).forEach((r) => r.flush([]));
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
    http.expectOne(`${API}/tasks/sla-preview`).flush({ CRITICAL: FAR, HIGH: FAR, MEDIUM: FAR, LOW: FAR });
    http.expectOne(`${API}/tasks/draft/availability`).flush({ available: false });
    fixture.detectChanges();
  }

  /** Step 2 of the unlocked form; the picker's one small read answered. */
  function toStep2(total = 3): void {
    form().form.patchValue({ title: 'Collect the minutes' });
    form().goToStep(2);
    fixture.detectChanges();
    http.expectOne((r) => r.url === `${API}/tasks/record-choices` && r.params.get('take') === '1').flush({ items: [], total, matching: total });
    fixture.detectChanges();
  }

  function pick(id: string, nameEn: string): void {
    q<HTMLButtonElement>('[data-record-find]')!.click();
    fixture.detectChanges();
    http
      .expectOne((r) => r.url === `${API}/tasks/record-choices` && r.params.get('take') === '50')
      .flush({ items: [{ id, nameEn, nameAr: null }], total: 1, matching: 1 });
    fixture.detectChanges();
    q<HTMLButtonElement>('.am-sl__pick')!.click();
    fixture.detectChanges();
    flush();
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('unlocked, one type: no type field; the record is picked, and Create sends the picked record', fakeAsync(() => {
    setup();
    toStep2();
    expect(q('[data-record-type]')).withContext('one type: the label names it, no type field').toBeNull();
    pick('cmt-7', 'Infection Control Committee');
    const changed = spyOn(TestBed.inject(MyWorkEvents), 'changed');

    form().onSubmit();
    const req = http.expectOne({ method: 'POST', url: `${API}/tasks` });
    expect(req.request.body.sourceType).toBe('COMMITTEE');
    expect(req.request.body.sourceId).toBe('cmt-7');
    req.flush({ id: 'task-1' });
    fixture.detectChanges();
    flush();

    expect(fixture.componentInstance.created).toBe(1);
    expect(fixture.componentInstance.visible()).withContext('the dialog closes on a create').toBeFalse();
    expect(changed).withContext("a create tells My work, so Home's counts read again").toHaveBeenCalledTimes(1);
  }));

  it('Create with no record chosen sends nothing: step 2, and "Choose a committee" under the field', fakeAsync(() => {
    setup();
    toStep2();
    form().onSubmit();
    fixture.detectChanges();
    http.expectNone({ method: 'POST', url: `${API}/tasks` });
    expect(form().step()).toBe(2);
    expect(q('app-task-record-picker .am-field__message--error')!.textContent).toContain('Choose a committee');
    flush();
  }));

  it('a committee that takes no new tasks: said from the code, in the reader\'s language, never the server\'s English', fakeAsync(() => {
    setup({ language: 'ar' });
    toStep2();
    pick('cmt-9', 'Dissolved Committee');
    form().onSubmit();
    http
      .expectOne({ method: 'POST', url: `${API}/tasks` })
      .flush(
        { statusCode: 409, code: 'TASK_RECORD_CLOSED', message: 'English from the server', error: 'Conflict' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();
    const alert = q('app-task-form [role="alert"]')!.textContent!.trim();
    expect(alert).toBe(ar.task.record.closed);
    expect(alert).not.toContain('English from the server');
    expect(fixture.componentInstance.visible()).toBeTrue();
    flush();
  }));

  it('several types: the type field names each type in words, and changing it clears the chosen record', fakeAsync(() => {
    setup({ types: ['COMMITTEE', 'MEETING'] });
    toStep2();
    expect(q('[data-record-type]')).not.toBeNull();
    expect(form().sourceTypeOptions().map((o) => o.label)).toEqual(['Committee', 'Record']);
    pick('cmt-3', 'Quality Committee');
    expect(form().form.controls.sourceId.value).toBe('cmt-3');

    form().form.controls.sourceType.setValue('MEETING');
    fixture.detectChanges();
    http.expectOne((r) => r.url === `${API}/tasks/record-choices` && r.params.get('type') === 'MEETING').flush({ items: [], total: 0, matching: 0 });
    fixture.detectChanges();
    expect(form().form.controls.sourceId.value).toBe('');
    expect(q<HTMLInputElement>('[data-record-field]')!.value).toBe('');
    flush();
  }));

  it('no type the server did not name is offered: the type list is the server\'s alone', () => {
    setup({ types: ['COMMITTEE'] });
    expect(form().sourceTypes()).toEqual(['COMMITTEE']);
    expect(form().form.controls.sourceType.value).toBe('COMMITTEE');
  });

  it('locked (a record\'s page): the record is set and shown, never picked, and the header names it', fakeAsync(() => {
    setup({ locked: { type: 'COMMITTEE', id: 'cmt-1', label: 'Infection Control Committee' } });
    expect(document.body.textContent).toContain('on Infection Control Committee');
    form().form.patchValue({ title: 'Collect the minutes' });
    form().goToStep(2);
    fixture.detectChanges();
    http.expectNone((r) => r.url === `${API}/tasks/record-choices`);
    expect(q('app-task-record-picker')).toBeNull();
    expect(document.body.textContent).toContain('Infection Control Committee');

    form().onSubmit();
    const req = http.expectOne({ method: 'POST', url: `${API}/tasks` });
    expect(req.request.body.sourceType).toBe('COMMITTEE');
    expect(req.request.body.sourceId).toBe('cmt-1');
    req.flush({ id: 'task-2' });
    flush();
    expect(fixture.componentInstance.created).toBe(1);
  }));
});
