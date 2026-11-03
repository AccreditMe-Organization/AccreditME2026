import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import {
  WorkflowTemplateService,
  WorkflowStageDto,
  WorkflowTransitionDto,
} from '../../services/workflow-template.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { plainWorkflowRefusalKey } from '../../workflow-refusal';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { RowMenuComponent, RowMenuItem } from '../../../../shared/components/row-menu/row-menu.component';
import { workflowLabelKey } from '../../workflow-labels';
import { TransitionActionsDialogComponent } from '../transition-actions-dialog/transition-actions-dialog.component';

/** Which transition to open, and the control that opened it (focus returns there). */
export interface TransitionOpenEvent {
  transitionId: string;
  opener: HTMLElement | null;
}

/**
 * A stage's transitions, in its expanded row on the Stages page.
 *
 * ACC-271 PR 5b — a LIST, no longer an editor: Add transition, a row's name and
 * Edit open the transition PANEL on the page (am-transition-panel), which
 * replaced the Add and Edit dialogs. The columns are the drawing's: the move
 * (with "Done by the app" for one the app runs), where it goes, and its kind.
 * "Who can trigger" is gone: whoever works the stage presses its moves.
 *
 * A move the app runs (the server's mover APP) has no Edit and no ⋯; its name
 * still opens the panel, read-only. So does every move of a protected workflow,
 * whose moves the server refuses to change. Each move appears once, under the
 * stage it leaves, so a move the app makes from three stages (Withdraw) is
 * three rows: nothing groups or hides one.
 *
 * The ⋯ holds Automatic actions and Remove. The Actions dialog is given the
 * transition as last loaded, looked up by id, so it never shows the actions
 * from before a save.
 */
