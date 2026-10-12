import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import {
  StageTaskDefinitionDto,
  StageTaskDefinitionListItemDto,
  StageTaskDefinitionSavedDto,
  TaskPriority,
  WorkflowStageDto,
  WorkflowTemplateDto,
  WorkflowTemplateService,
} from '../../services/workflow-template.service';
import { plainWorkflowRefusalKey } from '../../workflow-refusal';
import { stageTaskRouteLabel } from './stage-task-route-label';
import { StageTaskDefinitionFormComponent } from '../stage-task-definition-form/stage-task-definition-form.component';

/** What entering the stage creates, as the stage row's own summary carries it. */
export interface StageTaskSummary {
  taskDefinitionCount: number;
  longestTaskHours: number | null;
}

// Literal keys, so the translation-keys spec sees each one.
const PRIORITY_KEYS: Record<TaskPriority, string> = {
  LOW: 'task.priority.low',
  MEDIUM: 'task.priority.medium',
  HIGH: 'task.priority.high',
  CRITICAL: 'task.priority.critical',
};

type LoadState = 'loading' | 'ready' | 'error';

/**
 * ACC-208 — "Tasks on entry", beside Transitions in a stage's expanded row
 * (drawing section 1). Lists what entering the stage creates, in creation
 * order, with the stage's deadline arithmetic on top.
 *
 * ## It loads its own list and never reloads the template
 *
 * A definition change patches the stage row's summary through
 * `summaryChanged` instead of asking the page to re-read the template: a
 * template read replaces every stage, and ACC-55 is what that does to a dialog
 * open inside the row.
 *
 * ## Reorder is ↑ / ↓, and an arrow that cannot move is ABSENT
 *
 * The drawing's no-drag path. The first row has no ↑ and the last no ↓, so
 * after a move focus goes to the moved row's same arrow, or to its other one
 * when that arrow has just gone, and the move is announced. The drawing's drag
 * handle is not built (step-208 §8b): it is a second reorder mechanism, which
 * is a decision rather than a picture.
 */
