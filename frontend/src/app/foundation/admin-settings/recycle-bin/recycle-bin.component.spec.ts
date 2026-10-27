import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { environment } from '../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { RecycleBinComponent } from './recycle-bin.component';
import { IRecycleBinItem } from './recycle-bin.service';
import { BIN_18, BIN_EMPTY, BIN_NOW, BIN_ONE, BIN_WITH_GONE, RECORD_GONE_ERROR, binItem } from './recycle-bin-fixtures';

// ACC-260, PR D — the Recycle bin page against its fixtures (plan §5): the
// list's states, search, filters, sorting by header and the pager; Restore one
// and several, reported per file; Purge with its tick, one call, its 404 and
// its refusals, and the 100-file limit.

const URL = `${environment.apiUrl}/tenant/recycle-bin`;

describe('RecycleBinComponent (ACC-260, PR D)', () => {
  let fixture: ComponentFixture<RecycleBinComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  preserveDocumentLanguage();

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no storage in this browser: nothing to clear */
    }
  });

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
  });

  function render(items: IRecycleBinItem[], lang: 'en' | 'ar' = 'en', phone = false): void {
    TestBed.configureTestingModule({
      imports: [RecycleBinComponent],
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
    TestBed.inject(TranslateService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RecycleBinComponent);
    fixture.componentInstance.phone.set(phone);
    fixture.componentInstance.now = () => BIN_NOW;
    el = fixture.nativeElement;
    fixture.detectChanges();
    http.expectOne(URL).flush(items);
    settle();
  }

  // Flush first, then render: the committee list's order. Rendering before the
  // list's answer has landed checks the rows mid-reorder.
  function settle(): void {
    flush();
    fixture.detectChanges();
    flush();
    fixture.detectChanges();
  }

  const text = (node: Element | null): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rows = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('[data-file]'));
  const ids = (): string[] => rows().map((r) => r.getAttribute('data-file')!);
  const names = (): string[] => rows().map((r) => text(r.querySelector('[data-testid="bin-name"]')));
  const row = (id: string): HTMLElement => el.querySelector<HTMLElement>(`[data-file="${id}"]`)!;
  const button = (scope: ParentNode, testid: string): HTMLButtonElement | null =>
    scope.querySelector<HTMLButtonElement>(`[data-testid="${testid}"] button`);
  const press = (scope: ParentNode, testid: string): void => {
    button(scope, testid)!.click();
    settle();
  };
  const dialog = (): HTMLElement => document.querySelector<HTMLElement>('.p-dialog')!;
  const header = (label: string): HTMLElement =>
    Array.from(el.querySelectorAll<HTMLElement>('am-sort-header')).find((h) => text(h).replace(/[▲▼]/g, '').trim() === label)!;
  const sortBy = (label: string): void => {
    header(label).querySelector<HTMLButtonElement>('button')!.click();
    settle();
  };
  const select = (id: string): void => {
    row(id).querySelector<HTMLInputElement>('[data-testid="bin-select"]')!.click();
    settle();
  };
  const list = () => fixture.componentInstance.list();

  // ── states ────────────────────────────────────────────────────────────────

  it('empty: the drawn empty state, and the purpose sentence alone', fakeAsync(() => {
    render(BIN_EMPTY);
    expect(rows().length).toBe(0);
    expect(text(el)).toContain('The recycle bin is empty');
    expect(text(el)).toContain('Files deleted from tasks stay here for 30 days, so you can restore them.');
    expect(fixture.componentInstance.purpose()).toBe(
      'Deleted files stay here for 30 days, then are deleted for good. They count towards your storage limit until then.',
    );
    expect(el.querySelector('[data-testid="bin-bulk"]')).toBeNull();
  }));

  it('one file: every column as drawn, the record a link to its task', fakeAsync(() => {
    render(BIN_ONE);
    expect(rows().length).withContext('rows rendered').toBe(1);
    const r = row('f-1');
    expect(text(r.querySelector('[data-testid="bin-name"]'))).toBe('Ward 6A observations.docx');
    expect(text(r.querySelector('[data-testid="bin-meta"]'))).toBe('Word · 410 KB');
    expect(text(r.querySelector('[data-cell="from"] .am-bin__meta'))).toBe('Task');
    expect(text(r.querySelector('[data-testid="bin-record-link"]'))).toBe('Re-audit wards 4B and 6A');
    expect(r.querySelector('[data-testid="bin-record-link"]')!.getAttribute('href')).toBe('/tasks/t-1');
    expect(text(r.querySelector('[data-cell="deletedBy"]'))).toBe('Omar Haddad');
    expect(text(r.querySelector('[data-cell="deleted"]'))).toBe('25 Oct 2026');
    expect(text(r.querySelector('[data-cell="daysLeft"]'))).toBe('28 days');
    expect(button(r, 'bin-restore')).not.toBeNull();
    expect(button(r, 'bin-purge')).not.toBeNull();
    expect(fixture.componentInstance.purpose()).toBe(
      '1 file · 410 KB. Deleted files stay here for 30 days, then are deleted for good. They count towards your storage limit until then.',
    );
  }));

  it('opens soonest to expire first, the Days left header showing it', fakeAsync(() => {
    render(BIN_18);
    expect(ids()[0]).withContext('29 days ago: one day left').toBe('f-12');
    const days = rows().map((r) => Number(text(r.querySelector('[data-cell="daysLeft"]')).split(' ')[0]));
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(header('Days left').getAttribute('aria-sort')).toBe('ascending');
  }));

  it('three days left or fewer is amber, and only then', fakeAsync(() => {
    render(BIN_18);
    for (const r of rows()) {
      const cell = r.querySelector('[data-cell="daysLeft"]')!;
      const n = Number(text(cell).split(' ')[0]);
      expect(cell.classList.contains('am-bin__days--warn')).withContext(`${n} days`).toBe(n <= 3);
    }
    expect(rows().filter((r) => r.querySelector('.am-bin__days--warn')).length).withContext('some are amber').toBeGreaterThan(0);
  }));

  it('the pager: ten a page, then the rest', fakeAsync(() => {
    render(BIN_18);
    expect(rows().length).toBe(10);
    el.querySelector<HTMLButtonElement>('.p-paginator-next')!.click();
    settle();
    expect(rows().length).toBe(8);
    expect(list().total()).toBe(18);
  }));

  // ── search, filters ───────────────────────────────────────────────────────

  it('search reads the file name', fakeAsync(() => {
    render(BIN_18);
    const box = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    box.value = 'AUDIT';
    box.dispatchEvent(new Event('input'));
    settle();
    expect(names().sort()).toEqual(['Audit summary.pdf', 'Hand hygiene audit.xlsx']);
  }));

  it('each filter narrows the list: record type, deleted by, deleted', fakeAsync(() => {
    render(BIN_18);
    const page = fixture.componentInstance;
    expect(page.recordTypeOptions()).toEqual([
      { value: 'MEETING', label: 'Record' },
      { value: 'TASK', label: 'Task' },
    ]);
    expect(page.deletedByOptions().map((o) => o.label)).toEqual(['Dana Chalabi', 'Hessa Al-Dosari', 'Nora Al-Otaibi', 'Omar Haddad', 'Unknown']);

    list().setFilter('recordType', 'MEETING');
    settle();
    expect(ids().sort()).toEqual(['f-05', 'f-10']);

    list().setFilter('recordType', null);
    list().setFilter('deletedBy', 'u-omar');
    settle();
    expect(ids().sort()).toEqual(['f-02', 'f-06', 'f-10', 'f-14']);

    list().setFilter('deletedBy', '__none__');
    settle();
    expect(ids()).toEqual(['f-18']);

    list().setFilter('deletedBy', null);
    list().setFilter('deleted', 'day');
    settle();
    expect(ids().sort()).withContext('1 and 0.5 days ago').toEqual(['f-02', 'f-05']);
  }));

  it('filtered empty: "No deleted files match", and Clear filters brings them back', fakeAsync(() => {
    render(BIN_18);
    list().setFilter('deletedBy', 'u-omar');
    list().setFilter('deleted', 'older');
    list().setFilter('recordType', 'MEETING');
    settle();
    expect(rows().length).toBe(0);
    expect(text(el)).toContain('No deleted files match');
    expect(text(el)).toContain('18 files in the bin; none match your search or filters.');
    expect(text(el)).not.toContain('The recycle bin is empty');
    const clear = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => text(b) === 'Clear filters')!;
    clear.click();
    settle();
    expect(rows().length).toBe(10);
  }));

  // ── sorting by header ─────────────────────────────────────────────────────

  it('sorts on every sortable header, both ways', fakeAsync(() => {
    render(BIN_18);
    sortBy('File');
    expect(names()[0]).toBe('Audit summary.pdf');
    expect(header('File').getAttribute('aria-sort')).toBe('ascending');
    sortBy('File');
    expect(names()[0]).toBe('Ward round checklist.docx');
    expect(header('File').getAttribute('aria-sort')).toBe('descending');

    sortBy('From');
    expect(text(rows()[0]!.querySelector('[data-cell="from"]'))).toContain('Record');

    sortBy('Deleted by');
    expect(text(rows()[0]!.querySelector('[data-cell="deletedBy"]'))).toBe('Dana Chalabi');
    sortBy('Deleted by');
    // Nobody left to name sorts last, both ways.
    el.querySelector<HTMLButtonElement>('.p-paginator-next')!.click();
    settle();
    expect(text(rows().at(-1)!.querySelector('[data-cell="deletedBy"]'))).toBe('Unknown');

    sortBy('Deleted');
    expect(ids()[0]).withContext('the oldest deletion first').toBe('f-12');

    sortBy('Days left');
    expect(header('Days left').getAttribute('aria-sort')).toBe('ascending');
    sortBy('Days left');
    expect(ids()[0]).withContext('deleted half a day ago: 30 days left').toBe('f-05');
  }));

  // ── a record that no longer exists ────────────────────────────────────────

  it('a file whose task no longer exists: struck through, no link, no Restore, and the line why', fakeAsync(() => {
    render(BIN_WITH_GONE);
    const gone = row('f-gone');
    expect(gone.getAttribute('data-gone')).toBe('true');
    expect(gone.querySelector('[data-testid="bin-record-link"]')).toBeNull();
    const record = gone.querySelector('[data-testid="bin-record"]')!;
    expect(text(record)).toBe('A task that no longer exists');
    expect(record.classList).toContain('am-bin__record--gone');
    expect(button(gone, 'bin-restore')).toBeNull();
    expect(button(gone, 'bin-purge')).not.toBeNull();
    expect(text(gone.querySelector('[data-testid="bin-gone"]'))).toBe("Can't be restored: the record it came from no longer exists.");
    expect(button(row('f-live'), 'bin-restore')).not.toBeNull();
  }));

  // ── restore ───────────────────────────────────────────────────────────────

  it('restores one file: the drawn wording, one request, then the list it answers with', fakeAsync(() => {
    render(BIN_ONE);
    press(row('f-1'), 'bin-restore');
    expect(text(dialog().querySelector('.p-dialog-title'))).toBe('Restore “Ward 6A observations.docx”?');
    expect(text(dialog().querySelector('[data-testid="restore-body"]'))).toBe('It goes back to Re-audit wards 4B and 6A.');
    press(dialog(), 'restore-send');
    const req = http.expectOne(`${URL}/f-1/restore`);
    expect(req.request.method).toBe('POST');
    req.flush([]);
    settle();
    expect(text(el.querySelector('[data-testid="bin-outcome"]'))).toContain('1 file restored.');
    expect(el.querySelector('[data-testid="bin-outcome"]')!.getAttribute('role')).toBe('status');
    expect(text(el)).toContain('The recycle bin is empty');
  }));

  it('restores several in sequence and reports each: one refused FILE_RECORD_GONE is then marked gone', fakeAsync(() => {
    render(BIN_18);
    for (const id of ['f-01', 'f-03', 'f-07']) select(id);
    expect(text(el.querySelector('[data-testid="bin-bulk"]'))).toContain('3 selected');
    press(el, 'bulk-restore');
    expect(text(dialog().querySelector('.p-dialog-title'))).toBe('Restore 3 files?');
    expect(text(dialog().querySelector('[data-testid="restore-body"]'))).toContain('3 files go back to their records.');
    expect(text(dialog().querySelector('[data-testid="restore-restoring"]'))).toMatch(/^3 files · /);
    expect(text(button(dialog(), 'restore-send'))).toBe('Restore 3 files');
    press(dialog(), 'restore-send');

    const without = (...gone: string[]) => BIN_18.filter((i) => !gone.includes(i.id));
    http.expectOne(`${URL}/f-01/restore`).flush(without('f-01'));
    settle();
    http.expectOne(`${URL}/f-03/restore`).flush(RECORD_GONE_ERROR.error, { status: 409, statusText: 'Conflict' });
    settle();
    http.expectOne(`${URL}/f-07/restore`).flush(without('f-01', 'f-07'));
    settle();

    const outcome = el.querySelector('[data-testid="bin-outcome"]')!;
    expect(outcome.getAttribute('role')).toBe('alert');
    expect(text(outcome)).toContain("2 restored, 1 couldn't be:");
    const lines = Array.from(outcome.querySelectorAll('[data-testid="bin-outcome-line"]')).map((l) => text(l));
    expect(lines).toEqual([
      'Audit summary.pdf: restored',
      "Old policy draft.doc: The record this file came from no longer exists, so it can't be restored.",
      'Notes.txt: restored',
    ]);
    // The list is the last successful answer: two gone from it, the refused one still there and now gone.
    expect(fixture.componentInstance.items()!.length).toBe(16);
    list().setFilter('recordType', 'TASK');
    settle();
    expect(row('f-03').getAttribute('data-gone')).toBe('true');
    // The refused file stays selected; the restored ones left the selection.
    expect(text(el.querySelector('[data-testid="bin-bulk"]'))).toContain('1 selected');
    // Even if they come back to the bin (deleted again), they come back unticked.
    fixture.componentInstance.items.set(BIN_18);
    settle();
    expect(text(el.querySelector('[data-testid="bin-bulk"]'))).toContain('1 selected');
  }));

  it('a file no longer in the bin (404) is reported and the bin is read again', fakeAsync(() => {
    render(BIN_ONE);
    press(row('f-1'), 'bin-restore');
    press(dialog(), 'restore-send');
    http.expectOne(`${URL}/f-1/restore`).flush({ message: 'File not found' }, { status: 404, statusText: 'Not Found' });
    settle();
    http.expectOne(URL).flush([]);
    settle();
    expect(text(el.querySelector('[data-testid="bin-outcome"]'))).toContain('Ward 6A observations.docx: It was no longer in the recycle bin.');
  }));

  it('several with a known gone one: counted as skipped and never sent', fakeAsync(() => {
    render(BIN_WITH_GONE);
    select('f-live');
    select('f-gone');
    press(el, 'bulk-restore');
    expect(text(dialog().querySelector('.p-dialog-title'))).toBe('Restore 2 files?');
    expect(text(dialog().querySelector('[data-testid="restore-body"]'))).toContain(
      '1 file goes back to its record. 1 is skipped: its record no longer exists.',
    );
    expect(text(dialog().querySelector('[data-testid="restore-skipped"]'))).toBe('1 file');
    expect(text(button(dialog(), 'restore-send'))).toBe('Restore 1 file');
    press(dialog(), 'restore-send');
    http.expectOne(`${URL}/f-live/restore`).flush([BIN_WITH_GONE[1]!]);
    settle();
    expect(ids()).toEqual(['f-gone']);
  }));

  // ── purge ─────────────────────────────────────────────────────────────────

  it('purge: unavailable until ticked, then one request for the selection, and the bin read again', fakeAsync(() => {
    render(BIN_18);
    for (const id of ['f-12', 'f-01', 'f-07']) select(id);
    press(el, 'bulk-purge');
    expect(text(dialog().querySelector('.p-dialog-title'))).toBe('Purge 3 files for good?');
    expect(text(dialog().querySelector('[data-testid="purge-note"]'))).toMatch(/^3 files, .+, are deleted from storage now\. This can't be undone, and they can't be restored\.$/);
    expect(text(dialog().querySelector('[data-testid="purge-count"]'))).toBe('3');
    const send = button(dialog(), 'purge-send')!;
    expect(send.disabled).withContext('not ticked').toBeTrue();
    send.click();
    settle();
    http.expectNone(`${URL}/purge`);

    dialog().querySelector<HTMLElement>('[data-testid="purge-tick"] input')!.click();
    settle();
    expect(button(dialog(), 'purge-send')!.disabled).toBeFalse();
    press(dialog(), 'purge-send');
    const req = http.expectOne(`${URL}/purge`);
    expect(req.request.method).toBe('POST');
    expect([...req.request.body.fileIds].sort()).toEqual(['f-01', 'f-07', 'f-12']);
    req.flush({ purged: 3 });
    settle();
    http.expectOne(URL).flush(BIN_18.filter((i) => !['f-01', 'f-07', 'f-12'].includes(i.id)));
    settle();
    expect(text(el.querySelector('[data-testid="bin-outcome"] p'))).toBe('3 files purged.');
    expect(el.querySelector('[data-testid="bin-bulk"]')).toBeNull();
    expect(fixture.componentInstance.items()!.length).toBe(15);
  }));

  it('the tick starts clear every time the dialog opens', fakeAsync(() => {
    render(BIN_ONE);
    press(row('f-1'), 'bin-purge');
    expect(text(dialog().querySelector('.p-dialog-title'))).toBe('Purge “Ward 6A observations.docx” for good?');
    dialog().querySelector<HTMLElement>('[data-testid="purge-tick"] input')!.click();
    settle();
    expect(button(dialog(), 'purge-send')!.disabled).toBeFalse();
    fixture.componentInstance.purgeOpen.set(false);
    settle();
    press(row('f-1'), 'bin-purge');
    expect(button(dialog(), 'purge-send')!.disabled).toBeTrue();
  }));

  it('purge 404: nothing purged, the bin read again, and the page says so', fakeAsync(() => {
    render(BIN_ONE);
    press(row('f-1'), 'bin-purge');
    dialog().querySelector<HTMLElement>('[data-testid="purge-tick"] input')!.click();
    settle();
    press(dialog(), 'purge-send');
    http.expectOne(`${URL}/purge`).flush({ message: 'File not found' }, { status: 404, statusText: 'Not Found' });
    settle();
    http.expectOne(URL).flush(BIN_ONE);
    settle();
    const outcome = el.querySelector('[data-testid="bin-outcome"]')!;
    expect(outcome.getAttribute('role')).toBe('alert');
    expect(text(outcome)).toContain('Some files had already gone; nothing was purged. Check the list and try again.');
    expect(fixture.componentInstance.purgeOpen()).toBeFalse();
  }));

  for (const [code, status, words] of [
    [
      'STORAGE_ACCESS_WITHDRAWN',
      409,
      "Your organization's SharePoint storage can't be reached: access was withdrawn or its client secret is no longer valid. Ask your administrator.",
    ],
    ['STORAGE_UNAVAILABLE', 502, "File storage couldn't be reached. Try again."],
  ] as const) {
    it(`purge refused ${code}: its words in the dialog, nothing purged, nothing read again`, fakeAsync(() => {
      render(BIN_ONE);
      press(row('f-1'), 'bin-purge');
      dialog().querySelector<HTMLElement>('[data-testid="purge-tick"] input')!.click();
      settle();
      press(dialog(), 'purge-send');
      http.expectOne(`${URL}/purge`).flush({ code, message: 'server English' }, { status, statusText: 'x' });
      settle();
      const lines = Array.from(dialog().querySelectorAll('[data-testid="purge-error"] p')).map((p) => text(p));
      expect(lines).toEqual([words, 'Nothing was purged.']);
      expect(text(dialog())).not.toContain('server English');
      expect(fixture.componentInstance.purgeOpen()).toBeTrue();
    }));
  }

  it('more than 100 selected: the dialog says so, has no tick, and sends nothing', fakeAsync(() => {
    const many = Array.from({ length: 101 }, (_, i) => binItem({ id: `m-${i}`, name: `File ${i}.pdf`, mimeType: 'application/pdf' }));
    render(many);
    fixture.componentInstance.openPurge(many);
    settle();
    expect(text(dialog().querySelector('[data-testid="purge-too-many"]'))).toBe('You can purge up to 100 files at a time. Select 100 or fewer.');
    expect(dialog().querySelector('[data-testid="purge-tick"]')).toBeNull();
    expect(button(dialog(), 'purge-send')!.disabled).toBeTrue();
    // The page refuses it too, not only the dialog's button.
    fixture.componentInstance.confirmPurge();
    http.expectNone(`${URL}/purge`);
  }));

  // ── selection ─────────────────────────────────────────────────────────────

  it('the header box selects every file on the page, and Clear selection empties it', fakeAsync(() => {
    render(BIN_18);
    el.querySelector<HTMLInputElement>('[data-testid="bin-select-page"]')!.click();
    settle();
    expect(text(el.querySelector('[data-testid="bin-bulk"]'))).toMatch(/^10 selected · /);
    expect(rows().every((r) => r.getAttribute('aria-selected') === 'true')).toBeTrue();
    press(el, 'bulk-clear');
    expect(el.querySelector('[data-testid="bin-bulk"]')).toBeNull();
  }));

  it('reads in Arabic', fakeAsync(() => {
    render(BIN_ONE, 'ar');
    expect(text(row('f-1').querySelector('[data-cell="daysLeft"]'))).toBe('28 يومًا');
    expect(text(row('f-1').querySelector('[data-cell="from"] .am-bin__meta'))).toBe('مهمة');
    expect(fixture.componentInstance.purpose()).toContain('تبقى الملفات المحذوفة هنا 30 يومًا');
    expect(text(el)).not.toContain('recycleBin.');
  }));
});