@Component({
  selector: 'app-workflow-transition-editor',
  standalone: true,
  imports: [TranslatePipe, TableModule, ButtonModule, TagModule, TooltipModule, RowMenuComponent, TransitionActionsDialogComponent],
  template: `
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h3 class="font-medium text-sm">{{ 'workflow.transitions' | translate }}</h3>
        <!-- workflows:manage, and never on a protected workflow (the server refuses it). -->
        @if (canAddTransition()) {
          <p-button
            icon="pi pi-plus"
            size="small"
            [label]="'workflow.addTransition' | translate"
            (onClick)="add.emit({ opener: $any($event)?.currentTarget ?? null })"
            data-tr-add
          />
        }
      </div>

      @if (error()) {
        <p class="text-red-500 text-sm" role="alert">{{ error() | translate }}</p>
      }

      <!-- ACC-254 — fixed column widths, so nothing pushes the table past the
           panel's column and the page sideways. The name and destination WRAP,
           whole, rather than ending in an ellipsis; the Kind chip stays on one
           line because its column is sized to the longest chip in both
           languages. On a phone the table may scroll sideways inside this frame
           (ACC-254's allowance). -->
      <div class="am-tr-scroll" data-tr-scroll>
        <p-table [value]="transitionList()" styleClass="w-full am-tr-table" [tableStyle]="{ 'table-layout': 'fixed', width: '100%', 'min-width': '30rem' }">
          <ng-template pTemplate="header">
            <tr>
              <th>{{ 'workflow.transitionPanel.colTransition' | translate }}</th>
              <th>{{ 'workflow.transitionPanel.to' | translate }}</th>
              <th class="am-tr-col-kind">{{ 'workflow.kind.label' | translate }}</th>
              <th class="am-tr-col-actions"><span class="am-tr-sr">{{ 'workflow.transitionPanel.colActions' | translate }}</span></th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-transition>
            <tr [attr.data-transition-row]="transition.id" [class.am-tr-row--current]="transition.id === selectedId">
              <td class="am-tr-wrap" data-tr-label>
                <button
                  type="button"
                  class="am-tr-open"
                  [attr.aria-label]="openLabel(transition)"
                  (click)="open.emit({ transitionId: transition.id, opener: $any($event).currentTarget })"
                  data-tr-open
                >{{ transitionLabel(transition) }}</button>
                @if (transition.mover === 'APP') {
                  <span class="am-tr-chip am-tr-chip--app" data-tr-app>{{ 'workflow.mover.APP' | translate }}</span>
                }
                @if (transition.isApprovalPath) {
                  <p-tag [value]="'workflow.approvalPath' | translate" severity="success" />
                }
              </td>
              <td class="am-tr-wrap" data-tr-to>{{ stageName(transition.toStageId) }}</td>
              <td>
                <!-- ACC-208 — Send back is dashed, as returns are in the stage
                     strip; End the record is outlined in danger (drawing). -->
                <span [class]="'am-tr-chip am-tr-chip--' + kindOf(transition).toLowerCase()" data-tr-kind>
                  {{ kindLabelKey(transition) | translate }}
                </span>
              </td>
              <td>
                @if (canEditRow(transition)) {
                  <div class="flex gap-1 justify-end items-center">
                    <p-button
                      icon="pi pi-pencil"
                      [text]="true"
                      size="small"
                      [pTooltip]="'common.edit' | translate"
                      [ariaLabel]="'workflow.editTransitionNamed' | translate: { name: transitionLabel(transition) }"
                      (onClick)="open.emit({ transitionId: transition.id, opener: $any($event)?.currentTarget ?? null })"
                      data-tr-edit
                    />
                    <am-row-menu
                      [groups]="menu()"
                      [label]="'workflow.transitionMenuFor' | translate: { name: transitionLabel(transition) }"
                      (picked)="pick(transition, $event)"
                    />
                  </div>
                }
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4" class="text-center py-4 text-[var(--am-text-secondary)]">
                {{ 'workflow.noTransitions' | translate }}
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>

      <am-transition-actions-dialog
        [transition]="actionsTransition()"
        [isProtected]="isProtected"
        [visible]="actionsTransitionId() !== null"
        (visibleChange)="!$event && actionsTransitionId.set(null)"
        (changed)="changed.emit()"
      />
    </div>
  `,
  styles: [
    `
      .am-tr-chip {
        display: inline-block;
        max-inline-size: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: middle;
        font-size: var(--am-type-micro-size);
        font-weight: 600;
        border-radius: var(--am-radius-control);
        padding: 0 var(--am-space-6);
        white-space: nowrap;
      }
      /* ACC-254 — no cell paints outside its column (ACC-234's rule). */
      .am-tr-table td,
      .am-tr-table th {
        min-inline-size: 0;
        overflow: hidden;
      }
      /* The fixed columns, each sized to its content in both languages: the
         longest Kind chip ("End the record", 89px) with the cell's 16px padding
         on both sides; Edit and the ⋯. The move and its destination share the
         rest. */
      .am-tr-col-kind {
        inline-size: 7.75rem;
      }
      .am-tr-col-actions {
        inline-size: 6rem;
      }
      .am-tr-scroll {
        overflow-x: auto;
        max-width: 100%;
      }
      .am-tr-wrap {
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .am-tr-open {
        display: inline;
        margin-inline-end: var(--am-space-6);
        padding: 0;
        background: none;
        border: 0;
        font: inherit;
        color: var(--am-primary-700);
        text-align: start;
        cursor: pointer;
        overflow-wrap: anywhere;
      }
      .am-tr-open:hover {
        text-decoration: underline;
      }
      .am-tr-open:focus-visible {
        outline: 2px solid var(--am-primary-600);
        outline-offset: 2px;
        border-radius: var(--am-radius-control);
      }
      .am-tr-row--current .am-tr-open {
        font-weight: 700;
      }
      .am-tr-chip--advance {
        color: var(--am-primary-700);
        background: var(--am-primary-100);
        border: 1px solid var(--am-primary-100);
      }
      .am-tr-chip--return {
        color: var(--am-ink-700);
        background: var(--am-surface-raised);
        border: 1px dashed var(--am-ink-500);
      }
      .am-tr-chip--exit {
        color: var(--am-danger-ink);
        background: var(--am-surface-raised);
        border: 1px solid var(--am-danger-border);
      }
      /* "Done by the app": its own chip, quieter than a kind. */
      .am-tr-chip--app {
        color: var(--am-ink-700);
        background: var(--am-surface);
        border: 1px solid var(--am-border);
      }
      .am-tr-sr {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    `,
  ],
})
export class WorkflowTransitionEditorComponent {
  @Input() stageId!: string;
  @Input()
  set transitions(value: WorkflowTransitionDto[]) {
    this.transitionList.set(value ?? []);
  }
  @Input() availableStages: WorkflowStageDto[] = [];
  /** The server's isProtected: its moves are read-only. */
  @Input() isProtected = false;
  /** The transition open in the page's panel, marked in its row. */
  @Input() selectedId: string | null = null;
  /** A remove or an action change: the page reloads. */
  @Output() changed = new EventEmitter<void>();
  /** A row's name or Edit: open that transition in the panel. */
  @Output() open = new EventEmitter<TransitionOpenEvent>();
  /** Add transition: open the panel, empty, for this stage. */
  @Output() add = new EventEmitter<{ opener: HTMLElement | null }>();

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly amConfirm = inject(AmConfirmService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);
  private readonly languageService = inject(LanguageService);

