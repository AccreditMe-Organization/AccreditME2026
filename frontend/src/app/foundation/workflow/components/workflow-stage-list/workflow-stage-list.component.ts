import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { ConfirmationService } from 'primeng/api';
import {
  WorkflowTemplateService,
  WorkflowTemplateDto,
  WorkflowStageDto,
} from '../../services/workflow-template.service';
import { WorkflowStageFormComponent } from '../workflow-stage-form/workflow-stage-form.component';
import { WorkflowTransitionEditorComponent } from '../workflow-transition-editor/workflow-transition-editor.component';

@Component({
  selector: 'app-workflow-stage-list',
  standalone: true,
  imports: [
    TranslatePipe,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    DialogModule,
    WorkflowStageFormComponent,
    WorkflowTransitionEditorComponent,
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
        <p class="text-red-500">{{ error() }}</p>
      }

      <p-table
        [value]="stages()"
        [loading]="loading()"
        dataKey="id"
        [expandedRowKeys]="expandedRowKeys()"
        scrollable
        scrollHeight="flex"
        styleClass="w-full"
      >
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 3%"></th>
            <th style="width: 18%">{{ 'workflow.nameEn' | translate }}</th>
            <th style="width: 15%">{{ 'workflow.nameAr' | translate }}</th>
            <th style="width: 12%">{{ 'workflow.slaWorkingHours' | translate }}</th>
            <th style="width: 14%">{{ 'workflow.approvalMode' | translate }}</th>
            <th style="width: 14%">{{ 'workflow.assigneeStrategy' | translate }}</th>
            <th style="width: 10%"></th>
            <th style="width: 14%"></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-stage let-i="rowIndex">
          <tr>
            <td>
              <p-button
                [icon]="isExpanded(stage.id) ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                [text]="true"
                size="small"
                [pRowToggler]="stage"
              />
            </td>
            <td>{{ stage.nameEn }}</td>
            <td dir="rtl">{{ stage.nameAr }}</td>
            <td>{{ stage.slaWorkingHours ? (stage.slaWorkingHours + 'h') : '—' }}</td>
            <td>
              <p-tag [value]="stage.approvalMode" severity="info" />
            </td>
            <td>{{ stage.assigneeStrategy }}</td>
            <td>
              <div class="flex gap-1">
                @if (stage.isInitial) {
                  <p-tag [value]="'workflow.isInitial' | translate" severity="success" />
                }
                @if (stage.isFinal) {
                  <p-tag [value]="'workflow.isFinal' | translate" severity="secondary" />
                }
              </div>
            </td>
            <td>
              <div class="flex gap-1 justify-end">
                <p-button
                  icon="pi pi-arrow-up"
                  [text]="true"
                  size="small"
                  [disabled]="reordering() || i === 0"
                  [pTooltip]="'workflow.moveUp' | translate"
                  (onClick)="onMoveUp(i)"
                />
                <p-button
                  icon="pi pi-arrow-down"
                  [text]="true"
                  size="small"
                  [disabled]="reordering() || i === stages().length - 1"
                  [pTooltip]="'workflow.moveDown' | translate"
                  (onClick)="onMoveDown(i)"
                />
                <p-button
                  icon="pi pi-pencil"
                  [text]="true"
                  size="small"
                  [disabled]="reordering()"
                  [pTooltip]="'workflow.editStage' | translate"
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
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="rowexpansion" let-stage>
          <tr>
            <td colspan="8" class="p-3">
              <app-workflow-transition-editor
                [stageId]="stage.id"
                [transitions]="stage.transitions ?? []"
                [availableStages]="stages()"
                (changed)="loadTemplate()"
              />
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="8" class="text-center py-8 text-[var(--am-text-secondary)]">
              {{ 'workflow.noStages' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>

      <p-dialog
        [visible]="showFormDialog()"
        (visibleChange)="showFormDialog.set($event)"
        [header]="(editingStage() ? 'workflow.editStage' : 'workflow.addStage') | translate"
        [modal]="true"
        [style]="{ width: '560px' }"
      >
        <app-workflow-stage-form
          [stage]="editingStage()"
          [templateId]="templateId()"
          [nextOrder]="nextOrderForNewStage()"
          (saved)="onStageSaved()"
          (cancelled)="showFormDialog.set(false)"
        />
      </p-dialog>

    </div>
  `,
})
export class WorkflowStageListComponent implements OnInit {
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

  readonly templateId = computed(() => this.template()?.id ?? '');
  readonly stages = computed(() => this.template()?.stages ?? []);

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

  isExpanded(stageId: string): boolean {
    return !!this.expandedRowKeys()[stageId];
  }

  openAdd(): void {
    this.editingStage.set(null);
    this.showFormDialog.set(true);
  }

  openEdit(stage: WorkflowStageDto): void {
    this.editingStage.set(stage);
    this.showFormDialog.set(true);
  }

  onStageSaved(): void {
    this.showFormDialog.set(false);
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
          error: (err: { error?: { message?: string } }) =>
            this.error.set(err?.error?.message ?? 'Remove failed'),
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
          error: (err: { error?: { message?: string } }) => {
            this.error.set(err?.error?.message ?? 'Reorder failed');
            this.loadTemplate(); // reload to restore true server state
          },
        });
      },
      error: (err: { error?: { message?: string } }) => {
        this.error.set(err?.error?.message ?? 'Reorder failed');
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
