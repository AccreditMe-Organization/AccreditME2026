import { Component, OnInit, TemplateRef, ViewChild, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { TaskService, ITaskWithAssigneesDto, ResolvedDelegationDto } from '../../services/task.service';
import { LanguageService } from '../../../../core/services/language.service';
import { TaskFormComponent } from '../task-form/task-form.component';
// ACC-39 — EditDialogComponent replaces this raw p-dialog + manual @if.
// task-form is create-only (no edit flow), so this is architectural
// consistency with the required pattern going forward (SYSTEM-REFERENCE.md
// Section 10.5), not a bug fix — the old @if(formVisible()) wrapping
// <app-task-form> directly was already immune to ACC-29's pre-fill bug.
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';

// Embeddable list filtered by sourceType + sourceId — meant to be dropped
// into a future module's detail page (e.g. an Incident detail page showing
// its tasks). No functional module exists yet to embed it in, so it ships
// as its own standalone routed page for now, same "temporary standalone,
// built reusable" pattern Step 7 used for the notification bell. The create
// dialog uses the shared EditDialogComponent pattern (ACC-39), matching
// every other list screen's add/edit dialog.
@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [DatePipe, TranslatePipe, TableModule, TagModule, ButtonModule, TaskFormComponent, EditDialogComponent],
  template: `
    <div [class]="embedded() ? 'flex flex-col gap-4' : 'flex flex-col h-full gap-4'">
      <!-- ACC-76 — embedded mode drops the page chrome. A panel supplies its
           own heading (RecordPanelComponent) and its own height; keeping the
           h2 and scrollHeight="flex" here produced a heading inside a heading
           and a table that tried to fill a viewport it no longer owned. The
           component's own comment always claimed it was embeddable; it was
           not, until this. -->
      @if (!embedded()) {
        <div class="flex items-center justify-between">
          <h2 class="text-xl font-semibold">{{ 'task.allTasks' | translate }}</h2>
          <p-button [label]="'task.newTask' | translate" icon="pi pi-plus" (onClick)="onAdd()" />
        </div>
      }

      @if (error() && !embedded()) {
        <p class="text-red-500">{{ error() | translate }}</p>
      }

      <!-- p-table draws its own spinner and its own empty row, so an embedding
           panel must NOT also render loading/empty states over this — see
           committee-detail, which passes neither. Keeping both inside the
           table also means the panel's ng-content is never conditionally
           unrendered, which would otherwise make a template reference to this
           component unreliable. -->
      <p-table
        [value]="tasks()"
        [loading]="loading()"
        [scrollable]="!embedded()"
        [scrollHeight]="embedded() ? '' : 'flex'"
        styleClass="w-full"
      >
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 34%">{{ 'task.title' | translate }}</th>
            <th style="width: 26%">{{ 'task.assignees' | translate }}</th>
            <th style="width: 13%">{{ 'task.priority.title' | translate }}</th>
            <th style="width: 14%">{{ 'task.dueDate' | translate }}</th>
            <th style="width: 13%">{{ 'task.status.title' | translate }}</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-task>
          <tr>
            <td>{{ task.title }}</td>
            <td>
              <!-- ACC-58, absorbed here: the first surface in the product that
                   answers "who is this assigned to". -->
              @if (task.assignees.length === 0) {
                <span class="text-[var(--am-text-secondary)]">{{ 'task.unassigned' | translate }}</span>
              } @else {
                <div class="flex flex-col">
                  @for (assignee of task.assignees; track assignee.userId) {
                    <span>
                      {{ assignee.userName }}
                      <!-- ACC-40 §2.6.3's qualifier, reaching a screen for the
                           first time. Without it the row implies Sarah holds
                           the position outright, when she is covering. -->
                      @if (delegationQualifier(assignee.delegation); as qualifier) {
                        <span class="text-xs text-[var(--am-text-secondary)]">{{ qualifier }}</span>
                      }
                    </span>
                  }
                </div>
              }
            </td>
            <td>{{ ('task.priority.' + task.priority.toLowerCase()) | translate }}</td>
            <td>{{ task.dueAt ? (task.dueAt | date: 'short') : '—' }}</td>
            <td>
              <p-tag [value]="('task.status.' + task.status.toLowerCase()) | translate" />
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5" class="text-center py-8 text-[var(--am-text-secondary)]">{{ 'task.noTasks' | translate }}</td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <ng-template #formTpl>
      <!-- Prefilled and locked when embedded: the task belongs to the record
           whose page this is, so the source is not a question to ask. -->
      <app-task-form
        [lockedSourceType]="embedded() ? sourceType() : null"
        [lockedSourceId]="embedded() ? sourceId() : null"
        [lockedSourceLabel]="embedded() ? sourceLabel() : null"
        (saved)="onSaved()"
        (cancelled)="formVisible.set(false)"
      />
    </ng-template>
    <app-edit-dialog
      [(visible)]="formVisible"
      [header]="'task.newTask' | translate"
      [content]="formTpl"
    />
  `,
})
export class TaskListComponent implements OnInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly taskService = inject(TaskService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);

  readonly sourceType = input<string | null>(null);
  readonly sourceId = input<string | null>(null);

  // ACC-76 — the record's own display name, used to prefill and lock the
  // create form's source. Never the id: a cuid tells the reader nothing.
  readonly sourceLabel = input<string | null>(null);

  // ACC-76 — renders inside a RecordPanel rather than as its own page: no
  // heading, no viewport-filling scroll, and the create dialog's source is
  // locked to this record. The parent panel owns heading, loading and error
  // display, so those are suppressed here rather than drawn twice.
  readonly embedded = input(false);

  readonly loading = signal(false);
  readonly tasks = signal<ITaskWithAssigneesDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly formVisible = signal(false);

  // Exposed so an embedding panel can show the states this component
  // suppresses in embedded mode (see `embedded` above).
  readonly isLoading = this.loading.asReadonly();
  readonly loadError = this.error.asReadonly();
  readonly taskCount = computed(() => this.tasks().length);

  // ACC-40 §2.6.3 — " — Acting Head of Cardiology" / " — covering for Ahmad".
  // Empty string when unstamped or when the referent no longer resolves: a
  // raw id beside a name would be worse than no qualifier at all.
  delegationQualifier(delegation: ResolvedDelegationDto | null): string {
    if (!delegation) return '';
    const label = this.languageService.isArabic()
      ? delegation.contextLabelAr
      : delegation.contextLabelEn;
    if (!label) return '';

    const key =
      delegation.reason === 'ACTING_HEAD' ? 'task.actingHeadOf' : 'task.coveringFor';
    return ` — ${this.translate.instant(key, { context: label })}`;
  }

  ngOnInit(): void {
    this.loadTasks();
  }

  onAdd(): void {
    this.formVisible.set(true);
  }

  onSaved(): void {
    this.formVisible.set(false);
    this.loadTasks();
  }

  loadTasks(): void {
    const type = this.sourceType();
    const id = this.sourceId();
    if (!type || !id) return;

    this.loading.set(true);
    this.taskService.getForSource(type, id).subscribe({
      next: (tasks) => {
        this.tasks.set(tasks);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('task.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
