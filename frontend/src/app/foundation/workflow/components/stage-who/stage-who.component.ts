import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChildren,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import {
  SimpleListColumn,
  SimpleListComponent,
  SimpleListPage,
  SimpleListQuery,
} from '../../../../shared/components/simple-list/simple-list.component';
import {
  StageWhoMode,
  WhoCommitteeOptionDto,
  WhoPersonOptionDto,
  WorkflowStageDto,
  WorkflowTemplateDto,
  WorkflowTemplateService,
} from '../../services/workflow-template.service';
import { workflowLabelKey } from '../../workflow-labels';
import { StageWhoDraft } from './stage-who-draft';
import { StageWhoEntryComponent } from './stage-who-entry.component';
import { WhoRow } from './stage-who.model';

/** The drawn help line under each mode; a mode with none shows none. */
const MODE_HELP: Readonly<Record<string, string>> = {
  ANY_ONE: 'workflow.who.modeHelp.ANY_ONE',
  ALL: 'workflow.who.modeHelp.ALL',
  COMMITTEE_VOTE: 'workflow.who.modeHelp.COMMITTEE_VOTE',
};

/**
 * ACC-271 PR 5a — "Who works this stage" (drawing section 8), in the stage
 * editor panel. It replaced the panel's "Who the work lands on" and "How
 * approval is reached" cards: who works a stage is now the stage's list of
 * entries, joined by "or", and how several of them decide.
 *
 * It draws the panel's StageWhoDraft; nothing here is a rule:
 *   - the kinds are the template's `assigneeKinds`, each kind's fields its `whoRules`;
 *   - "When there are several people" shows, and offers its modes, as
 *     `whoRules` says; a chosen mode the list can't use falls back to the
 *     default mode, and a sentence says so;
 *   - the read-back sentence is the server's (`whoSentence`), announced politely,
 *     and stands for what is SAVED — while the list differs, a line says it
 *     will read back once saved;
 *   - a refusal lands in its slot (the section, the mode, or a row's field).
 *
 * A protected workflow shows the section read-only.
 */
