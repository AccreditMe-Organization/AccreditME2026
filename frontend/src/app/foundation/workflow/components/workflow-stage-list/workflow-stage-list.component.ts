import { Component, DestroyRef, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AmNumberPipe, AmCountPipe, FormatService } from '../../../../core/formatting';
import { SHELL_PHONE_BELOW_PX } from '../../../../layout/app-shell/app-shell.component';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import {
  WorkflowTemplateService,
  WorkflowTemplateDto,
  WorkflowStageDto,
  WorkflowRecordActionDto,
  WorkflowStageFlagDto,
} from '../../services/workflow-template.service';
import { WorkflowStageFormComponent } from '../workflow-stage-form/workflow-stage-form.component';
import { WorkflowTransitionEditorComponent } from '../workflow-transition-editor/workflow-transition-editor.component';
import { StageTaskListComponent, StageTaskSummary } from '../stage-task-list/stage-task-list.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { plainWorkflowRefusalKey } from '../../workflow-refusal';
import { LanguageService } from '../../../../core/services/language.service';
import {
  DataListColumn,
  DataListComponent,
} from '../../../../shared/components/data-list/data-list.component';
import {
  DataListSource,
  clientSideSource,
} from '../../../../shared/components/data-list/data-list.source';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { injectFixLinkParam } from '../../../../shared/utils/fix-link.util';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { RowMenuComponent, RowMenuItem } from '../../../../shared/components/row-menu/row-menu.component';

/**
 * ACC-254 — the stages list's two fixed tracks. The actions cell holds the
 * labelled Edit and the ⋯ (am-row-menu), which measure 84.3px in Arabic and
 * 77.3px in English at every width (workflow-stage-list.layout.spec.ts, at
 * 1280, 1440 and 1920); 96px leaves room for a slightly longer translation.
 * Before the ⋯ the cell held up, down, Edit and remove, about 150-160px, and
 * spilled out of data-list's 88px default. The expand track is the chevron's.
 */
const ACTIONS_TRACK = '96px';
/** ACC-255 PR 4a — the drawing's # column. */
const NUMBER_TRACK = '32px';

