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
import { FilesService } from '../../../../shared/files/files.service';
import { FileViewerService } from '../../../../shared/files/viewer/file-viewer.service';
import { IFileViewerRequest } from '../../../../shared/files/viewer/file-viewer.model';
import { ITaskEvidenceDto, ITaskEvidenceListDto } from '../../services/task.service';
import { TaskEvidenceListComponent } from './task-evidence-list.component';

// ACC-177 — the Evidence panel. What it shows and offers is the server's
// answer (canAdd, canDelete, closed); the panel only draws it.

const API = `${environment.apiUrl}/tasks/task-1/evidence`;

const FILE_ROW: ITaskEvidenceDto = {
  id: 'ev-1',
  type: 'ATTACHMENT',
  url: null,
  linkTitle: null,
  refType: null,
  refId: null,
  refDisplay: null,
  file: { id: 'file-1', name: 'محضر الاجتماع.pdf', mimeType: 'application/pdf', sizeBytes: 2_516_582, uploadedAt: '2026-10-07T08:00:00Z' },
  uploadedBy: { id: 'u1', name: 'Sara Al-Qahtani' },
  uploadedAt: '2026-10-07T08:00:00Z',
  canDelete: true,
};
const LINK_ROW: ITaskEvidenceDto = {
  ...FILE_ROW,
  id: 'ev-2',
  type: 'LINK',
  url: 'https://www.who.int/publications/hand-hygiene',
  linkTitle: 'WHO observation form',
  file: null,
  canDelete: false,
};

@Component({
  standalone: true,
  imports: [TaskEvidenceListComponent],
  template: `<app-task-evidence-list [taskId]="'task-1'" [requiresEvidence]="required()" (addRequested)="asked = asked + 1" (changed)="changed = changed + 1" />`,
})
class HostComponent {
  readonly required = signal(true);
  asked = 0;
  changed = 0;
}

describe('TaskEvidenceListComponent (ACC-177)', () => {
  let http: HttpTestingController;
  let opened: { url: string; viaApi: boolean }[];

  function setup(list: ITaskEvidenceListDto, language: 'en' | 'ar' = 'en') {
    opened = [];
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
    // Navigating would leave the test page; record the download instead.
    spyOn(TestBed.inject(FilesService), 'open').and.callFake((d) => opened.push(d));
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    http.expectOne(API).flush(list);
    fixture.detectChanges();
    const panel = fixture.debugElement.query(By.directive(TaskEvidenceListComponent)).componentInstance as TaskEvidenceListComponent;
    return { fixture, panel };
  }

  afterEach(() => http.verify());

  it('lists a file by its name with who added it, when, and its size', () => {
    const { fixture } = setup({ items: [FILE_ROW, LINK_ROW], canAdd: true, closed: false });
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('محضر الاجتماع.pdf');
    expect(text).toContain('Sara Al-Qahtani');
    expect(text).toContain('2.4 MB');
    expect(text).toContain('WHO observation form');
    expect(text).toContain('www.who.int');
  });

  it('opens a link in a new tab, never in this one', () => {
    const { fixture } = setup({ items: [LINK_ROW], canAdd: false, closed: false });
    const anchor = fixture.nativeElement.querySelector('a.am-evidence__name') as HTMLAnchorElement;
    expect(anchor.href).toBe(LINK_ROW.url!);
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toBe('noopener noreferrer');
  });

  it('downloads a file through the API\'s fifteen-minute link', () => {
    const { panel } = setup({ items: [FILE_ROW], canAdd: false, closed: false });
    panel.download(FILE_ROW);
    http.expectOne(`${API}/ev-1/download`).flush({ url: 'https://signed.example/x', viaApi: false, expiresAt: '' });
    expect(opened).toEqual([{ url: 'https://signed.example/x', viaApi: false, expiresAt: '' } as never]);
  });

  it('a download refused because the file\'s storage is gone says so, in Arabic', () => {
    const { panel } = setup({ items: [FILE_ROW], canAdd: false, closed: false }, 'ar');
    panel.download(FILE_ROW);
    http
      .expectOne(`${API}/ev-1/download`)
      .flush({ code: 'FILE_UNAVAILABLE', message: 'x' }, { status: 409, statusText: 'Conflict' });
    expect(panel.actionError()).toBe('لم يعد هذا الملف متاحًا من مكان تخزينه.');
    expect(opened).toEqual([]);
  });

  it('offers Remove only where the server says the viewer may, and confirms first', () => {
    const { fixture, panel } = setup({ items: [FILE_ROW, LINK_ROW], canAdd: true, closed: false });
    const labels = Array.from(fixture.nativeElement.querySelectorAll('am-icon-button button') as NodeListOf<HTMLButtonElement>).map(
      (b) => b.getAttribute('aria-label'),
    );
    expect(labels).toContain('Remove “محضر الاجتماع.pdf”');
    expect(labels).not.toContain('Remove “WHO observation form”');

    const confirmation = TestBed.inject(ConfirmationService);
    spyOn(confirmation, 'confirm').and.callFake((c) => {
      // A file goes to the recycle bin for 30 days.
      expect(c.message).toBe(
        '“محضر الاجتماع.pdf” will no longer count as evidence for this task. Your administrator can restore it from the recycle bin for 30 days.',
      );
      expect(c.acceptLabel).toBe('Remove');
      c.accept!();
      return confirmation;
    });
    panel.confirmRemove(FILE_ROW);
    http.expectOne(`${API}/ev-1`).flush(null);
    http.expectOne(API).flush({ items: [LINK_ROW], canAdd: true, closed: false });
    expect(fixture.componentInstance.changed).toBe(1);
  });

  it('says "Required · none yet" in warning ink when evidence is required and there is none', () => {
    const { fixture } = setup({ items: [], canAdd: true, closed: false });
    const note = fixture.nativeElement.querySelector('.am-evidence__note--warn') as HTMLElement;
    expect(note.textContent?.trim()).toBe('Required · none yet');
  });

  it('a closed task\'s evidence is read-only and says so — no add, no remove', () => {
    const { fixture } = setup({ items: [{ ...FILE_ROW, canDelete: false }], canAdd: false, closed: true });
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('This task is closed, so its evidence can no longer change.');
    expect(text).not.toContain('Add evidence');
  });

  it('offers Add evidence to someone who may add', () => {
    const { fixture } = setup({ items: [], canAdd: true, closed: false });
    (fixture.nativeElement.querySelector('.am-evidence__add') as HTMLButtonElement).click();
    expect(fixture.componentInstance.asked).toBe(1);
  });

  it('reads in Arabic', () => {
    const { fixture } = setup({ items: [FILE_ROW], canAdd: true, closed: false }, 'ar');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('الأدلة');
    expect(text).toContain('2.4 ميغابايت');
    expect(text).toContain('إضافة دليل');
  });
});

