import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AmConfirmService, type AmConfirmOptions } from '../../../../shared/components/confirm/am-confirm.service';
import { FilesService } from '../../../../shared/files/files.service';
import { FileViewerService } from '../../../../shared/files/viewer/file-viewer.service';
import { MeetingService, type MeetingFileDto } from '../../services/meeting.service';
import { MeetingFileListComponent } from './meeting-file-list.component';

// ACC-316 PR 7 — a meeting's papers and attachments in flow: opened in the
// viewer with the meeting's own mints, added and removed only by whoever may
// manage the agenda, and every refusal said in words.
describe('MeetingFileListComponent (ACC-316 PR 7)', () => {
  const FILE: MeetingFileDto = { id: 'f-1', agendaItemId: 'i-1', name: 'October incidents.pdf', mimeType: 'application/pdf', sizeBytes: 1000, uploadedAt: '2027-03-01T08:00:00Z' };
  let addPaper: jasmine.Spy;
  let addAttachment: jasmine.Spy;
  let removeFile: jasmine.Spy;
  let opened: { files: readonly unknown[]; startIndex: number } | null;
  let asked: AmConfirmOptions[];

  function create(canManage: boolean, itemId: string | null = 'i-1') {
    addPaper = jasmine.createSpy('addPaper').and.returnValue(of(FILE));
    addAttachment = jasmine.createSpy('addAttachment').and.returnValue(of(FILE));
    removeFile = jasmine.createSpy('removeFile').and.returnValue(of(undefined));
    opened = null;
    asked = [];
    TestBed.configureTestingModule({
      imports: [MeetingFileListComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: MeetingService, useValue: { addPaper, addAttachment, removeFile, viewFile: () => of({ url: 'u', viaApi: false }), downloadFile: () => of({ url: 'u', viaApi: false }) } },
        { provide: FileViewerService, useValue: { open: (r: { files: readonly unknown[]; startIndex: number }) => (opened = r) } },
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    spyOn(TestBed.inject(FilesService), 'uploadLimits').and.returnValue(of({ maxUploadBytes: 25 * 1024 * 1024, allowedExtensions: ['pdf', 'docx'] }));
    const fixture = TestBed.createComponent(MeetingFileListComponent);
    fixture.componentRef.setInput('meetingId', 'm-1');
    fixture.componentRef.setInput('itemId', itemId);
    fixture.componentRef.setInput('files', [FILE]);
    fixture.componentRef.setInput('canManage', canManage);
    fixture.detectChanges();
    const changed = jasmine.createSpy('changed');
    fixture.componentInstance.changed.subscribe(changed);
    return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, changed };
  }
  const choose = (c: MeetingFileListComponent, file: File) => {
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    c.onChosen({ target: input } as unknown as Event);
  };

  it('opens a file in the viewer at that file', () => {
    const { el } = create(false);
    el.querySelector<HTMLButtonElement>('[data-file="f-1"] button')!.click();
    expect(opened!.startIndex).toBe(0);
    expect(opened!.files.length).toBe(1);
  });

  it('offers no add or remove to someone who may not manage the agenda', () => {
    const { el } = create(false);
    expect(el.querySelector('[data-testid$="-add"]')).toBeNull();
    expect(el.querySelector('am-icon-button')).toBeNull();
  });

  it("adds a paper to its item, or an attachment to the meeting, and tells the page", () => {
    const paper = create(true, 'i-1');
    choose(paper.c, new File(['x'], 'agenda.pdf'));
    expect(addPaper).toHaveBeenCalledWith('m-1', 'i-1', jasmine.any(File));
    expect(paper.changed).toHaveBeenCalled();
    TestBed.resetTestingModule();
    const attachment = create(true, null);
    choose(attachment.c, new File(['x'], 'notes.pdf'));
    expect(addAttachment).toHaveBeenCalledWith('m-1', jasmine.any(File));
  });

  it("a storage refusal is said in words, never the server's", () => {
    const { c, fixture, el } = create(true);
    addPaper.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'FILE_TYPE_NOT_ALLOWED', message: 'Bad type' } })));
    choose(c, new File(['x'], 'macro.docm'));
    fixture.detectChanges();
    const said = el.querySelector('[role="alert"]')?.textContent?.trim() ?? '';
    expect(said.length).toBeGreaterThan(0);
    expect(said).not.toContain('Bad type');
  });

  it('removing asks first, naming the file, and removes only on Accept', () => {
    const { c, changed } = create(true);
    c.askRemove({ id: 'f-1', agendaItemId: 'i-1', name: 'October incidents.pdf', mimeType: 'application/pdf', sizeBytes: 1, uploadedAt: '' });
    expect(removeFile).not.toHaveBeenCalled();
    expect(asked[0]!.message).toContain('October incidents.pdf');
    asked[0]!.accept();
    expect(removeFile).toHaveBeenCalledWith('m-1', 'f-1');
    expect(changed).toHaveBeenCalled();
  });
});
