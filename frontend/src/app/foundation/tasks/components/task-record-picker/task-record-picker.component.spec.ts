import { Component, TemplateRef, ViewChild, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { FormControl, Validators } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { TaskRecordChoiceDto } from '../../services/task.service';
import { TaskRecordChoiceStore, TaskRecordPickerComponent } from './task-record-picker.component';

// ACC-280 — New task's record picker (plan §3, §7): never a typed id; a
// server-searched list as its own layer above the New task dialog; Escape closes
// only that layer; "none" said in the field and the list; Arabic names falling
// back to English. Hosted the way the form hosts it: inside EditDialogComponent,
// with the dialog's [dirty] set, so a wrong Escape would ask to discard.

const API = environment.apiUrl;

const committee = (n: number, over: Partial<TaskRecordChoiceDto> = {}): TaskRecordChoiceDto => ({
  id: `cmt-${n}`,
  nameEn: `Committee ${String(n).padStart(2, '0')}`,
  nameAr: `لجنة ${n}`,
  ...over,
});

@Component({
  standalone: true,
  imports: [EditDialogComponent, TaskRecordPickerComponent],
  providers: [TaskRecordChoiceStore],
  template: `
    <ng-template #body>
      <app-task-record-picker sourceType="COMMITTEE" [control]="control" />
    </ng-template>
    <app-edit-dialog [(visible)]="visible" header="New task" [content]="body" [dirty]="true" />
  `,
})
class HostComponent {
  @ViewChild('body', { read: TemplateRef, static: true }) body!: TemplateRef<unknown>;
  readonly visible = signal(true);
  readonly control = new FormControl<string | null>('', Validators.required);
}

describe('TaskRecordPickerComponent (ACC-280)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let confirm: jasmine.Spy;

  const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
  const field = () => q<HTMLInputElement>('[data-record-field]')!;
  const choices = (match: (r: TestRequest['request']) => boolean = () => true) =>
    http.expectOne((r) => r.url === `${API}/tasks/record-choices` && match(r));

  /** Opens the host in `language`; the field's one small read is answered with `total`, or fails. */
  function setup(language: 'en' | 'ar' = 'en', total: number | 'fail' = 12): void {
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
    TestBed.inject(TranslateService).use(language);
    confirm = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const count = choices((r) => r.params.get('take') === '1');
    expect(count.request.params.get('type')).toBe('COMMITTEE');
    expect(count.request.params.get('skip')).toBe('0');
    if (total === 'fail') count.flush({ message: 'x' }, { status: 500, statusText: 'Server Error' });
    else count.flush({ items: [], total, matching: total });
    fixture.detectChanges();
  }

  /** Presses the search button; the list's first page is answered with `items`. */
  function openList(items: TaskRecordChoiceDto[], total = items.length): TestRequest {
    q<HTMLButtonElement>('[data-record-find]')!.click();
    fixture.detectChanges();
    const page = choices((r) => r.params.get('take') === '50');
    page.flush({ items, total, matching: total });
    fixture.detectChanges();
    return page;
  }

  const rows = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.am-sl__pick'));

  afterEach(() => http.verify());

  it('is read-only: typed text never becomes an id', () => {
    setup();
    expect(field().readOnly).toBeTrue();
    field().value = 'cmt-typed';
    field().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBe('');
    // Its label names the type (decision 3): no type field, no "Source ID".
    expect(document.querySelector('app-task-record-picker label')!.textContent).toContain('Committee');
    expect(field().placeholder).toBe('Choose a committee');
  });

  it('opens the list as its own layer above the dialog, reading the server in the reader\'s language', () => {
    setup();
    const layers = TestBed.inject(LayerStackService);
    expect(layers.depth()).toBe(1);
    const page = openList([committee(1), committee(2)]);
    expect(page.request.params.get('type')).toBe('COMMITTEE');
    expect(page.request.params.get('skip')).toBe('0');
    expect(page.request.params.get('lang')).toBe('en');
    expect(layers.depth()).withContext('the dialog and the list are both layers').toBe(2);
    expect(rows().map((r) => r.textContent!.trim())).toEqual(['Committee 01', 'Committee 02']);
  });

  it('searches on the server, and Load more asks for the next 50', fakeAsync(() => {
    setup();
    const first = Array.from({ length: 50 }, (_, i) => committee(i + 1));
    openList(first, 60);
    q<HTMLButtonElement>('[data-testid="simple-list-more"]')!.click();
    fixture.detectChanges();
    const more = choices((r) => r.params.get('skip') === '50');
    expect(more.request.params.get('take')).toBe('50');
    more.flush({ items: Array.from({ length: 10 }, (_, i) => committee(i + 51)), total: 60, matching: 60 });
    fixture.detectChanges();
    expect(rows().length).toBe(60);

    const search = q<HTMLInputElement>('[data-testid="simple-list-search"]')!;
    search.value = 'quality';
    search.dispatchEvent(new Event('input'));
    tick(300);
    fixture.detectChanges();
    const searched = choices((r) => r.params.get('q') === 'quality');
    expect(searched.request.params.get('skip')).toBe('0');
    searched.flush({ items: [committee(7, { nameEn: 'Quality Committee' })], total: 60, matching: 1 });
    fixture.detectChanges();
    expect(rows().map((r) => r.textContent!.trim())).toEqual(['Quality Committee']);
    flush();
  }));

  it('picking a row fills the field, sets the id, and closes only the list', fakeAsync(() => {
    setup();
    openList([committee(1), committee(2, { nameEn: 'Pharmacy & Therapeutics Committee' })]);
    rows()[1]!.click();
    fixture.detectChanges();
    flush();
    fixture.detectChanges();
    expect(fixture.componentInstance.control.value).toBe('cmt-2');
    expect(field().value).toBe('Pharmacy & Therapeutics Committee');
    expect(field().title).toBe('Pharmacy & Therapeutics Committee');
    expect(TestBed.inject(LayerStackService).depth()).toBe(1);
    expect(fixture.componentInstance.visible()).toBeTrue();
  }));

  it('Escape with the list open closes ONLY the list: the dialog stays, and nothing asks to discard', fakeAsync(() => {
    setup();
    openList([committee(1)]);
    const layers = TestBed.inject(LayerStackService);
    expect(layers.depth()).toBe(2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    flush();
    expect(layers.depth()).toBe(1);
    expect(fixture.componentInstance.visible()).withContext('the New task dialog is still open').toBeTrue();
    expect(confirm).not.toHaveBeenCalled();
    expect(fixture.componentInstance.control.value).toBe('');
  }));

  it('no committee to choose: the field says so before the list opens, and the list says the same', () => {
    setup('en', 0);
    expect(field().placeholder).toBe('No committees you can add tasks to.');
    openList([]);
    expect(document.querySelector('[data-testid="simple-list"]')!.textContent).toContain('No committees you can add tasks to.');
  });

  it('a failed count read never claims "none": the field still asks to choose', () => {
    setup('en', 'fail');
    expect(field().placeholder).toBe('Choose a committee');
  });

  it('Arabic: the Arabic name, falling back to English when there is none (ACC-160)', fakeAsync(() => {
    setup('ar');
    expect(field().placeholder).toBe(ar.task.record.committee.choose);
    q<HTMLButtonElement>('[data-record-find]')!.click();
    fixture.detectChanges();
    const page = choices((r) => r.params.get('take') === '50');
    expect(page.request.params.get('lang')).toBe('ar');
    page.flush({ items: [committee(1), committee(2, { nameEn: 'Unnamed in Arabic', nameAr: null })], total: 2, matching: 2 });
    fixture.detectChanges();
    expect(rows().map((r) => r.textContent!.trim())).toEqual(['لجنة 1', 'Unnamed in Arabic']);
    rows()[1]!.click();
    fixture.detectChanges();
    flush();
    expect(field().value).toBe('Unnamed in Arabic');
  }));
});
