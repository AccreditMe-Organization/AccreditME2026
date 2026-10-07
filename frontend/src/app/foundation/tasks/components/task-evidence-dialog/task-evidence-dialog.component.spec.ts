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
import { ITaskDto } from '../../services/task.service';
import { TaskEvidenceDialogComponent } from './task-evidence-dialog.component';
import { TaskAddEvidenceDialogComponent } from '../task-add-evidence-dialog/task-add-evidence-dialog.component';

// ACC-177 — the evidence of a task, opened from a row: the Evidence panel in a
// dialog, and Add evidence as its own layer above it.

const TASK = { id: 'task-1', title: 'Collect the audit sample', requiresEvidence: false } as ITaskDto;
const API = `${environment.apiUrl}/tasks/task-1/evidence`;

@Component({
  standalone: true,
  imports: [TaskEvidenceDialogComponent],
  template: `<app-task-evidence-dialog [visible]="visible()" (visibleChange)="visible.set($event)" [task]="task" (changed)="changed = changed + 1" />`,
})
class HostComponent {
  readonly visible = signal(true);
  readonly task = TASK;
  changed = 0;
}

describe('TaskEvidenceDialogComponent (ACC-177)', () => {
  let http: HttpTestingController;

  function setup(canAdd: boolean) {
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
    TestBed.inject(TranslateService).use('en');
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    http.match(`${environment.apiUrl}/files/upload-limits`).forEach((r) => r.flush({ maxUploadBytes: 1, allowedExtensions: [] }));
    http.expectOne(API).flush({ items: [], canAdd, closed: false });
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(TaskEvidenceDialogComponent)).componentInstance as TaskEvidenceDialogComponent;
    return { fixture, dialog };
  }

  afterEach(() => http.verify());

  it('names the task and lists its evidence', () => {
    setup(false);
    expect(document.body.textContent).toContain('Evidence');
    expect(document.body.textContent).toContain('Collect the audit sample');
  });

  it('offers Add evidence only to someone the server says may add', () => {
    setup(false);
    expect(Array.from(document.body.querySelectorAll('button')).some((b) => b.textContent?.includes('Add evidence'))).toBe(false);
  });

  it('Add evidence opens the add dialog as its own layer, and a new piece reloads the list and the host', () => {
    const { fixture, dialog } = setup(true);
    const add = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Add evidence'))!;
    add.click();
    fixture.detectChanges();
    expect(dialog.addVisible()).toBe(true);
    http.expectOne(`${environment.apiUrl}/files/upload-limits`).flush({ maxUploadBytes: 1, allowedExtensions: [] });

    const addDialog = fixture.debugElement.query(By.directive(TaskAddEvidenceDialogComponent)).componentInstance as TaskAddEvidenceDialogComponent;
    addDialog.added.emit();
    http.expectOne(API).flush({ items: [], canAdd: true, closed: false });
    expect(fixture.componentInstance.changed).toBe(1);
  });
});
