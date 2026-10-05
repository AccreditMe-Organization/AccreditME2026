import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { ITaskDto } from '../../services/task.service';
import { TaskLinkEvidenceDialogComponent } from './task-link-evidence-dialog.component';

// ACC-163 (Q11) — the one evidence form there is. What matters: the request is
// a LINK with only the link's own fields, the URL must be http or https (the
// link is rendered clickable for whoever reviews the task), and the title is
// optional.

const TASK = { id: 'task-1', title: 'Collect the audit sample' } as ITaskDto;
const URL = `${environment.apiUrl}/tasks/task-1/evidence`;

@Component({
  standalone: true,
  imports: [TaskLinkEvidenceDialogComponent],
  template: `
    <app-task-link-evidence-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [task]="task"
      (added)="addedCount = addedCount + 1"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly task = TASK;
  addedCount = 0;
}

describe('TaskLinkEvidenceDialogComponent (ACC-163)', () => {
  let http: HttpTestingController;

  function setup() {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(TaskLinkEvidenceDialogComponent))
      .componentInstance as TaskLinkEvidenceDialogComponent;
    return { fixture, dialog };
  }

  afterEach(() => http.verify());

  it('sends a LINK with the URL and title, then tells the host and closes', () => {
    const { fixture, dialog } = setup();

    dialog.form.setValue({ url: ' https://intranet/minutes/feb ', linkTitle: ' February minutes ' });
    dialog.submit();

    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({
      type: 'LINK',
      url: 'https://intranet/minutes/feb',
      linkTitle: 'February minutes',
    });
    req.flush({ id: 'evidence-1' });

    expect(fixture.componentInstance.addedCount).toBe(1);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('leaves the title out when none is given', () => {
    const { dialog } = setup();

    dialog.form.setValue({ url: 'http://intranet/minutes', linkTitle: '   ' });
    dialog.submit();

    expect(http.expectOne(URL).request.body).toEqual({
      type: 'LINK',
      url: 'http://intranet/minutes',
      linkTitle: undefined,
    });
  });

  for (const [label, url] of [
    ['a javascript: link', 'javascript:alert(1)'],
    ['a link with no protocol', 'intranet/minutes'],
    ['an ftp: link', 'ftp://files/report.pdf'],
  ]) {
    it(`refuses ${label} before sending`, () => {
      const { dialog } = setup();

      dialog.form.setValue({ url, linkTitle: '' });
      dialog.submit();

      expect(dialog.form.controls.url.hasError('pattern')).toBe(true);
      expect(dialog.showErrors()).toBe(true);
      http.expectNone(URL);
    });
  }

  it('requires a URL', () => {
    const { dialog } = setup();

    dialog.submit();

    expect(dialog.form.controls.url.hasError('required')).toBe(true);
    http.expectNone(URL);
  });
});
