// ACC-280 — New task's record picker (backend/Plans/step-280-task-record-picker.md §3).
//
// NEVER A TYPED ID. The field shows the chosen record's name, and its search
// button opens a server-searched list AS ITS OWN LAYER above the New task dialog
// (ACC-111 case 2; the stage editor's and Add member's pattern): `am-simple-list`
// in `am-list-dialog size="compact"`, reading GET /tasks/record-choices. The list
// dialog owns Escape (the top layer only, LayerStackService) and gives focus back.
//
// It names only records the viewer may open: the server lists exactly those
// (committees:view, or the viewer's own committees by membership) that take new
// tasks, so an inactive or dissolved committee is never offered.
//
// NO RECORDS (decision 4): when the type has none for this viewer, the field and
// the list both say so. The field learns it from ONE small read (take 1) the first
// time the field shows for a type in this dialog; the store keeps the answer, so
// moving between the form's steps reads nothing again.
//
// The chosen record lives in TaskRecordChoiceStore (provided by the form), not
// here: the form's steps rebuild this component, and the choice must survive them.

import { Component, Injectable, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, tap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService, type PluralKey } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import {
  SimpleListColumn,
  SimpleListComponent,
  SimpleListPage,
  SimpleListQuery,
} from '../../../../shared/components/simple-list/simple-list.component';
import { TaskRecordChoiceDto, TaskService } from '../../services/task.service';

/** The words a record type is named by. A type with none of its own uses the generic set. */
interface RecordWords {
  label: string;
  choose: string;
  find: string;
  search: string;
  none: string;
  column: string;
  count: PluralKey;
  countMatch: PluralKey;
}

const words = (key: string, count: PluralKey, countMatch: PluralKey): RecordWords => ({
  label: `task.record.${key}.label`,
  choose: `task.record.${key}.choose`,
  find: `task.record.${key}.find`,
  search: `task.record.${key}.search`,
  none: `task.record.${key}.none`,
  column: `task.record.${key}.column`,
  count,
  countMatch,
});

/**
 * A type's own words: Arabic needs a noun of its own gender per type, never "a
 * {type}" (plan §4). A type the server names that has no words yet is still
 * usable, under the generic ones.
 */
const RECORD_WORDS: Readonly<Record<string, RecordWords>> = {
  COMMITTEE: words('committee', 'task.record.committee.count', 'task.record.committee.countMatch'),
};
const GENERIC_WORDS = words('generic', 'task.record.generic.count', 'task.record.generic.countMatch');

export function recordWordsFor(type: string | null | undefined): RecordWords {
  return (type && RECORD_WORDS[type]) || GENERIC_WORDS;
}

/**
 * ACC-280 — the record chosen in one New task dialog, and how many records each
 * type offers this viewer. Provided by the form, so it ends with the dialog.
 */
@Injectable()
export class TaskRecordChoiceStore {
  private readonly tasks = inject(TaskService);
  private readonly language = inject(LanguageService);

  readonly chosen = signal<TaskRecordChoiceDto | null>(null);
  /** Per type: how many records there are to choose from, once known; 'failed' when the read failed. */
  private readonly totals = signal<Readonly<Record<string, number | 'failed'>>>({});

  totalFor(type: string): number | 'failed' | undefined {
    return this.totals()[type];
  }

  /** One small read per type per dialog, so the field can say "none" before the list opens. */
  ensureTotal(type: string): void {
    if (this.totals()[type] !== undefined) return;
    this.tasks.getRecordChoices(type, { take: 1, skip: 0 }, this.lang()).subscribe({
      next: (page) => this.setTotal(type, page.total),
      error: () => this.setTotal(type, 'failed'),
    });
  }

  /** A page for the list; an unsearched page also tells the field how many there are. */
  page(type: string, query: SimpleListQuery): Observable<SimpleListPage<TaskRecordChoiceDto>> {
    return this.tasks
      .getRecordChoices(type, { q: query.q, take: query.take, skip: query.skip }, this.lang())
      .pipe(tap((page) => this.setTotal(type, page.total)));
  }

  private setTotal(type: string, total: number | 'failed'): void {
    this.totals.update((all) => ({ ...all, [type]: total }));
  }

  private lang(): 'en' | 'ar' {
    return this.language.isArabic() ? 'ar' : 'en';
  }
}

