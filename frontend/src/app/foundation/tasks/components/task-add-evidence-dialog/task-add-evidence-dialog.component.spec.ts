import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { ITaskDto } from '../../services/task.service';
import { MAX_FILES_AT_A_TIME, TaskAddEvidenceDialogComponent } from './task-add-evidence-dialog.component';

// ACC-177 — one Add evidence dialog: a link (ACC-163's rules, carried over) or
// files. Files are judged against the installation's limits before anything is
// sent, uploaded one per request with progress, and a server refusal is shown
// on its row in the reader's language.

const TASK = { id: 'task-1', title: 'Collect the audit sample', requiresEvidence: true } as ITaskDto;
const LINK_URL = `${environment.apiUrl}/tasks/task-1/evidence`;
const FILE_URL = `${environment.apiUrl}/tasks/task-1/evidence/file`;
const LIMITS_URL = `${environment.apiUrl}/files/upload-limits`;
const LIMITS = { maxUploadBytes: 25 * 1024 * 1024, allowedExtensions: ['pdf', 'docx', 'xlsx', 'png', 'jpg', 'csv', 'txt'] };

@Component({
  standalone: true,
  imports: [TaskAddEvidenceDialogComponent],
  template: `
    <app-task-add-evidence-dialog
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

const file = (name: string, size = 10, type = 'application/pdf') =>
  new File([new Uint8Array(size)], name, { type });

describe('TaskAddEvidenceDialogComponent (ACC-177)', () => {
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
    http.match(LIMITS_URL).forEach((r) => r.flush(LIMITS));
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(TaskAddEvidenceDialogComponent))
      .componentInstance as TaskAddEvidenceDialogComponent;
    return { fixture, dialog };
  }

  afterEach(() => http.verify());

  describe('Link', () => {
    it('sends a LINK with the URL and title, then tells the host and closes', () => {
      const { fixture, dialog } = setup();
      dialog.linkForm.setValue({ url: ' https://intranet/minutes/feb ', linkTitle: ' February minutes ' });
      dialog.submit();

      const req = http.expectOne(LINK_URL);
      expect(req.request.body).toEqual({ type: 'LINK', url: 'https://intranet/minutes/feb', linkTitle: 'February minutes' });
      req.flush({ id: 'evidence-1' });
      expect(fixture.componentInstance.addedCount).toBe(1);
      expect(fixture.componentInstance.visible()).toBe(false);
    });

    it('leaves the title out when none is given', () => {
      const { dialog } = setup();
      dialog.linkForm.setValue({ url: 'http://intranet/minutes', linkTitle: '   ' });
      dialog.submit();
      expect(http.expectOne(LINK_URL).request.body).toEqual({ type: 'LINK', url: 'http://intranet/minutes', linkTitle: undefined });
    });

    for (const [label, url] of [
      ['a javascript: link', 'javascript:alert(1)'],
      ['a link with no protocol', 'intranet/minutes'],
      ['an ftp: link', 'ftp://files/report.pdf'],
    ]) {
      it(`refuses ${label} before sending`, () => {
        const { dialog } = setup();
        dialog.linkForm.setValue({ url, linkTitle: '' });
        dialog.submit();
        expect(dialog.linkForm.controls.url.hasError('pattern')).toBe(true);
        expect(dialog.showErrors()).toBe(true);
        http.expectNone(LINK_URL);
      });
    }

    it('requires a URL', () => {
      const { dialog } = setup();
      dialog.submit();
      expect(dialog.linkForm.controls.url.hasError('required')).toBe(true);
      http.expectNone(LINK_URL);
    });
  });

  describe('File', () => {
    it('offers Link and File — no Record, because there is no record picker yet', () => {
      const { dialog } = setup();
      expect(dialog.kinds.map((k) => k.value)).toEqual(['LINK', 'FILE']);
    });

    it('shows the size cap and the types before a file is chosen', () => {
      const { fixture, dialog } = setup();
      dialog.chooseKind('FILE');
      fixture.detectChanges();
      expect(document.body.textContent).toContain('up to 25 MB each · up to 3 at a time');
      expect(document.body.textContent).toContain('Drop files here, or');
    });

    it('judges each chosen file at once: a type not on the list, an empty file, one too large', () => {
      const { dialog } = setup();
      dialog.chooseKind('FILE');
      dialog.enqueue([file('macro.xlsm'), file('empty.pdf', 0), file('huge.pdf', 26 * 1024 * 1024)]);

      expect(dialog.queue().map((q) => [q.state, q.reason])).toEqual([
        ['refused', "This type of file can't be uploaded."],
        ['refused', 'The file is empty.'],
        ['refused', 'Larger than 25 MB, the upload limit.'],
      ]);
      dialog.submit();
      http.expectNone(FILE_URL);
    });

    it(`takes at most ${MAX_FILES_AT_A_TIME} at a time, and says so`, () => {
      const { dialog } = setup();
      dialog.chooseKind('FILE');
      dialog.enqueue([file('a.pdf'), file('b.pdf'), file('c.pdf'), file('d.pdf')]);
      expect(dialog.queue()).toHaveSize(MAX_FILES_AT_A_TIME);
      expect(dialog.error()).toBe('Up to 3 files at a time');
      expect(dialog.limitsLine()).toContain('up to 3 at a time');
    });

    it('names the count on its button — "Add 2 files"', () => {
      const { dialog } = setup();
      dialog.chooseKind('FILE');
      dialog.enqueue([file('a.pdf'), file('b.pdf')]);
      expect(dialog.primaryLabel()).toBe('Add 2 files');
    });

    it('uploads one request per file, with progress, then tells the host and closes', async () => {
      const { fixture, dialog } = setup();
      dialog.chooseKind('FILE');
      dialog.enqueue([file('ward-audit.pdf'), file('observations.xlsx', 20, 'application/octet-stream')]);
      dialog.submit();

      const first = http.expectOne(FILE_URL);
      expect(first.request.body instanceof FormData).toBe(true);
      expect((first.request.body as FormData).get('file')).toEqual(jasmine.objectContaining({ name: 'ward-audit.pdf' }));
      first.event({ type: HttpEventType.UploadProgress, loaded: 32, total: 50 });
      expect(dialog.queue()[0]!.state).toBe('uploading');
      expect(dialog.queue()[0]!.progress).toBe(64);
      expect(dialog.stateLine(dialog.queue()[0]!)).toBe('Uploading 64%');
      first.flush({ id: 'ev-1' });
      await fixture.whenStable();

      http.expectOne(FILE_URL).flush({ id: 'ev-2' });
      await fixture.whenStable();

      expect(fixture.componentInstance.addedCount).toBe(1);
      expect(fixture.componentInstance.visible()).toBe(false);
    });

    it("keeps the dialog open on a server refusal, with the reason on that file's row in Arabic", async () => {
      const { fixture, dialog } = setup('ar');
      dialog.chooseKind('FILE');
      dialog.enqueue([file('ok.pdf'), file('renamed.pdf')]);
      dialog.submit();

      http.expectOne(FILE_URL).flush({ id: 'ev-1' });
      await fixture.whenStable();
      http
        .expectOne(FILE_URL)
        .flush({ statusCode: 415, code: 'FILE_TYPE_NOT_ALLOWED', message: "This type of file can't be uploaded" }, { status: 415, statusText: 'Unsupported Media Type' });
      await fixture.whenStable();

      expect(dialog.queue().map((q) => q.state)).toEqual(['added', 'refused']);
      expect(dialog.queue()[1]!.reason).toBe('لا يمكن رفع هذا النوع من الملفات.');
      expect(fixture.componentInstance.addedCount).toBe(1); // the host reloads for the one that went
      expect(fixture.componentInstance.visible()).toBe(true);
    });

    it('says "storage isn\'t set up yet" when the installation has no storage', async () => {
      const { fixture, dialog } = setup();
      dialog.chooseKind('FILE');
      dialog.enqueue([file('a.pdf')]);
      dialog.submit();
      http
        .expectOne(FILE_URL)
        .flush({ statusCode: 503, code: 'STORAGE_NOT_CONFIGURED', message: "File storage isn't set up yet" }, { status: 503, statusText: 'Service Unavailable' });
      await fixture.whenStable();
      expect(dialog.queue()[0]!.reason).toBe("File storage isn't set up yet. Ask your administrator.");
    });

    it("says storage isn't set up yet — ask your administrator — until storage is confirmed, in both languages", async () => {
      const { fixture, dialog } = setup('ar');
      dialog.chooseKind('FILE');
      dialog.enqueue([file('a.pdf')]);
      dialog.submit();
      http
        .expectOne(FILE_URL)
        .flush(
          { statusCode: 409, code: 'STORAGE_NOT_CONFIRMED', message: "File storage isn't set up yet. Ask your administrator." },
          { status: 409, statusText: 'Conflict' },
        );
      await fixture.whenStable();
      expect(dialog.queue()[0]!.reason).toBe('لم يُجهَّز تخزين الملفات بعد. راجع مسؤول النظام.');
      expect(fixture.componentInstance.visible()).toBe(true);
    });

    it('asks for a file rather than sending nothing', () => {
      const { dialog } = setup();
      dialog.chooseKind('FILE');
      dialog.submit();
      expect(dialog.error()).toBe('Choose a file to upload.');
      http.expectNone(FILE_URL);
    });

    it('a chosen file makes the dialog dirty, so Escape asks first', () => {
      const { dialog } = setup();
      expect(dialog.dirty()).toBe(false);
      dialog.chooseKind('FILE');
      dialog.enqueue([file('a.pdf')]);
      expect(dialog.dirty()).toBe(true);
    });
  });

  it('names the task, and that evidence is required, in Arabic', () => {
    setup('ar');
    expect(document.body.textContent).toContain('إضافة دليل');
    expect(document.body.textContent).toContain('Collect the audit sample · الدليل مطلوب');
  });
});