@Component({
  selector: 'app-stage-task-list',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, EditDialogComponent, IconButtonComponent, StageTaskDefinitionFormComponent],
  template: `
    <section class="am-stage-tasks" [attr.aria-label]="'workflow.stageTasks.title' | translate">
      <div class="am-stage-tasks__head">
        <h3 class="am-stage-tasks__title">{{ 'workflow.stageTasks.title' | translate }}</h3>
        @if (canAdd() && rows().length > 0) {
          <p-button
            [label]="'workflow.stageTasks.add' | translate"
            [text]="true"
            size="small"
            (onClick)="openAdd()"
          />
        }
      </div>

      @if (stage().isFinal) {
        <p class="am-stage-tasks__note" data-stage-tasks-final>
          {{ 'workflow.stageTasks.finalStage' | translate }}
        </p>
      } @else {
        <p
          class="am-stage-tasks__summary"
          [class.am-stage-tasks__summary--late]="lateCount() > 0"
          data-stage-tasks-summary
        >
          @if (lateCount() > 0) {
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          }
          {{ summary() }}
        </p>

        @switch (state()) {
          @case ('loading') {
            <div class="am-stage-tasks__skeleton" aria-busy="true" data-stage-tasks-loading>
              <span class="am-skeleton-bar w-3/4"></span>
              <span class="am-skeleton-bar w-1/2"></span>
            </div>
          }
          @case ('error') {
            <div class="am-stage-tasks__error" role="alert" data-stage-tasks-error>
              <span>{{ 'workflow.stageTasks.loadError' | translate }}</span>
              <p-button [label]="'common.retry' | translate" [text]="true" size="small" (onClick)="load()" />
            </div>
          }
          @default {
            @if (rows().length === 0) {
              <div class="am-stage-tasks__empty" data-stage-tasks-empty>
                <p>{{ 'workflow.stageTasks.empty' | translate }}</p>
                @if (canAdd()) {
                  <p-button
                    icon="pi pi-plus"
                    [label]="'workflow.stageTasks.add' | translate"
                    [outlined]="true"
                    size="small"
                    (onClick)="openAdd()"
                  />
                }
              </div>
            } @else {
              <ol class="am-stage-tasks__list" [attr.aria-label]="'workflow.stageTasks.listAria' | translate">
                @for (row of rows(); track row.id; let i = $index; let first = $first; let last = $last) {
                  <li class="am-stage-task" [attr.data-stage-task]="row.id">
                    <span class="am-stage-task__n" aria-hidden="true">{{ i + 1 }}</span>
                    <div class="am-stage-task__body">
                      <span class="am-stage-task__title">{{ titleOf(row) }}</span>
                      @if (arabicSubtitle(row); as ar) {
                        <span class="am-stage-task__title-ar" dir="rtl">{{ ar }}</span>
                      }
                      <span class="am-stage-task__chips">
                        @if (row.isMandatory) {
                          <span class="am-chip am-chip--must"
                            ><span aria-hidden="true">●</span> {{ 'workflow.stageTasks.mandatory' | translate }}</span
                          >
                        } @else {
                          <span class="am-chip am-chip--optional"
                            ><span aria-hidden="true">○</span> {{ 'workflow.stageTasks.optional' | translate }}</span
                          >
                        }
                        @if (row.requiresEvidence) {
                          <span class="am-chip am-chip--neutral">{{ 'workflow.stageTasks.evidence' | translate }}</span>
                        }
                        @if (warningKey(row); as key) {
                          <span class="am-chip am-chip--warn" data-stage-task-warning
                            ><span aria-hidden="true">⚠</span> {{ key | translate }}</span
                          >
                        }
                      </span>
                      <span class="am-stage-task__line">{{ priorityLine(row) }}</span>
                      <span class="am-stage-task__line am-stage-task__line--quiet">{{ routeOf(row) }}</span>
                    </div>
                    @if (canManage()) {
                      <span class="am-stage-task__actions">
                        @if (!first) {
                          <am-icon-button
                            icon="pi pi-arrow-up"
                            [label]="'workflow.stageTasks.moveUpNamed' | translate: { title: titleOf(row) }"
                            [disabled]="busy()"
                            [attr.data-move]="row.id + ':up'"
                            (activated)="move(row, -1)"
                          />
                        }
                        @if (!last) {
                          <am-icon-button
                            icon="pi pi-arrow-down"
                            [label]="'workflow.stageTasks.moveDownNamed' | translate: { title: titleOf(row) }"
                            [disabled]="busy()"
                            [attr.data-move]="row.id + ':down'"
                            (activated)="move(row, 1)"
                          />
                        }
                        <am-icon-button
                          icon="pi pi-pencil"
                          [label]="'workflow.stageTasks.editNamed' | translate: { title: titleOf(row) }"
                          [disabled]="busy()"
                          (activated)="openEdit(row)"
                        />
                        <am-icon-button
                          icon="pi pi-trash"
                          severity="danger"
                          [label]="'workflow.stageTasks.deleteNamed' | translate: { title: titleOf(row) }"
                          [disabled]="busy()"
                          (activated)="askDelete(row)"
                        />
                      </span>
                    }
                  </li>
                }
              </ol>
            }
          }
        }

        @if (actionError(); as message) {
          <p class="am-stage-tasks__action-error" role="alert">{{ message | translate }}</p>
        }
      }

      <p class="sr-only" aria-live="polite" data-stage-tasks-announcement>{{ announcement() }}</p>
    </section>

    <!-- Add and edit (drawing section 2): two steps, the step named in the
         footer's left and the actions on its right. Declared HERE, not inside
         the form: p-dialog collects its pTemplate children at content init, so
         a footer arriving later never lands. -->
    <ng-template #formBody>
      <app-stage-task-definition-form
        [definition]="editing()"
        [stage]="stage()"
        [template]="template()"
        (saved)="onSaved($event)"
        (ready)="formRef.set($event)"
        (dirtyChange)="formDirty.set($event)"
      />
    </ng-template>
    <ng-template #formFooter>
      @if (formRef(); as f) {
        <div class="am-std-footer">
          @if (f.saveError(); as error) {
            <span class="am-std-footer__error" role="alert" data-std-save-error>{{ error | translate }}</span>
          } @else if (f.savedWarning(); as warning) {
            <span class="am-std-footer__warning" role="status" data-std-warning>
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ warning }}
            </span>
          } @else {
            <span class="am-std-footer__step">{{ f.stepLabel() }}</span>
          }
          <span class="am-std-footer__actions">
            @if (f.canGoBack()) {
              <p-button [label]="'common.back' | translate" [text]="true" [disabled]="f.saving()" (onClick)="f.back()" />
            } @else {
              <p-button
                [label]="'common.cancel' | translate"
                [text]="true"
                [disabled]="f.saving()"
                (onClick)="definitionDialog.requestClose()"
              />
            }
            @if (f.canAdvance()) {
              <p-button [label]="'workflow.stageTaskForm.next' | translate" (onClick)="f.next()" data-std-next />
            } @else {
              <p-button
                [label]="'workflow.stageTaskForm.save' | translate"
                [loading]="f.saving()"
                (onClick)="f.onSubmit()"
                data-std-save
              />
            }
          </span>
        </div>
      }
    </ng-template>
    <app-edit-dialog
      #definitionDialog
      [visible]="formOpen()"
      (visibleChange)="onFormVisibleChange($event)"
      [header]="(editing() ? 'workflow.stageTaskForm.editTitle' : 'workflow.stageTaskForm.addTitle') | translate"
      [context]="formRef()?.context() ?? ''"
      [content]="formBody"
      [footer]="formFooter"
      density="compact"
      [dirty]="formDirty()"
      [saving]="!!formRef()?.saving()"
    />

    <!-- Delete (drawing section 2): a 420 confirm, naming what stays. -->
    <ng-template #deleteBody>
      @if (deleting(); as row) {
        <p class="am-confirm__sentence">
          {{ 'workflow.stageTasks.delete.body' | translate: { title: titleOf(row) } }}
        </p>
        <dl class="am-confirm__pairs">
          <div>
            <dt>{{ 'workflow.stageTasks.delete.created' | translate }}</dt>
            <dd data-delete-created>{{ createdLine(row) }}</dd>
          </div>
          <div>
            <dt>{{ 'workflow.stageTasks.delete.longestAfter' | translate }}</dt>
            <dd data-delete-longest>{{ longestAfterDelete(row) }}</dd>
          </div>
        </dl>
      }
    </ng-template>
    <ng-template #deleteFooter>
      <div class="flex justify-end gap-2">
        <p-button
          [label]="'workflow.stageTasks.delete.keep' | translate"
          [text]="true"
          [disabled]="removing()"
          (onClick)="deleting.set(null)"
        />
        <p-button
          [label]="'common.delete' | translate"
          severity="danger"
          [loading]="removing()"
          (onClick)="confirmDelete()"
          data-delete-confirm
        />
      </div>
    </ng-template>
    <app-edit-dialog
      [visible]="deleting() !== null"
      (visibleChange)="onDeleteVisibleChange($event)"
      [header]="'workflow.stageTasks.delete.title' | translate"
      [context]="deleteContext()"
      role="alertdialog"
      size="confirm"
      [saving]="removing()"
      [content]="deleteBody"
      [footer]="deleteFooter"
    />
  `,
  styles: [
    `
      .am-stage-tasks {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
      }
      .am-stage-tasks__head {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--am-space-8);
      }
      .am-stage-tasks__title {
        margin: 0;
        font-size: var(--am-type-value-size);
        font-weight: 600;
      }
      .am-stage-tasks__summary,
      .am-stage-tasks__note {
        margin: 0;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-700);
      }
      /* Worded, not only red (drawing): the ⚠ and "would be late" carry it. */
      .am-stage-tasks__summary--late {
        font-weight: 600;
        color: var(--am-danger-ink);
        background: var(--am-danger-bg);
        border: 1px solid var(--am-danger-border);
        border-radius: var(--am-radius-control);
        padding: var(--am-space-2) var(--am-space-8);
      }
      .am-stage-tasks__skeleton {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
        padding-block: var(--am-space-8);
      }
      .am-stage-tasks__error,
      .am-stage-tasks__action-error {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        margin: 0;
        font-size: var(--am-type-meta-size);
        color: var(--am-danger-ink);
      }
      .am-stage-tasks__empty {
        border: 1px dashed var(--am-border-strong);
        border-radius: var(--am-radius-button);
        padding: var(--am-space-16) var(--am-space-12);
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--am-space-8);
      }
      .am-stage-tasks__empty p {
        margin: 0;
        font-weight: 600;
        font-size: var(--am-type-value-size);
      }
      .am-stage-tasks__list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .am-stage-task {
        display: flex;
        align-items: flex-start;
        gap: var(--am-space-8);
        padding-block: var(--am-space-8);
        border-block-end: 1px solid var(--am-border);
      }
      .am-stage-task__n {
        flex: none;
        inline-size: var(--am-space-16);
        font-size: var(--am-type-meta-size);
        font-weight: 600;
        color: var(--am-ink-500);
        padding-block-start: var(--am-space-2);
      }
      .am-stage-task__body {
        flex: 1 1 auto;
        min-inline-size: 0;
        display: flex;
        flex-direction: column;
      }
      .am-stage-task__title {
        font-weight: 600;
        font-size: var(--am-type-value-size);
      }
      .am-stage-task__title-ar {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
        text-align: start;
        unicode-bidi: isolate;
      }
      .am-stage-task__chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--am-space-4) var(--am-space-6);
        margin-block: var(--am-space-4);
      }
      .am-stage-task__line {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-900);
      }
      .am-stage-task__line--quiet {
        color: var(--am-ink-700);
      }
      .am-stage-task__actions {
        flex: none;
        display: flex;
        gap: var(--am-space-4);
      }
      /* Mandatory filled, Optional dashed: glyph, border and word all differ,
         so the pair survives greyscale (drawing decision 3). */
      .am-chip {
        display: inline-flex;
        align-items: center;
        gap: var(--am-space-2);
        font-size: var(--am-type-micro-size);
        font-weight: 600;
        border-radius: var(--am-radius-control);
        padding: 0 var(--am-space-6);
        white-space: nowrap;
      }
      .am-chip--must {
        color: var(--am-primary-700);
        background: var(--am-primary-100);
        border: 1px solid var(--am-primary-600);
      }
      .am-chip--optional {
        color: var(--am-ink-700);
        background: var(--am-surface-raised);
        border: 1px dashed var(--am-ink-300);
      }
      .am-chip--neutral {
        color: var(--am-neutral-chip-ink);
        background: var(--am-neutral-chip-bg);
        border: 1px solid var(--am-neutral-chip-border);
      }
      .am-chip--warn {
        color: var(--am-warning-ink);
        background: var(--am-warning-bg);
        border: 1px solid var(--am-warning-border);
      }
      .am-std-footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--am-space-8);
        inline-size: 100%;
      }
      .am-std-footer__step {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
      }
      .am-std-footer__error {
        font-size: var(--am-type-meta-size);
        font-weight: 500;
        color: var(--am-danger-ink);
      }
      .am-std-footer__warning {
        flex: 1 1 16rem;
        font-size: var(--am-type-meta-size);
        font-weight: 500;
        color: var(--am-warning-ink);
      }
      .am-std-footer__actions {
        display: flex;
        gap: var(--am-space-8);
      }
      .am-confirm__sentence {
        margin: 0;
      }
      .am-confirm__pairs {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--am-space-12);
        margin: var(--am-space-12) 0 0;
      }
      .am-confirm__pairs dt {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
        font-weight: 500;
      }
      .am-confirm__pairs dd {
        margin: var(--am-space-2) 0 0;
        font-weight: 500;
      }
    `,
  ],
})
export class StageTaskListComponent implements OnInit {
  private readonly templates = inject(WorkflowTemplateService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly stage = input.required<WorkflowStageDto>();
  readonly template = input.required<WorkflowTemplateDto>();
  /** workflows:manage — Add, Edit, Delete and reorder. */
  readonly canManage = input(false);

  readonly summaryChanged = output<StageTaskSummary>();

  readonly rows = signal<StageTaskDefinitionListItemDto[]>([]);
  readonly state = signal<LoadState>('loading');
  readonly reordering = signal(false);
  readonly removing = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly announcement = signal('');

  /** The definition being added (null) or edited, while its dialog is open. */
  readonly editing = signal<StageTaskDefinitionDto | null>(null);
  readonly formOpen = signal(false);
  readonly formRef = signal<StageTaskDefinitionFormComponent | null>(null);
  readonly formDirty = signal(false);
  /**
   * ACC-55 — a save that returned a warning keeps the dialog open on it, and
   * the list is refreshed when the dialog closes rather than under it.
   */
  private refreshPending = false;
  readonly deleting = signal<StageTaskDefinitionListItemDto | null>(null);

  readonly busy = computed(() => this.reordering() || this.removing());
  readonly canAdd = computed(() => this.canManage() && !this.stage().isFinal && this.state() === 'ready');

  readonly longest = computed(() => {
    const rows = this.rows();
    return rows.length ? Math.max(...rows.map((r) => r.dueAfterHours)) : null;
  });

  /** Tasks whose due time passes the stage deadline; normally none, as the server refuses it. */
  readonly lateCount = computed(() => {
    const deadline = this.stage().slaWorkingHours;
    return deadline === null ? 0 : this.rows().filter((r) => r.dueAfterHours > deadline).length;
  });

  /** "Stage deadline: 40 working hours · longest task: 16", or one of its variants. */
  readonly summary = computed(() => {
    const deadline = this.stage().slaWorkingHours;
    const longest = this.longest();
    const hours = (n: number) => this.format.count('workflow.workingHours', n);
    if (deadline === null) {
      return longest === null
        ? this.translate.instant('workflow.stageTasks.header.noDeadlineEmpty')
        : this.translate.instant('workflow.stageTasks.header.noDeadline', { longest });
    }
    if (longest === null) {
      return this.translate.instant('workflow.stageTasks.header.deadlineEmpty', { deadline: hours(deadline) });
    }
    const late = this.lateCount();
    return late > 0
      ? this.translate.instant('workflow.stageTasks.header.late', {
          deadline: hours(deadline),
          longest,
          late: this.format.count('workflow.tasksLate', late),
        })
      : this.translate.instant('workflow.stageTasks.header.deadline', { deadline: hours(deadline), longest });
  });

  readonly deleteContext = computed(() => {
    const row = this.deleting();
    if (!row) return '';
    const rows = this.rows();
    return this.translate.instant('workflow.stageTasks.delete.context', {
      template: this.language.bilingual(this.template().nameEn, this.template().nameAr),
      stage: this.language.bilingual(this.stage().nameEn, this.stage().nameAr),
      position: rows.findIndex((r) => r.id === row.id) + 1,
      of: rows.length,
    });
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.state.set('loading');
    this.templates.listStageTaskDefinitions(this.stage().id).subscribe({
      next: (rows) => this.settle(rows),
      error: () => this.state.set('error'),
    });
  }

  // ── Row text ───────────────────────────────────────────────────────────────

  /** The title as the reader's language shows it: Arabic leads in Arabic, English is the fallback. */
  titleOf(row: StageTaskDefinitionListItemDto): string {
    return this.language.bilingual(row.titleEn, row.titleAr);
  }

  /** In English the Arabic title sits under the English one; in Arabic it IS the title. */
  arabicSubtitle(row: StageTaskDefinitionListItemDto): string | null {
    return !this.language.isArabic() && row.titleAr ? row.titleAr : null;
  }

  priorityLine(row: StageTaskDefinitionListItemDto): string {
    return this.translate.instant('workflow.stageTasks.priorityDue', {
      priority: this.translate.instant(PRIORITY_KEYS[row.priority]),
      due: this.format.count('workflow.workingHours', row.dueAfterHours),
    });
  }

  routeOf(row: StageTaskDefinitionListItemDto): string {
    return stageTaskRouteLabel(
      row,
      (key, params) => this.translate.instant(key, params),
      (en, ar) => this.language.bilingual(en, ar),
    );
  }

  /** Relative routes never warn (D3): who holds them is known only when a record enters. */
  warningKey(row: StageTaskDefinitionListItemDto): string | null {
    if (row.warning === 'POSITION_HAS_NO_HOLDER') return 'workflow.stageTasks.warnNoHolder';
    if (row.warning === 'POOL_EMPTY') return 'workflow.stageTasks.warnPoolEmpty';
    return null;
  }

  createdLine(row: StageTaskDefinitionListItemDto): string {
    return this.format.count('workflow.createdStay', row.createdTaskCount);
  }

  longestAfterDelete(row: StageTaskDefinitionListItemDto): string {
    const rest = this.rows().filter((r) => r.id !== row.id);
    return rest.length
      ? this.format.count('workflow.workingHours', Math.max(...rest.map((r) => r.dueAfterHours)))
      : this.translate.instant('workflow.stageTasks.delete.noneLeft');
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  openAdd(): void {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  openEdit(row: StageTaskDefinitionListItemDto): void {
    this.actionError.set(null);
    this.editing.set(row);
    this.formOpen.set(true);
  }

  /** A warning keeps the dialog open, now editing what was saved; otherwise it closes. */
  onSaved(result: StageTaskDefinitionSavedDto): void {
    if (result.warning) {
      this.editing.set(result.definition);
      this.refreshPending = true;
      return;
    }
    this.formOpen.set(false);
    this.formRef.set(null);
    this.refreshAfterSave();
  }

  onFormVisibleChange(visible: boolean): void {
    if (visible) return;
    this.formOpen.set(false);
    this.formRef.set(null);
    this.formDirty.set(false);
    if (this.refreshPending) {
      this.refreshPending = false;
      this.refreshAfterSave();
    }
  }

  askDelete(row: StageTaskDefinitionListItemDto): void {
    this.actionError.set(null);
    this.deleting.set(row);
  }

  onDeleteVisibleChange(visible: boolean): void {
    if (!visible) this.deleting.set(null);
  }

  confirmDelete(): void {
    const row = this.deleting();
    if (!row) return;
    this.removing.set(true);
    this.templates.removeStageTaskDefinition(row.id).subscribe({
      next: () => {
        this.removing.set(false);
        this.deleting.set(null);
        this.settle(this.rows().filter((r) => r.id !== row.id));
      },
      error: (err: unknown) => {
        this.removing.set(false);
        this.deleting.set(null);
        this.actionError.set(plainWorkflowRefusalKey(err) ?? 'workflow.stageTasks.delete.failed');
      },
    });
  }

  move(row: StageTaskDefinitionListItemDto, by: -1 | 1): void {
    const rows = this.rows();
    const from = rows.findIndex((r) => r.id === row.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= rows.length) return;
    const ids = rows.map((r) => r.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];

    this.reordering.set(true);
    this.actionError.set(null);
    this.templates.reorderStageTaskDefinitions(this.stage().id, ids).subscribe({
      next: (updated) => {
        this.reordering.set(false);
        this.settle(updated);
        this.announcement.set(
          this.translate.instant('workflow.stageTasks.moved', {
            title: this.titleOf(row),
            position: to + 1,
            of: updated.length,
          }),
        );
        this.refocusAfterMove(row.id, by);
      },
      error: (err: unknown) => {
        this.reordering.set(false);
        this.actionError.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'common.saveFailed'));
        // The list someone else changed is the one to show (STAGE_TASK_ORDER_MISMATCH).
        this.load();
      },
    });
  }

  /** After a save in the dialog: the list is re-read, so it shows exactly what the server holds. */
  refreshAfterSave(): void {
    this.templates.listStageTaskDefinitions(this.stage().id).subscribe({
      next: (rows) => this.settle(rows),
      error: () => this.state.set('error'),
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private settle(rows: StageTaskDefinitionListItemDto[]): void {
    this.rows.set(rows);
    this.state.set('ready');
    this.summaryChanged.emit({
      taskDefinitionCount: rows.length,
      longestTaskHours: rows.length ? Math.max(...rows.map((r) => r.dueAfterHours)) : null,
    });
  }

  /**
   * Focus stays on the arrow the person pressed, now on the row's new place —
   * or on its other arrow, when this one has gone (the row reached an end).
   */
  private refocusAfterMove(id: string, by: -1 | 1): void {
    afterNextRender(
      () => {
        const pressed = by < 0 ? 'up' : 'down';
        const other = by < 0 ? 'down' : 'up';
        const root = this.host.nativeElement;
        const target =
          root.querySelector<HTMLElement>(`[data-move="${id}:${pressed}"] button`) ??
          root.querySelector<HTMLElement>(`[data-move="${id}:${other}"] button`);
        target?.focus();
      },
      { injector: this.injector },
    );
  }
}