describe('TaskEvidenceListComponent — the file viewer (ACC-189)', () => {
  const SECOND_FILE: ITaskEvidenceDto = {
    ...FILE_ROW,
    id: 'ev-3',
    file: { id: 'file-3', name: 'Ward photo.jpg', mimeType: 'image/jpeg', sizeBytes: 3_100_000, uploadedAt: '2026-10-07T09:00:00Z' },
  };
  let http: HttpTestingController;
  let viewer: { open: jasmine.Spy };

  function setup(list: ITaskEvidenceListDto) {
    viewer = { open: jasmine.createSpy('open') };
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: FileViewerService, useValue: viewer },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    spyOn(TestBed.inject(FilesService), 'open');
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    http.expectOne(API).flush(list);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => http.verify());

  const request = (): IFileViewerRequest => viewer.open.calls.mostRecent().args[0] as IFileViewerRequest;

  it('a FILE row gets a View button and a name that opens the viewer; a link row gets neither', () => {
    const fixture = setup({ items: [FILE_ROW, LINK_ROW], canAdd: true, closed: false });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(`[aria-label="View “${FILE_ROW.file!.name}”"]`)).not.toBeNull();
    expect(el.querySelectorAll('[data-am-evidence-file]').length).toBe(1);
    expect(el.querySelector('[data-am-evidence-file="ev-1"]')!.textContent!.trim()).toBe(FILE_ROW.file!.name);
    // Download and Delete are unchanged; the link still opens in a new tab.
    expect(el.querySelector(`[aria-label="Download “${FILE_ROW.file!.name}”"]`)).not.toBeNull();
    expect(el.querySelector('a[target="_blank"]')!.getAttribute('href')).toBe(LINK_ROW.url);
  });

  it("opens over the list's FILES only, at the one clicked, with the task-evidence context", () => {
    const fixture = setup({ items: [FILE_ROW, LINK_ROW, SECOND_FILE], canAdd: true, closed: false });
    (fixture.nativeElement.querySelector('[data-am-evidence-file="ev-3"]') as HTMLElement).click();

    const r = request();
    expect(r.files.map((f) => f.id)).toEqual(['ev-1', 'ev-3']);
    expect(r.startIndex).toBe(1);
    expect(r.files[1]).toEqual({ id: 'ev-3', name: 'Ward photo.jpg', mimeType: 'image/jpeg', sizeBytes: 3_100_000 });
    expect(r.context).toEqual({ key: 'files.viewer.from.taskEvidence' });
  });

  it('the eye button opens the same viewer at its own file', () => {
    const fixture = setup({ items: [FILE_ROW, SECOND_FILE], canAdd: true, closed: false });
    const eye = fixture.debugElement.queryAll(By.css('am-icon-button')).find((b) => b.componentInstance.label() === 'View “Ward photo.jpg”')!;
    eye.componentInstance.activated.emit(new MouseEvent('click'));
    expect(request().startIndex).toBe(1);
  });

  it("the viewer mints through the VIEW route, and downloads through the list's own download", () => {
    const fixture = setup({ items: [FILE_ROW], canAdd: true, closed: false });
    (fixture.nativeElement.querySelector('[data-am-evidence-file="ev-1"]') as HTMLElement).click();
    const r = request();

    r.access(r.files[0]!).subscribe();
    http.expectOne(`${API}/ev-1/view`).flush({ url: 'files/stream/t', viaApi: true });

    r.download(r.files[0]!);
    http.expectOne(`${API}/ev-1/download`).flush({ url: 'files/stream/t', viaApi: true });
    expect(TestBed.inject(FilesService).open).toHaveBeenCalled();
  });

  it('on close, focus returns to the name of the file LAST SHOWN, not the one first opened', () => {
    const fixture = setup({ items: [FILE_ROW, SECOND_FILE], canAdd: true, closed: false });
    (fixture.nativeElement.querySelector('[data-am-evidence-file="ev-1"]') as HTMLElement).click();
    request().closed!({ id: 'ev-3', name: 'Ward photo.jpg', mimeType: 'image/jpeg', sizeBytes: 1 });
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[data-am-evidence-file="ev-3"]'));
  });
});
