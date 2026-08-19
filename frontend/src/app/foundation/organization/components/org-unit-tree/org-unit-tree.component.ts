import { Component, OnInit, TemplateRef, ViewChild, inject, signal } from '@angular/core';
import { TreeNode } from 'primeng/api';
import { TranslatePipe } from '@ngx-translate/core';
import { TreeTableModule } from 'primeng/treetable';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { OrgUnitService, OrgUnitDto, orgUnitDisplayName } from '../../services/org-unit.service';
import { OrgUnitFormComponent } from '../org-unit-form/org-unit-form.component';
import { OrgUnitHeadPanelComponent } from '../org-unit-head-panel/org-unit-head-panel.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

@Component({
  selector: 'app-org-unit-tree',
  standalone: true,
  imports: [
    TranslatePipe,
    TreeTableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    OrgUnitFormComponent,
    OrgUnitHeadPanelComponent,
    EditDialogComponent,
  ],
  template: `
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-semibold">{{ 'organization.title' | translate }}</h2>
      <p-button
        icon="pi pi-plus"
        [label]="'organization.addUnit' | translate"
        (onClick)="onAdd()"
      />
    </div>

    @if (error()) {
      <p class="text-red-500 mb-4">{{ error() | translate }}</p>
    }

    <p-treeTable
      [value]="treeNodes()"
      [loading]="loading()"
      styleClass="w-full"
    >
      <ng-template pTemplate="header">
        <tr>
          <th style="width: 45%">{{ 'organization.nameEn' | translate }}</th>
          <th style="width: 15%">{{ 'organization.code' | translate }}</th>
          <th style="width: 20%">{{ 'organization.type' | translate }}</th>
          <th style="width: 10%" class="text-center">Status</th>
          <th style="width: 10%"></th>
        </tr>
      </ng-template>

      <ng-template pTemplate="body" let-rowNode let-rowData="rowData">
        <tr [ttRow]="rowNode" [class.opacity-50]="!rowData.isActive">
          <td>
            <p-treeTableToggler [rowNode]="rowNode" />
            {{ displayName(rowData) }}
          </td>
          <td>
            <span class="font-mono text-sm">{{ rowData.code }}</span>
          </td>
          <td>{{ rowData.type ?? '—' }}</td>
          <td class="text-center">
            <p-tag
              [value]="rowData.isActive ? 'Active' : 'Inactive'"
              [severity]="rowData.isActive ? 'success' : 'secondary'"
            />
          </td>
          <td>
            <div class="flex gap-1 justify-end">
              <p-button
                icon="pi pi-plus"
                [text]="true"
                size="small"
                (onClick)="onAddChild(rowData)"
                [pTooltip]="'organization.addChildUnit' | translate"
              />
              <p-button
                icon="pi pi-pencil"
                [text]="true"
                size="small"
                (onClick)="onEdit(rowData)"
                [pTooltip]="'common.edit' | translate"
              />
              <p-button
                icon="pi pi-crown"
                [text]="true"
                size="small"
                [disabled]="!rowData.isActive"
                [pTooltip]="'orgUnitHead.manageHead' | translate"
                (onClick)="onManageHead(rowData)"
              />
              <p-button
                icon="pi pi-ban"
                [text]="true"
                size="small"
                severity="danger"
                [disabled]="!rowData.isActive"
                [pTooltip]="'organization.deactivate' | translate"
                (onClick)="onDeactivate(rowData)"
              />
            </div>
          </td>
        </tr>
      </ng-template>

      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="5" class="text-center py-8 text-[var(--am-text-secondary)]">
            {{ 'organization.noUnits' | translate }}
          </td>
        </tr>
      </ng-template>
    </p-treeTable>

    <ng-template #formTpl>
      <app-org-unit-form
        [unit]="editingUnit()"
        [parentId]="newUnitParentId()"
        (saved)="onFormSaved()"
        (cancelled)="formVisible.set(false)"
      />
    </ng-template>
    <app-edit-dialog
      [(visible)]="formVisible"
      [header]="(editingUnit() ? 'organization.editUnit' : 'organization.addUnit') | translate"
      [content]="formTpl"
    />

    <ng-template #headPanelTpl>
      @if (managingHeadUnitId(); as unitId) {
        <app-org-unit-head-panel [orgUnitId]="unitId" (saved)="onHeadPanelSaved()" />
      }
    </ng-template>
    <app-edit-dialog
      [(visible)]="headPanelVisible"
      [header]="'orgUnitHead.manageHead' | translate"
      [content]="headPanelTpl"
    />
  `,
})
export class OrgUnitTreeComponent implements OnInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
  @ViewChild('headPanelTpl', { read: TemplateRef, static: true }) headPanelTpl!: TemplateRef<unknown>;

  private readonly orgUnitService = inject(OrgUnitService);

  readonly loading = signal(false);
  readonly treeNodes = signal<TreeNode<OrgUnitDto>[]>([]);
  readonly error = signal<string | null>(null);

  readonly formVisible = signal(false);
  readonly editingUnit = signal<OrgUnitDto | null>(null);
  readonly newUnitParentId = signal<string | null>(null);

  readonly headPanelVisible = signal(false);
  readonly managingHeadUnitId = signal<string | null>(null);

  ngOnInit(): void {
    this.loadTree();
  }

  displayName(unit: OrgUnitDto): string {
    return orgUnitDisplayName(unit);
  }

  onManageHead(unit: OrgUnitDto): void {
    this.managingHeadUnitId.set(unit.id);
    this.headPanelVisible.set(true);
  }

  onHeadPanelSaved(): void {
    // Deliberately left open — declare/complete/cancel/assign/vacate are
    // each one step in an ongoing workflow, not a single closing save
    // (unlike app-org-unit-form's onFormSaved()). The panel reloads its
    // own status internally after each action.
  }

  onAdd(): void {
    this.editingUnit.set(null);
    this.newUnitParentId.set(null);
    this.formVisible.set(true);
  }

  onAddChild(parent: OrgUnitDto): void {
    this.editingUnit.set(null);
    this.newUnitParentId.set(parent.id);
    this.formVisible.set(true);
  }

  onEdit(unit: OrgUnitDto): void {
    this.editingUnit.set(unit);
    this.newUnitParentId.set(null);
    this.formVisible.set(true);
  }

  onFormSaved(): void {
    this.formVisible.set(false);
    this.loadTree();
  }

  onDeactivate(unit: OrgUnitDto): void {
    // TODO: replace with PrimeNG ConfirmationService dialog
    this.orgUnitService.deactivate(unit.id).subscribe({
      next: () => this.loadTree(),
      error: (err: unknown) => this.error.set(extractErrorMessage(err, 'Deactivation failed')),
    });
  }

  private loadTree(): void {
    this.loading.set(true);
    this.error.set(null);
    this.orgUnitService.getTree().subscribe({
      next: (units) => {
        this.treeNodes.set(this.toTreeNodes(units));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load organization units');
        this.loading.set(false);
      },
    });
  }

  private toTreeNodes(units: OrgUnitDto[]): TreeNode<OrgUnitDto>[] {
    return units.map((unit) => ({
      data: unit,
      children: unit.children?.length ? this.toTreeNodes(unit.children) : [],
      expanded: true,
    }));
  }
}