@Component({
  selector: 'app-task-record-picker',
  standalone: true,
  imports: [TranslatePipe, InputTextModule, FieldComponent, ListDialogComponent, SimpleListComponent],
  template: `
    <am-field
      [label]="words().label | translate"
      [control]="control()"
      [errorMessages]="{ required: words().choose }"
      [forceShowErrors]="forceShowErrors()"
      [inputId]="inputId"
    >
      <div class="am-trp">
        <input
          pInputText
          readonly
          class="am-trp__text"
          [id]="inputId"
          [value]="chosenName()"
          [placeholder]="placeholder() | translate"
          [attr.title]="chosenName() || null"
          (click)="openList()"
          (keydown.enter)="$event.preventDefault(); openList()"
          data-record-field
        />
        <button
          type="button"
          class="am-trp__button"
          [attr.aria-label]="words().find | translate"
          [attr.title]="words().find | translate"
          (click)="openList()"
          data-record-find
        >
          <i class="pi pi-search" aria-hidden="true"></i>
        </button>
      </div>
    </am-field>

    <ng-template #listBody>
      <am-simple-list
        [load]="load"
        [columns]="columns()"
        grid="minmax(0,1fr)"
        [row]="recordCells"
        defaultSort="name:asc"
        [searchLabel]="words().search | translate"
        [emptyText]="words().none | translate"
        [noMatchText]="'task.record.noMatch' | translate: { q: query() }"
        [countText]="countText"
        [selectable]="true"
        (picked)="pick($event)"
      />
    </ng-template>
    <ng-template #recordCells let-record>
      <span class="am-trp__cell" [attr.title]="name(record)">{{ name(record) }}</span>
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="listOpen()"
      [heading]="words().choose | translate"
      [closeLabel]="'task.record.closeList' | translate"
      [body]="listBody"
      (closeRequested)="closeList()"
    />
  `,
  styles: [
    `
      :host {
        display: block;
        min-inline-size: 0;
      }
      .am-trp {
        display: flex;
        gap: var(--am-space-8);
        align-items: center;
        min-inline-size: 0;
      }
      /* A zero basis AND width: an input's intrinsic width would hold the row wider than a phone. */
      .am-trp__text {
        flex: 1 1 0;
        inline-size: 0;
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }
      .am-trp__button {
        flex: none;
        inline-size: 36px;
        block-size: 36px;
        border: 1px solid var(--am-control-border, var(--am-border));
        border-radius: var(--am-radius-control);
        background: var(--am-card);
        color: var(--am-ink-700);
        cursor: pointer;
      }
      .am-trp__button:hover {
        border-color: var(--am-control-border-hover);
      }
      .am-trp__button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-trp__cell {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class TaskRecordPickerComponent {
  private static nextId = 0;

  private readonly store = inject(TaskRecordChoiceStore);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  /** The record type to choose from: one of the server's create types. */
  readonly sourceType = input.required<string>();
  /** The form's sourceId control: the chosen record's id, required. */
  readonly control = input.required<FormControl<string | null>>();
  readonly forceShowErrors = input(false);

  readonly inputId = `task-record-${TaskRecordPickerComponent.nextId++}`;
  readonly listOpen = signal(false);
  readonly query = signal('');

  readonly words = computed(() => recordWordsFor(this.sourceType()));

  readonly chosenName = computed(() => {
    const chosen = this.store.chosen();
    return chosen ? this.name(chosen) : '';
  });

  /** "No committees you can add tasks to." once the type is known to have none; otherwise "Choose a committee". */
  readonly placeholder = computed(() => (this.store.totalFor(this.sourceType()) === 0 ? this.words().none : this.words().choose));

  readonly columns = computed<SimpleListColumn[]>(() => {
    this.translate.currentLang();
    return [{ label: this.translate.instant(this.words().column) }];
  });

  constructor() {
    effect(() => {
      const type = this.sourceType();
      untracked(() => this.store.ensureTotal(type));
    });
  }

  name(record: TaskRecordChoiceDto): string {
    return this.language.bilingual(record.nameEn, record.nameAr);
  }

  openList(): void {
    this.listOpen.set(true);
  }

  closeList(): void {
    this.listOpen.set(false);
  }

  pick(record: TaskRecordChoiceDto): void {
    this.store.chosen.set(record);
    const control = this.control();
    control.setValue(record.id);
    control.markAsDirty();
    control.markAsTouched();
    this.closeList();
  }

  readonly load = (query: SimpleListQuery): Observable<SimpleListPage<TaskRecordChoiceDto>> => {
    this.query.set(query.q ?? '');
    return this.store.page(this.sourceType(), query);
  };

  readonly countText = (n: number, searching: boolean): string =>
    this.format.count(searching ? this.words().countMatch : this.words().count, n);
}