@Component({
  selector: 'am-stage-who',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, StageWhoEntryComponent, ListDialogComponent, SimpleListComponent],
  template: `
    @let d = draft();
    <section class="am-who" aria-labelledby="who-title" data-section="who">
      <h3 id="who-title" class="am-who__title">{{ 'workflow.who.title' | translate }}</h3>

      @if (d.rows().length) {
        <div class="am-who__rows" role="list">
          @for (row of d.rows(); track row.key; let i = $index; let last = $last) {
            <div role="listitem" class="am-who__item">
              <am-stage-who-entry
                [row]="row"
                [index]="i"
                [kinds]="template()?.assigneeKinds ?? []"
                [rules]="template()?.whoRules"
                [recordRoutes]="template()?.recordRoutes ?? { unit: false, committee: false }"
                [readonly]="readonly()"
                [submitted]="submitted()"
                (removed)="remove(row, i)"
                (pickPerson)="openPeople(row)"
                (pickCommittee)="openCommittees(row)"
              />
            </div>
            @if (!last) {
              <p class="am-who__or" aria-hidden="true">{{ 'workflow.who.or' | translate }}</p>
            }
          }
        </div>
      } @else if (readonly()) {
        <p class="am-who__note">{{ 'workflow.who.nobody' | translate }}</p>
      }

      @if (d.sectionError(); as key) {
        <small class="am-who__error" role="alert" data-who-section-error>{{ key | translate }}</small>
      }

      @if (!readonly()) {
        <button type="button" class="am-who__add" (click)="add()" data-who-add>{{ 'workflow.who.addAnother' | translate }}</button>
      }

      @if (hasStarting()) {
        <p class="am-who__note" data-starting-note>{{ 'workflow.who.startingNote' | translate }}</p>
      }

      @if (d.choice().shown) {
        <fieldset class="am-who__modes" data-who-modes>
          <legend class="am-who__legend">{{ 'workflow.who.modesLegend' | translate }}</legend>
          @if (readonly()) {
            <p class="am-who__mode-ro" data-who-mode-readonly>{{ modeLabel(d.mode()) }}</p>
          } @else {
            <div class="am-who__seg" role="radiogroup" [attr.aria-label]="'workflow.who.modesLegend' | translate">
              @for (mode of d.choice().offered; track mode) {
                <label class="am-who__seg-option" [class.am-who__seg-option--on]="d.mode() === mode">
                  <input
                    type="radio"
                    class="am-who__sr"
                    name="who-mode"
                    [value]="mode"
                    [checked]="d.mode() === mode"
                    (change)="d.setMode(mode)"
                    [attr.data-who-mode]="mode"
                  />
                  {{ modeLabel(mode) }}
                </label>
              }
            </div>
          }
          @if (modeHelp(); as help) {
            <p class="am-who__note" data-who-mode-help>{{ help }}</p>
          }
          @if (fallbackText(); as text) {
            <p class="am-who__note am-who__note--warn" role="status" data-who-fallback>{{ text }}</p>
          }
          @if (d.modeError(); as key) {
            <small class="am-who__error" role="alert" data-who-mode-error>{{ key | translate }}</small>
          }
        </fieldset>
      }

      <p class="am-who__readback" aria-live="polite" data-who-readback>
        @if (readback(); as text) {
          {{ text }}
        } @else {
          <span class="am-who__readback-pending">{{ 'workflow.who.readbackPending' | translate }}</span>
        }
      </p>
    </section>

    <ng-template #peopleBody>
      <am-simple-list
        [load]="loadPeople"
        [columns]="peopleColumns()"
        grid="minmax(0,1.6fr) minmax(0,1fr)"
        [row]="personCells"
        defaultSort="name:asc"
        [searchLabel]="'workflow.who.searchPeople' | translate"
        [emptyText]="'workflow.who.noPeople' | translate"
        [noMatchText]="'workflow.who.noMatch' | translate: { q: pickerQuery() }"
        [countText]="peopleCount"
        [selectable]="true"
        (picked)="pickedPerson($event)"
      />
    </ng-template>
    <ng-template #personCells let-person>
      <span class="am-who__cell">{{ person.name }}</span>
      <span class="am-who__cell am-who__cell--meta">{{
        (person.status === 'INVITED' ? 'workflow.who.invited' : 'workflow.who.active') | translate
      }}</span>
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="picker() === 'people'"
      [heading]="'workflow.who.choosePerson' | translate"
      [closeLabel]="'workflow.who.closePicker' | translate"
      [body]="peopleBody"
      (closeRequested)="closePicker()"
    />

    <ng-template #committeesBody>
      <am-simple-list
        [load]="loadCommittees"
        [columns]="committeeColumns()"
        grid="minmax(0,1fr)"
        [row]="committeeCells"
        defaultSort="name:asc"
        [searchLabel]="'workflow.who.searchCommittees' | translate"
        [emptyText]="'workflow.who.noCommittees' | translate"
        [noMatchText]="'workflow.who.noMatch' | translate: { q: pickerQuery() }"
        [countText]="committeeCount"
        [selectable]="true"
        (picked)="pickedCommittee($event)"
      />
    </ng-template>
    <ng-template #committeeCells let-committee>
      <span class="am-who__cell">{{ committeeName(committee) }}</span>
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="picker() === 'committees'"
      [heading]="'workflow.who.chooseCommittee' | translate"
      [closeLabel]="'workflow.who.closePicker' | translate"
      [body]="committeesBody"
      (closeRequested)="closePicker()"
    />
  `,
  styles: [
    `
      :host {
        display: block;
        min-inline-size: 0;
      }
      .am-who {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
        min-inline-size: 0;
        padding: var(--am-space-12);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-control);
      }
      .am-who__title {
        margin: 0 0 var(--am-space-4);
        font-size: var(--am-type-body-size);
        font-weight: 600;
      }
      .am-who__rows {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-4);
        min-inline-size: 0;
      }
      .am-who__item {
        min-inline-size: 0;
      }
      .am-who__or {
        margin: 0;
        font-size: var(--am-type-meta-size);
        font-weight: 600;
        color: var(--am-text-secondary);
        text-transform: lowercase;
      }
      .am-who__add {
        align-self: flex-start;
        padding: var(--am-space-4) 0;
        border: 0;
        background: none;
        font: inherit;
        font-weight: 600;
        color: var(--am-primary-700);
        cursor: pointer;
      }
      .am-who__add:focus-visible,
      .am-who__seg-option:focus-within {
        outline: 2px solid var(--am-primary-600);
        outline-offset: 2px;
      }
      .am-who__note,
      .am-who__readback-pending {
        margin: 0;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-text-secondary);
        overflow-wrap: anywhere;
      }
      .am-who__note--warn {
        color: var(--am-warning-ink);
        font-weight: 500;
      }
      .am-who__error {
        font-size: var(--am-type-meta-size);
        font-weight: 500;
        color: var(--am-danger-ink);
      }
      .am-who__modes {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-4);
        min-inline-size: 0;
        margin: var(--am-space-4) 0 0;
        padding: 0;
        border: 0;
      }
      .am-who__legend {
        padding: 0;
        margin-block-end: var(--am-space-4);
        font-size: var(--am-type-body-size);
        font-weight: 600;
      }
      .am-who__seg {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-4);
      }
      .am-who__seg-option {
        display: inline-flex;
        align-items: center;
        min-block-size: 32px;
        padding: 0 var(--am-space-12);
        border: 1px solid var(--am-control-border, var(--am-border));
        border-radius: var(--am-radius-control);
        background: var(--am-card);
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      .am-who__seg-option--on {
        border-color: var(--am-primary-600);
        background: var(--am-info-bg);
        color: var(--am-primary-700);
        font-weight: 600;
      }
      .am-who__mode-ro {
        margin: 0;
      }
      .am-who__readback {
        margin: var(--am-space-4) 0 0;
        padding: var(--am-space-8) var(--am-space-12);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-control);
        background: var(--am-surface);
        font-size: var(--am-type-body-size);
        overflow-wrap: anywhere;
      }
      .am-who__cell {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .am-who__cell--meta {
        font-size: 12px;
        color: var(--am-ink-700);
      }
      .am-who__sr {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        opacity: 0;
      }
    `,
  ],
})
export class StageWhoComponent {
  readonly draft = input.required<StageWhoDraft>();
  readonly template = input<WorkflowTemplateDto | null>(null);
  /** The stage as last loaded or saved: its whoSentence reads back what is stored. */
  readonly stage = input<WorkflowStageDto | null>(null);
  readonly readonly = input(false);
  readonly submitted = input(false);

  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);
  private readonly service = inject(WorkflowTemplateService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly entries = viewChildren(StageWhoEntryComponent);

  readonly picker = signal<'people' | 'committees' | null>(null);
  readonly pickerQuery = signal('');
  private pickingFor: WhoRow | null = null;
  private pickerOpener: HTMLElement | null = null;

  readonly hasStarting = computed(() => {
    const d = this.draft();
    d.tick();
    return d.rows().some((r) => !!r.saved?.isStartingAssignment);
  });

  /** The server's sentence for what is saved, while the list still says the same; else null. */
  readonly readback = computed(() => {
    this.translate.currentLang();
    const d = this.draft();
    const sentence = this.stage()?.whoSentence;
    if (!sentence || d.hasChanges()) return null;
    return this.language.isArabic() ? sentence.ar || sentence.en : sentence.en;
  });

  readonly modeHelp = computed(() => {
    this.translate.currentLang();
    const key = MODE_HELP[this.draft().mode()];
    return key ? (this.translate.instant(key) as string) : '';
  });

  readonly fallbackText = computed(() => {
    this.translate.currentLang();
    const d = this.draft();
    const chosen = d.fellBack();
    return chosen && !this.readonly() ? (this.translate.instant('workflow.who.fallback', { mode: this.modeLabel(chosen), fallback: this.modeLabel(d.mode()) }) as string) : '';
  });

  modeLabel(mode: StageWhoMode): string {
    return this.translate.instant(workflowLabelKey('whoMode', mode)) as string;
  }

  // ── The list ───────────────────────────────────────────────────────────────

  /** "+ Add another": a new row, with focus on its Kind. */
  add(): void {
    const row = this.draft().addRow();
    afterNextRender(() => this.entries().find((e) => e.row() === row)?.focusKind(), { injector: this.injector });
  }

  /** Remove: focus moves to the next row's Remove, or to "+ Add another" when it was the last. */
  remove(row: WhoRow, index: number): void {
    this.draft().removeRow(row);
    afterNextRender(
      () => {
        const next = this.entries()[index];
        if (next) next.focusRemove();
        else this.host.nativeElement.querySelector<HTMLElement>('[data-who-add]')?.focus();
      },
      { injector: this.injector },
    );
  }

  // ── The pickers (searched and paged on the server) ─────────────────────────

  openPeople(row: WhoRow): void {
    this.open('people', row);
  }

  openCommittees(row: WhoRow): void {
    this.open('committees', row);
  }

  private open(which: 'people' | 'committees', row: WhoRow): void {
    this.pickingFor = row;
    this.pickerOpener = document.activeElement as HTMLElement | null;
    this.pickerQuery.set('');
    this.picker.set(which);
  }

  closePicker(): void {
    this.picker.set(null);
    this.pickingFor = null;
    const opener = this.pickerOpener;
    this.pickerOpener = null;
    if (opener?.isConnected) afterNextRender(() => opener.focus(), { injector: this.injector });
  }

  pickedPerson(person: WhoPersonOptionDto): void {
    const row = this.pickingFor;
    if (row) {
      row.userName.set(person.name);
      row.group.controls.userId.setValue(person.id);
      row.group.controls.userId.markAsDirty();
    }
    this.closePicker();
  }

  pickedCommittee(committee: WhoCommitteeOptionDto): void {
    const row = this.pickingFor;
    if (row) {
      row.committee.set({ nameEn: committee.nameEn, nameAr: committee.nameAr });
      row.group.controls.committeeId.setValue(committee.id);
      row.group.controls.committeeId.markAsDirty();
    }
    this.closePicker();
  }

  committeeName(c: WhoCommitteeOptionDto): string {
    return this.language.bilingual(c.nameEn, c.nameAr);
  }

  readonly loadPeople = (query: SimpleListQuery): Observable<SimpleListPage<WhoPersonOptionDto>> => {
    this.pickerQuery.set(query.q ?? '');
    return this.service.getWhoPeople(query);
  };

  readonly loadCommittees = (query: SimpleListQuery): Observable<SimpleListPage<WhoCommitteeOptionDto>> => {
    this.pickerQuery.set(query.q ?? '');
    return this.service.getWhoCommittees(query, this.language.isArabic() ? 'ar' : 'en');
  };

  readonly peopleColumns = computed<SimpleListColumn[]>(() => {
    this.translate.currentLang();
    return [
      { label: this.translate.instant('workflow.who.col.name'), sort: 'name' },
      { label: this.translate.instant('workflow.who.col.status') },
    ];
  });

  readonly committeeColumns = computed<SimpleListColumn[]>(() => {
    this.translate.currentLang();
    return [{ label: this.translate.instant('workflow.who.col.committee'), sort: 'name' }];
  });

  readonly peopleCount = (n: number, searching: boolean): string => this.format.count(searching ? 'workflow.who.peopleMatch' : 'workflow.who.people', n);

  readonly committeeCount = (n: number, searching: boolean): string =>
    this.format.count(searching ? 'workflow.who.committeesMatch' : 'workflow.who.committees', n);
}
