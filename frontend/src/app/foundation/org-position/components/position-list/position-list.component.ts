import { Component, OnInit, TemplateRef, ViewChild, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { OrgPositionService, IOrgPositionDto } from '../../services/org-position.service';
import { PositionFormComponent } from '../position-form/position-form.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

@Component({
  selector: 'app-position-list',
  standalone: true,
  imports: [
    TranslatePipe,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    PositionFormComponent,
    EditDialogComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">

      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'orgPosition.title' | translate }}</h2>
        <p-button
          [label]="'orgPosition.addPosition' | translate"
          icon="pi pi-plus"
          (onClick)="onAdd()"
        />
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() | translate }}</p>
      }

      <p-table
        [value]="positions()"
        [loading]="loading()"
        scrollable
        scrollHeight="flex"
        styleClass="w-full"
      >
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 20%">{{ 'orgPosition.nameEn' | translate }}</th>
            <th style="width: 16%">{{ 'orgPosition.nameAr' | translate }}</th>
            <th style="width: 10%">{{ 'orgPosition.grade' | translate }}</th>
            <th style="width: 12%">{{ 'orgPosition.isSingleAssignee' | translate }}</th>
            <th style="width: 12%">{{ 'orgPosition.isUnitHeadPosition' | translate }}</th>
            <th style="width: 12%">{{ 'common.active' | translate }}</th>
            <th style="width: 18%"></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-position>
          <tr>
            <td>{{ position.nameEn }}</td>
            <td dir="rtl">{{ position.nameAr }}</td>
            <td>
              <p-tag [value]="position.grade.toString()" severity="info" />
            </td>
            <td>
              @if (position.isSingleAssignee) {
                <p-tag [value]="'common.yes' | translate" severity="info" />
              }
            </td>
            <td>
              @if (position.isUnitHeadPosition) {
                <p-tag [value]="'common.yes' | translate" severity="warn" />
              }
            </td>
            <td>
              <p-tag
                [value]="(position.isActive ? 'common.active' : 'common.inactive') | translate"
                [severity]="position.isActive ? 'success' : 'secondary'"
              />
            </td>
            <td>
              <div class="flex gap-1 justify-end">
                <p-button
                  icon="pi pi-pencil"
                  [text]="true"
                  size="small"
                  (onClick)="onEdit(position)"
                />
                @if (position.isActive) {
                  <p-button
                    icon="pi pi-ban"
                    [text]="true"
                    size="small"
                    severity="danger"
                    [pTooltip]="'orgPosition.deactivate' | translate"
                    (onClick)="onDeactivate(position)"
                  />
                }
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="7" class="text-center py-8 text-[var(--am-text-secondary)]">
              {{ 'orgPosition.noPositions' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <ng-template #formTpl>
      <app-position-form
        [position]="editingPosition()"
        (saved)="onSaved()"
        (cancelled)="formVisible.set(false)"
      />
    </ng-template>
    <app-edit-dialog
      [(visible)]="formVisible"
      [header]="(editingPosition() ? 'orgPosition.editPosition' : 'orgPosition.addPosition') | translate"
      [content]="formTpl"
    />
  `,
})
export class PositionListComponent implements OnInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly orgPositionService = inject(OrgPositionService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly loading = signal(false);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly formVisible = signal(false);
  readonly editingPosition = signal<IOrgPositionDto | null>(null);

  ngOnInit(): void {
    this.loadPositions();
  }

  onAdd(): void {
    this.editingPosition.set(null);
    this.formVisible.set(true);
  }

  onEdit(position: IOrgPositionDto): void {
    this.editingPosition.set(position);
    this.formVisible.set(true);
  }

  onSaved(): void {
    this.formVisible.set(false);
    this.loadPositions();
  }

  onDeactivate(position: IOrgPositionDto): void {
    this.confirmationService.confirm({
      message: `Deactivate position "${position.nameEn}"?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.orgPositionService.deactivate(position.id).subscribe({
          next: () => this.loadPositions(),
          error: (err: unknown) =>
            this.error.set(extractErrorMessage(err, 'Deactivate failed')),
        });
      },
    });
  }

  loadPositions(): void {
    this.loading.set(true);
    this.error.set(null);
    this.orgPositionService.listPositions().subscribe({
      next: (positions) => {
        this.positions.set(positions);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('orgPosition.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
