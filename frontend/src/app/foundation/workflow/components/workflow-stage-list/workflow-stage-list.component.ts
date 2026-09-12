import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import {
  WorkflowTemplateService,
  WorkflowTemplateDto,
  WorkflowStageDto,
} from '../../services/workflow-template.service';
import { WorkflowStageFormComponent } from '../workflow-stage-form/workflow-stage-form.component';
import { WorkflowTransitionEditorComponent } from '../workflow-transition-editor/workflow-transition-editor.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import {
  DataListColumn,
  DataListComponent,
} from '../../../../shared/components/data-list/data-list.component';
import {
  DataListSource,
  clientSideSource,
} from '../../../../shared/components/data-list/data-list.source';

@Component({
  selector: 'app-workflow-stage-list',
  standalone: true,
  imports: [
    TranslatePipe,
    ButtonModule,
    TooltipModule,
    WorkflowStageFormComponent,
    DataListComponent,
    WorkflowTransitionEditorComponent,
    EditDialogComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">

      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ template()?.nameEn }}</h2>
        <p-button
          icon="pi pi-plus"
          [label]="'workflow.addStage' | translate"
          [disabled]="reordering()"
          (onClick)="openAdd()"
        />
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() | translate }}</p>
      }

      <!-- ACC-78 - page mode, and the hardest of the three proving tables:
           client-side data with no endpoint, expandable rows containing a
           further editor, and a MANUALLY ORDERED set.

           NO COLUMN IS SORTABLE, deliberately and permanently. This list's
           order IS its data, and every row carries reorder buttons; offering
           to re-sort by name would leave those buttons pointing at positions
           the reader can no longer see. Headers still render - a header is a
           label, and labelling a column does not imply it sorts.

           NO PAGER either, via [showPager]="false". The set is complete and
           client-side, so there is never a second page.

           TYPE SCALE MATCHES THE NESTED EDITOR (text-sm). The first attempt
           used 13px/11.5px rows above a PrimeNG p-table at 14px with its own
           cell padding, so an expanded stage showed two different table
           idioms stacked on each other. -->
      <div class="rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] overflow-hidden">
        <app-data-list
          variant="page"
          [source]="source"
          [trackBy]="trackById"
          [columns]="columns()"
          [showPager]="false"
          [searchPlaceholder]="'workflow.searchStages' | translate"
          [emptyTitle]="'workflow.noStages' | translate"
        >
          <ng-template #listHeader let-h>
            @for (column of columns(); track column.key) {
              @if (h.visible(column.key)) {
                <span>{{ column.label }}</span>
              }
            }
            <span></span>
          </ng-template>

          <ng-template #listRow let-stage let-v="visible">
            <div class="border-b border-[var(--am-border)]">
              <div
                class="grid items-center gap-3 px-3 py-2"
                style="grid-template-columns: var(--am-list-cols)"
              >
                @if (v('expand')) {
                  <p-button
                    [icon]="isExpanded(stage.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                    [text]="true"
                    size="small"
                    (onClick)="toggleExpanded(stage.id)"
                  />
                }
                @if (v('name')) {
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-sm font-medium truncate">{{ stage.nameEn }}</span>
                      @if (stage.isInitial) {
                        <span
                          class="text-[10.5px] font-semibold px-1.5 py-px rounded shrink-0"
                          style="color: var(--am-status-approved);
                                 background: color-mix(in srgb, var(--am-status-approved) 12%, transparent)"
                        >
                          {{ 'workflow.isInitial' | translate }}
                        </span>
                      }
                      @if (stage.isFinal) {
                        <span
                          class="text-[10.5px] font-semibold px-1.5 py-px rounded shrink-0 text-[var(--am-text-secondary)]"
                          style="background: var(--am-surface)"
                        >
                          {{ 'workflow.isFinal' | translate }}
                        </span>
                      }
                    </div>
                    <!-- See role-list: dir on the span, not the block. -->
                    <div class="text-xs text-[var(--am-text-secondary)] truncate">
                      <span dir="rtl" style="unicode-bidi: isolate">{{ stage.nameAr }}</span>
                    </div>
                  </div>
                }
                @if (v('approval')) {
                  <span class="text-sm text-[var(--am-text-secondary)] truncate">
                    {{ stage.approvalMode }}
                  </span>
                }
                @if (v('assignee')) {
                  <span class="text-sm text-[var(--am-text-secondary)] truncate">
                    {{ stage.assigneeStrategy }}
                  </span>
                }
                @if (v('sla')) {
                  <span
                    dir="ltr"
                    style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
                    class="text-sm text-[var(--am-text-secondary)] text-start"
                  >
                    {{ stage.slaWorkingHours ? stage.slaWorkingHours + 'h' : '—' }}
                  </span>
                }

                <div class="flex items-center gap-1 shrink-0">
                  <p-button
                    icon="pi pi-arrow-up"
                    [text]="true"
                    size="small"
                    [disabled]="reordering() || stageIndex(stage) === 0"
                    [pTooltip]="'workflow.moveUp' | translate"
                    (onClick)="onMoveUp(stageIndex(stage))"
                  />
                  <p-button
                    icon="pi pi-arrow-down"
                    [text]="true"
                    size="small"
                    [disabled]="reordering() || stageIndex(stage) === stages().length - 1"
                    [pTooltip]="'workflow.moveDown' | translate"
                    (onClick)="onMoveDown(stageIndex(stage))"
                  />
                  <p-button
                    [label]="'common.edit' | translate"
                    size="small"
                    [text]="true"
                    [disabled]="reordering()"
                    (onClick)="openEdit(stage)"
                  />
                  <p-button
                    icon="pi pi-trash"
                    [text]="true"
                    size="small"
                    severity="danger"
                    [disabled]="reordering()"
                    [pTooltip]="'common.remove' | translate"
                    (onClick)="onRemove(stage)"
                  />
                </div>
              </div>

              <!-- The expansion lives INSIDE the projected row rather than in a
                   separate expandedrow template. p-table needed dataKey,
                   pRowToggler and expandedRowKeys to coordinate two templates;
                   here the row owns its own disclosure, and the nested editor
                   is simply a child of it. -->
              @if (isExpanded(stage.id)) {
                <div class="px-3 pb-3 bg-[var(--am-surface)]">
                  <app-workflow-transition-editor
                    [stageId]="stage.id"
                    [transitions]="stage.transitions ?? []"
                    [availableStages]="stages()"
                    (changed)="loadTemplate()"
                  />
                </div>
              }
            </div>
          </ng-template>
        </app-data-list>
      </div>

      <ng-template #formTpl>
        <app-workflow-stage-form
          [stage]="editingStage()"
          [templateId]="templateId()"
          [nextOrder]="nextOrderForNewStage()"
          (saved)="onStageSaved($event)"
          (cancelled)="showFormDialog.set(false)"
        />
      </ng-template>
      <app-edit-dialog
        [visible]="showFormDialog()"
        (visibleChange)="showFormDialog.set($event)"
        [header]="(editingStage() ? 'workflow.editStage' : 'workflow.addStage') | translate"
        [content]="formTpl"
        width="560px"
      />

    </div>
  `,
})
export class WorkflowStageListComponent implements OnInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);

  readonly loading = signal(false);
  readonly reordering = signal(false);
  readonly template = signal<WorkflowTemplateDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly showFormDialog = signal(false);
  readonly editingStage = signal<WorkflowStageDto | null>(null);
  readonly expandedRowKeys = signal<Record<string, boolean>>({});

  private readonly translate = inject(TranslateService);

  readonly templateId = computed(() => this.template()?.id ?? '');
  readonly stages = computed(() => this.template()?.stages ?? []);

  // ACC-78 — client-side: stages arrive inside the template, so there is no
  // list endpoint to call. Reads the signal through a FUNCTION rather than a
  // snapshot, so a reorder or an edit re-reads it; passing stages() once would
  // capture one array and never update.
  readonly source: DataListSource<WorkflowStageDto> = clientSideSource(() => this.stages(), {
    // Searched even though no toolbar search is offered today: the option
    // costs nothing and the alternative is a search box that silently matches
    // nothing if one is ever turned on.
    searchFields: (stage) => [stage.nameEn, stage.nameAr],
    // No comparators. The order IS the data; see the template comment.
    comparators: {},
  });

  readonly trackById = (stage: WorkflowStageDto): string => stage.id;

  // NO sortBy on any column, permanently — see the template comment. A header
  // is a label; labelling a column does not imply it sorts.
  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    return [
      { key: 'expand', label: '', alwaysVisible: true, width: 'auto' },
      {
        key: 'name',
        label: this.translate.instant('workflow.stageName'),
        alwaysVisible: true,
        width: '2fr',
      },
      { key: 'approval', label: this.translate.instant('workflow.approvalMode'), width: '1fr' },
      {
        key: 'assignee',
        label: this.translate.instant('workflow.assigneeStrategy'),
        width: '1fr',
      },
      { key: 'sla', label: this.translate.instant('workflow.sla'), width: '0.6fr' },
    ];
  });

  // The row's position in the UNDERLYING array, not the rendered page. The
  // reorder buttons move a stage relative to its real neighbours, so a
  // rendered index would move the wrong stage the moment the two diverge.
  stageIndex(stage: WorkflowStageDto): number {
    return this.stages().findIndex((s) => s.id === stage.id);
  }

  isExpanded(stageId: string): boolean {
    return !!this.expandedRowKeys()[stageId];
  }

  toggleExpanded(stageId: string): void {
    this.expandedRowKeys.update((keys) => ({ ...keys, [stageId]: !keys[stageId] }));
  }

  // Admins never type order numbers — a new stage is appended after the
  // current highest order, in the same +10 stride the system seed data uses.
  readonly nextOrderForNewStage = computed(() => {
    const stages = this.stages();
    if (stages.length === 0) return 10;
    return Math.max(...stages.map((s) => s.order)) + 10;
  });

  ngOnInit(): void {
    this.loadTemplate();
  }

  openAdd(): void {
    this.editingStage.set(null);
    this.showFormDialog.set(true);
  }

  openEdit(stage: WorkflowStageDto): void {
    this.editingStage.set(stage);
    this.showFormDialog.set(true);
  }

  // ACC-54 — mirrors PositionListComponent.onSaved() exactly (ACC-43): when
  // the config-time warning fires, the dialog STAYS OPEN so the warning is
  // actually readable. Closing on save as usual rendered it for a fraction of
  // a second before the dialog disappeared, which is no warning at all.
  //
  // Switching editingStage to the saved record matters for the same reason it
  // did in position-form, and it was checked rather than assumed to carry
  // over: workflow-stage-form picks its endpoint with `this.stage ?
  // updateStage(...) : addStage(...)`, and `stage` is an @Input bound to
  // editingStage() here. Leaving it null while the dialog stays open would
  // make a second Save create a duplicate stage instead of updating the one
  // just created.
  //
  // Unlike position-form this cannot clobber what the user is looking at:
  // that component re-patches its form from an effect() on its position
  // input, whereas this one patches only in ngOnInit(), so updating the input
  // on an already-open dialog leaves the visible form untouched.
  onStageSaved(result: { stage: WorkflowStageDto; hadNoHolderWarning: boolean }): void {
    if (result.hadNoHolderWarning) {
      this.editingStage.set(result.stage);
    } else {
      this.showFormDialog.set(false);
    }
    this.loadTemplate();
  }

  onRemove(stage: WorkflowStageDto): void {
    this.confirmationService.confirm({
      message: `Remove stage "${stage.nameEn}"?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.workflowTemplateService.removeStage(stage.id).subscribe({
          next: () => this.loadTemplate(),
          error: (err: unknown) =>
            this.error.set(extractErrorMessage(err, 'Remove failed')),
        });
      },
    });
  }

  onMoveUp(index: number): void {
    if (index === 0) return;
    const stages = this.stages();
    const current = stages[index];
    const above = stages[index - 1];
    if (!current || !above) return;
    this.swapOrder(current, above);
  }

  onMoveDown(index: number): void {
    const stages = this.stages();
    if (index === stages.length - 1) return;
    const current = stages[index];
    const below = stages[index + 1];
    if (!current || !below) return;
    this.swapOrder(current, below);
  }

  private swapOrder(a: WorkflowStageDto, b: WorkflowStageDto): void {
    this.reordering.set(true);
    this.error.set(null);

    this.workflowTemplateService.updateStage(a.id, { order: b.order }).subscribe({
      next: () => {
        this.workflowTemplateService.updateStage(b.id, { order: a.order }).subscribe({
          next: () => this.loadTemplate(),
          error: (err: unknown) => {
            this.error.set(extractErrorMessage(err, 'Reorder failed'));
            this.loadTemplate(); // reload to restore true server state
          },
        });
      },
      error: (err: unknown) => {
        this.error.set(extractErrorMessage(err, 'Reorder failed'));
        this.loadTemplate(); // reload to restore true server state
      },
    });
  }

  loadTemplate(): void {
    const id = this.route.snapshot.paramMap.get('templateId');
    if (!id) return;

    this.loading.set(true);
    this.workflowTemplateService.getTemplate(id).subscribe({
      next: (template) => {
        this.template.set(template);
        this.loading.set(false);
        this.reordering.set(false);
      },
      error: () => {
        this.error.set('workflow.errorLoad');
        this.loading.set(false);
        this.reordering.set(false);
      },
    });
  }
}