  readonly transitionList = signal<WorkflowTransitionDto[]>([]);
  readonly error = signal<string | null>(null);

  // ACC-123 — workflows:manage, what every transition endpoint carries.
  readonly canManage = computed(() => this.navigationAccess.hasPermission('workflows:manage'));

  /** Moves may be added here: the permission, and a workflow the server lets change. */
  canAddTransition(): boolean {
    return this.canManage() && !this.isProtected;
  }

  /** Edit and the ⋯: an editable workflow, and a move a person presses. */
  canEditRow(transition: WorkflowTransitionDto): boolean {
    return this.canAddTransition() && transition.mover !== 'APP';
  }

  /** The Actions dialog's transition, by id, from what was last loaded. */
  readonly actionsTransitionId = signal<string | null>(null);
  readonly actionsTransition = computed(() => {
    const id = this.actionsTransitionId();
    return id ? (this.transitionList().find((t) => t.id === id) ?? null) : null;
  });

  readonly menu = computed<RowMenuItem[][]>(() => {
    this.translate.currentLang();
    return [
      [{ id: 'actions', label: this.translate.instant('workflow.transitionPanel.actionsTitle') as string }],
      [{ id: 'remove', label: this.translate.instant('common.remove') as string, danger: true }],
    ];
  });

  pick(transition: WorkflowTransitionDto, id: string): void {
    if (id === 'actions') this.actionsTransitionId.set(transition.id);
    if (id === 'remove') this.onRemove(transition);
  }

  /** A transition read before ACC-190's column existed reads as the default. */
  kindOf(transition: WorkflowTransitionDto): string {
    return transition.kind ?? 'ADVANCE';
  }

  kindLabelKey(transition: WorkflowTransitionDto): string {
    return workflowLabelKey('transitionKind', this.kindOf(transition));
  }

  transitionLabel(transition: WorkflowTransitionDto): string {
    return this.languageService.bilingual(transition.labelEn, transition.labelAr);
  }

  /** The name button's accessible name: open, or view a move that can't be changed. */
  openLabel(transition: WorkflowTransitionDto): string {
    const key = this.canEditRow(transition) ? 'workflow.transitionPanel.openNamed' : 'workflow.transitionPanel.viewNamed';
    return this.translate.instant(key, { name: this.transitionLabel(transition) }) as string;
  }

  stageName(stageId: string): string {
    const stage = this.availableStages.find((s) => s.id === stageId);
    return stage ? this.languageService.bilingual(stage.nameEn, stage.nameAr) : '—';
  }

  onRemove(transition: WorkflowTransitionDto): void {
    this.amConfirm.ask({
      tone: 'destructive',
      // workflow-template.service.ts removeTransition() deletes its actions, then the transition.
      message: this.translate.instant('workflow.confirmRemoveTransition'),
      header: this.translate.instant('workflow.confirmRemoveTransitionHeader', { name: this.transitionLabel(transition) }),
      acceptLabel: this.translate.instant('confirm.removeTransition'),
      accept: () => {
        this.workflowTemplateService.removeTransition(transition.id).subscribe({
          next: () => this.changed.emit(),
          error: (err: unknown) =>
            this.error.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.removeFailed')),
        });
      },
    });
  }
}