@Component({
  selector: 'app-workflow-stage-list',
  standalone: true,
  imports: [PageHeaderComponent, 
    TranslatePipe,
    AmCountPipe,
    AmNumberPipe,
    NgTemplateOutlet,
    ButtonModule,
    TooltipModule,
    WorkflowStageFormComponent,
    DataListComponent,
    WorkflowTransitionEditorComponent,
    StageTaskListComponent,
    EditDialogComponent, RowMenuComponent],
  template: `
    <div class="flex flex-col h-full gap-4">

      <app-page-header
        [title]="templateName()"
        [eyebrow]="'workflow.stagesEyebrow' | translate"
      >
        <div pageActions>
          @if (canCreate()) {
            <!-- [disabled] here is a TRANSIENT state (a reorder is in flight),
                 which is what disabled is for. Permission is not transient, so
                 it hides instead — ACC-118. The two coexist deliberately. -->
            <p-button
              icon="pi pi-plus"
              [label]="'workflow.addStage' | translate"
              [disabled]="reordering()"
              (onClick)="openAdd()"
            />
          }
        </div>
      </app-page-header>

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
      <div class="rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] overflow-hidden flex flex-col min-h-0">
        <app-data-list
          variant="page"
          [source]="source"
          [trackBy]="trackById"
          [columns]="columns()"
          [gridSuffix]="actionsTrack"
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
                <!-- ACC-255 PR 4a — the drawing's stages list (Workflow Setup,
                     section 3): # · Stage, with its meanings as chips under the
                     name · what it allows · the details it expands to. Every
                     value is the server's: the stage's stored actions and flags,
                     named from the template's registries. On a phone it is one
                     column: number and name, chips, allows, details. -->
                @if (!phone() && v('number')) {
                  <span class="text-xs tabular-nums text-[var(--am-text-secondary)]" data-cell="number">
                    {{ stageIndex(stage) + 1 | amNumber }}
                  </span>
                }
                @if (v('name')) {
                  <div class="min-w-0" data-cell="stage">
                    <span
                      class="block text-sm font-medium truncate"
                      [pTooltip]="stageDisplayName(stage)"
                      tooltipPosition="top"
                    >
                      @if (phone()) {
                        <span class="tabular-nums text-[var(--am-text-secondary)] me-2" data-stage-number>{{ stageIndex(stage) + 1 | amNumber }}</span>
                      }
                      <span data-stage-name>{{ stageDisplayName(stage) }}</span>
                    </span>
                    @if (meaningsOf(stage).length) {
                      <span class="flex flex-wrap gap-1 mt-1" data-cell="meanings">
                        @for (meaning of meaningsOf(stage); track meaning.key) {
                          <span class="am-stage-meaning">{{ meaning.labelKey | translate }}</span>
                        }
                      </span>
                    }
                    @if (phone()) {
                      <ng-container *ngTemplateOutlet="allowsTpl; context: { $implicit: stage }" />
                      <ng-container *ngTemplateOutlet="detailsTpl; context: { $implicit: stage }" />
                    }
                  </div>
                }
                @if (!phone() && v('allows')) {
                  <ng-container *ngTemplateOutlet="allowsTpl; context: { $implicit: stage }" />
                }
                @if (!phone() && v('details')) {
                  <ng-container *ngTemplateOutlet="detailsTpl; context: { $implicit: stage }" />
                }

                <!-- ACC-123 — reorder, edit and remove are all
                     workflows:manage. Gated as one block: they share a
                     permission, and four separate @ifs would be four places to
                     get it wrong. Note the Edit button carries a label rather
                     than an icon, so check:action-gating cannot see it — a
                     reason to gate the container, not each control. -->
                <!-- ACC-254 — Edit is the row's next step; Move up, Move down and
                     Remove are in a worded ⋯ menu (ACC-229's shape), so the cell
                     fits its fixed track (ACTIONS_TRACK) in both languages and
                     the page never scrolls sideways. -->
                <div class="flex items-center justify-end gap-1 min-w-0" data-testid="stage-actions">
                  @if (canManage()) {
                    <p-button
                      [label]="'common.edit' | translate"
                      size="small"
                      [text]="true"
                      [disabled]="reordering()"
                      [ariaLabel]="'workflow.editStageNamed' | translate: { name: stageDisplayName(stage) }"
                      (onClick)="openEdit(stage)"
                      data-testid="stage-edit"
                    />
                    <am-row-menu
                      [groups]="menuFor(stage)"
                      [label]="'workflow.stageActionsFor' | translate: { name: stageDisplayName(stage) }"
                      (picked)="pick(stage, $event)"
                    />
                  }
                </div>
              </div>

              <!-- The expansion lives INSIDE the projected row rather than in a
                   separate expandedrow template. p-table needed dataKey,
                   pRowToggler and expandedRowKeys to coordinate two templates;
                   here the row owns its own disclosure, and the nested editor
                   is simply a child of it. -->
              <!-- ACC-208 put these two side by side (drawing decision 1). ACC-255
                   PR 4a replaces that (Ahmad, Q4): Transitions stack above Tasks on
                   entry until each can be about 660px, so the transition table
                   shows whole names — side by side only at 1920 (plan §17.5). -->
              @if (isExpanded(stage.id)) {
                <div class="am-stage-expanded px-3 pb-3 bg-[var(--am-surface)]">
                  <app-workflow-transition-editor
                    [stageId]="stage.id"
                    [transitions]="stage.transitions ?? []"
                    [availableStages]="stages()"
                    (changed)="loadTemplate()"
                  />
                  @if (template(); as t) {
                    <app-stage-task-list
                      [stage]="stage"
                      [template]="t"
                      [canManage]="canManage()"
                      (summaryChanged)="onStageTasksChanged(stage.id, $event)"
                    />
                  }
                </div>
              }
            </div>
          </ng-template>
        </app-data-list>
      </div>

      <!-- What the stage allows: "Allows n of 5 actions" (the action names as
           its tooltip and in its accessible name), "Allows nothing", or nothing
           at all for a record type with no actions a stage can limit. -->
      <ng-template #allowsTpl let-stage>
        @if (registryActions().length) {
          <span
            class="block text-sm truncate min-w-0"
            [class.am-stage-allows-none]="!allowedActions(stage).length"
            [pTooltip]="allowsTip(stage)"
            tooltipPosition="top"
            [attr.aria-label]="allowsTip(stage)"
            data-cell="allows"
          >
            @if (allowedActions(stage).length) {
              {{ registryActions().length | amCount: 'workflow.allowsActions' : { allowed: allowedActions(stage).length } }}
            } @else {
              {{ 'workflow.stageList.allowsNothing' | translate }}
            }
          </span>
        } @else {
          <span data-cell="allows"></span>
        }
      </ng-template>

      <!-- The row's disclosure: what the expansion holds, as its label. -->
      <ng-template #detailsTpl let-stage>
        <button
          type="button"
          class="am-stage-details"
          [attr.aria-expanded]="isExpanded(stage.id)"
          [attr.aria-label]="
            (isExpanded(stage.id) ? 'workflow.hideStageDetails' : 'workflow.showStageDetails')
              | translate: { name: stageDisplayName(stage) }
          "
          (click)="toggleExpanded(stage.id)"
          data-testid="stage-expand"
          data-cell="details"
        >
          <i
            [class]="isExpanded(stage.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right rtl:rotate-180'"
            aria-hidden="true"
          ></i>
          <span class="truncate min-w-0">{{ detailsText(stage) }}</span>
        </button>
      </ng-template>

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
  styles: [
    `
      .am-stage-expanded {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 660px), 1fr));
        gap: var(--am-space-16);
        align-items: start;
      }
      /* ACC-255 PR 4a — a stage's meaning, in words (the drawing's chip). */
      .am-stage-meaning {
        flex: none;
        font-size: var(--am-type-micro-size);
        font-weight: 600;
        line-height: 18px;
        white-space: nowrap;
        color: var(--am-primary-700);
        background: var(--am-card);
        border: 1px solid var(--am-primary-600);
        border-radius: var(--am-radius-control);
        padding: 0 var(--am-space-6);
      }
      .am-stage-allows-none {
        color: var(--am-text-secondary);
      }
      .am-stage-details {
        display: inline-flex;
        align-items: center;
        gap: var(--am-space-6);
        min-width: 0;
        max-width: 100%;
        font-size: var(--am-type-meta-size);
        color: var(--am-text-secondary);
        background: none;
        border: 0;
        padding: 0;
        cursor: pointer;
        text-align: start;
      }
      .am-stage-details:hover {
        color: var(--am-primary-700);
      }
      .am-stage-details:focus-visible {
        outline: 2px solid var(--am-primary-600);
        outline-offset: 2px;
        border-radius: var(--am-radius-control);
      }
    `,
  ],
})
export class WorkflowStageListComponent implements OnInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly route = inject(ActivatedRoute);
  private readonly amConfirm = inject(AmConfirmService);

  readonly loading = signal(false);
  readonly reordering = signal(false);
  readonly template = signal<WorkflowTemplateDto | null>(null);

  private readonly languageService = inject(LanguageService);

  // Tenant data, so chosen by language rather than translated (SYSTEM-REFERENCE
  // §9.3). The header showed nameEn in both languages before ACC-79.
  readonly templateName = computed(() => {
    const template = this.template();
    if (!template) return '';
    return this.languageService.bilingual(template.nameEn, template.nameAr);
  });
  readonly error = signal<string | null>(null);
  readonly showFormDialog = signal(false);
  readonly editingStage = signal<WorkflowStageDto | null>(null);
  readonly expandedRowKeys = signal<Record<string, boolean>>({});

  private readonly translate = inject(TranslateService);
  private readonly navigationAccess = inject(NavigationAccessService);

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. Same mechanism as committee-detail.component.ts's canEdit /
  // canAddMember, deliberately rather than a second one.
  // POST /workflow-templates/:id/stages enforces workflows:manage
  // (workflow-template.controller.ts).
  readonly canCreate = computed(() => this.navigationAccess.hasPermission('workflows:manage'));
  // ACC-123 — the same permission, asked as a different question: may this
  // person CHANGE a stage. Kept separate from canCreate so the create scan and
  // the action scan each read the gate that names what it guards, and so a
  // future split of the two endpoints does not need every call site found.
  readonly canManage = this.canCreate;

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
  readonly actionsTrack = ACTIONS_TRACK;

  private readonly format = inject(FormatService);
  private readonly document = inject(DOCUMENT);

  /** ACC-232's phone width: below it the list is one column (the drawing's phone frame). */
  readonly phone = signal(false);

  constructor() {
    const media = this.document.defaultView?.matchMedia?.(`(max-width: ${SHELL_PHONE_BELOW_PX - 0.02}px)`);
    if (media) {
      this.phone.set(media.matches);
      const onChange = (e: MediaQueryListEvent): void => this.phone.set(e.matches);
      media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
    }
  }

  // ── ACC-255 PR 4a — what a stage allows and means, from the template ──────
  // The registries come with the template (record-registry.ts on the server);
  // each stage carries its stored action and flag keys. Nothing here decides a
  // rule: it names and counts what the server sent.

  /** The record actions a stage of this type may allow, in registry order. */
  readonly registryActions = computed<WorkflowRecordActionDto[]>(() => this.template()?.recordActions ?? []);
  private readonly registryFlags = computed<WorkflowStageFlagDto[]>(() => this.template()?.stageFlags ?? []);

  /** The actions this stage allows, in registry order; a key the registry does not list is not shown. */
  allowedActions(stage: WorkflowStageDto): WorkflowRecordActionDto[] {
    const allowed = new Set(stage.actions ?? []);
    return this.registryActions().filter((a) => allowed.has(a.key));
  }

  /** The stage's meanings, in registry order. */
  meaningsOf(stage: WorkflowStageDto): WorkflowStageFlagDto[] {
    const flags = new Set(stage.flags ?? []);
    return this.registryFlags().filter((f) => flags.has(f.key));
  }

  /** The Allows cell's tooltip and accessible name: the action names, or that nothing is allowed. */
  allowsTip(stage: WorkflowStageDto): string {
    const names = this.allowedActions(stage).map((a) => this.translate.instant(a.labelKey) as string);
    if (!names.length) return this.translate.instant('workflow.stageList.nothingAllowedTip');
    const separator = this.languageService.isArabic() ? '، ' : ', ';
    return this.translate.instant('workflow.stageList.allowsNamed', { names: names.join(separator) });
  }

  /** The Details cell: "2 transitions · 1 task on entry", or "No exits" for a stage that leads nowhere. */
  detailsText(stage: WorkflowStageDto): string {
    const transitions = stage.transitions?.length ?? 0;
    const tasks = stage.taskDefinitionCount ?? 0;
    const parts = [
      transitions ? this.format.count('workflow.stageTransitions', transitions) : this.translate.instant('workflow.stageList.noExits'),
    ];
    if (tasks) parts.push(this.format.count('workflow.tasksOnEntry', tasks));
    return parts.join(' · ');
  }

  /** The stage's name in the reader's language, for the controls that name it. */
  stageDisplayName(stage: WorkflowStageDto): string {
    return this.languageService.bilingual(stage.nameEn, stage.nameAr);
  }

  /** ACC-254 — the row's ⋯: reorder, then Remove apart (it is the one that deletes). */
  menuFor(stage: WorkflowStageDto): RowMenuItem[][] {
    const index = this.stageIndex(stage);
    const busy = this.reordering();
    return [
      [
        { id: 'moveUp', label: this.translate.instant('workflow.moveUp'), disabled: busy || index === 0 },
        { id: 'moveDown', label: this.translate.instant('workflow.moveDown'), disabled: busy || index === this.stages().length - 1 },
      ],
      [{ id: 'remove', label: this.translate.instant('common.remove'), danger: true, disabled: busy }],
    ];
  }

  pick(stage: WorkflowStageDto, id: string): void {
    const index = this.stageIndex(stage);
    if (id === 'moveUp') this.onMoveUp(index);
    if (id === 'moveDown') this.onMoveDown(index);
    if (id === 'remove') this.onRemove(stage);
  }

  // NO sortBy on any column, permanently — see the template comment. A header
  // is a label; labelling a column does not imply it sorts.
  // ACC-255 PR 4a — the drawing's tracks: # · Stage · Allows · Details, every
  // one fixed or fr (data-list's rule, ACC-234), so header and rows line up.
  // On a phone, one column. The approval mode, assignee and deadline are the
  // stage editor's, not the list's (Workflow Setup, section 3).
  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    const stage: DataListColumn = {
      key: 'name',
      label: this.translate.instant('workflow.stageList.colStage'),
      alwaysVisible: true,
      width: 'minmax(0, 1.6fr)',
    };
    if (this.phone()) return [{ ...stage, width: 'minmax(0, 1fr)' }];
    return [
      { key: 'number', label: this.translate.instant('workflow.stageList.colNumber'), alwaysVisible: true, width: NUMBER_TRACK },
      stage,
      { key: 'allows', label: this.translate.instant('workflow.stageList.colAllows'), width: 'minmax(0, 1fr)' },
      { key: 'details', label: this.translate.instant('workflow.stageList.colDetails'), width: 'minmax(0, 1.2fr)' },
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
    this.amConfirm.ask({
      tone: 'destructive',
      // workflow-template.service.ts removeStage(): a hard delete; its task
      // definitions cascade with it (schema: onDelete Cascade).
      message: this.translate.instant('workflow.confirmRemoveStage'),
      header: this.translate.instant('workflow.confirmRemoveStageHeader', {
        name: this.languageService.bilingual(stage.nameEn, stage.nameAr),
      }),
      acceptLabel: this.translate.instant('confirm.removeStage'),
      accept: () => {
        this.workflowTemplateService.removeStage(stage.id).subscribe({
          next: () => this.loadTemplate(),
          error: (err: unknown) =>
            this.error.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.removeFailed')),
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
            this.error.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.reorderFailed'));
            this.loadTemplate(); // reload to restore true server state
          },
        });
      },
      error: (err: unknown) => {
        this.error.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.reorderFailed'));
        this.loadTemplate(); // reload to restore true server state
      },
    });
  }

  /**
   * ACC-208 — a definition change patches only that stage's summary, in place.
   * Re-reading the whole template would replace every stage under an open
   * dialog in the row (ACC-55's trap); the rows are tracked by id, so this
   * keeps the expanded row and its section alive.
   */
  onStageTasksChanged(stageId: string, summary: StageTaskSummary): void {
    this.template.update((template) =>
      template
        ? { ...template, stages: template.stages?.map((s) => (s.id === stageId ? { ...s, ...summary } : s)) }
        : template,
    );
  }

  // ACC-82 — a Setup health Fix link (?stage=<id>) expands that stage's row.
  // Expanded, not its edit dialog: the condition does not record whether the
  // stage is unreachable because of its assignee (the edit dialog) or a
  // transition's trigger (the expanded panel), and the row shows both.
  private readonly fixLinkStage = injectFixLinkParam('stage');

  loadTemplate(): void {
    const id = this.route.snapshot.paramMap.get('templateId');
    if (!id) return;

    this.loading.set(true);
    this.workflowTemplateService.getTemplate(id).subscribe({
      next: (template) => {
        this.template.set(template);
        this.loading.set(false);
        this.reordering.set(false);
        const stageId = this.fixLinkStage();
        if (stageId && template.stages?.some((s) => s.id === stageId)) {
          this.expandedRowKeys.update((keys) => ({ ...keys, [stageId]: true }));
        }
      },
      error: () => {
        this.error.set('workflow.errorLoad');
        this.loading.set(false);
        this.reordering.set(false);
      },
    });
  }
}
