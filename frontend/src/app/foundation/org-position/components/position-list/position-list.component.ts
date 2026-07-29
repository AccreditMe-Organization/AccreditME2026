import { Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { FormsModule } from '@angular/forms';
import { OrgPositionService, IOrgPositionDto } from '../../services/org-position.service';
import { OrgUnitService, OrgUnitDto } from '../../../organization/services/org-unit.service';
import { PositionFormComponent } from '../position-form/position-form.component';

@Component({
  selector: 'app-position-list',
  standalone: true,
  imports: [
    TranslatePipe,
    TableModule,
    ButtonModule,
    TagModule,
    SelectModule,
    DialogModule,
    TooltipModule,
    FormsModule,
    PositionFormComponent,
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

      <div class="flex items-center gap-2">
        <p-select
          [options]="orgUnitOptions()"
          [(ngModel)]="selectedOrgUnitId"
          optionLabel="nameEn"
          optionValue="id"
          [showClear]="true"
          [placeholder]="'orgPosition.orgUnit' | translate"
          (onChange)="loadPositions()"
          (onClear)="onClearFilter()"
          styleClass="w-64"
        />
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() }}</p>
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
            <th style="width: 22%">{{ 'orgPosition.nameEn' | translate }}</th>
            <th style="width: 18%">{{ 'orgPosition.nameAr' | translate }}</th>
            <th style="width: 12%">{{ 'orgPosition.grade' | translate }}</th>
            <th style="width: 18%">{{ 'orgPosition.orgUnit' | translate }}</th>
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
            <td>{{ orgUnitName(position.orgUnitId) }}</td>
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
            <td colspan="6" class="text-center py-8 text-surface-400">
              {{ 'orgPosition.noPositions' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <p-dialog
      [(visible)]="formVisible"
      [header]="(editingPosition() ? 'orgPosition.editPosition' : 'orgPosition.addPosition') | translate"
      [modal]="true"
      styleClass="w-full max-w-lg"
    >
      @if (formVisible()) {
        <app-position-form
          [position]="editingPosition()"
          (saved)="onSaved()"
          (cancelled)="formVisible.set(false)"
        />
      }
    </p-dialog>
  `,
})
export class PositionListComponent implements OnInit {
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly translate = inject(TranslateService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly loading = signal(false);
  readonly positions = signal<IOrgPositionDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly orgUnitOptions = signal<OrgUnitDto[]>([]);
  readonly formVisible = signal(false);
  readonly editingPosition = signal<IOrgPositionDto | null>(null);

  selectedOrgUnitId: string | null = null;

  ngOnInit(): void {
    this.orgUnitService.getFlat().subscribe({
      next: (units) => this.orgUnitOptions.set(units),
      error: () => this.error.set('orgPosition.errorLoad'),
    });
    this.loadPositions();
  }

  orgUnitName(orgUnitId: string | null): string {
    if (!orgUnitId) return this.translate.instant('orgPosition.orgWide');
    return this.orgUnitOptions().find((u) => u.id === orgUnitId)?.nameEn ?? orgUnitId;
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

  onClearFilter(): void {
    this.selectedOrgUnitId = null;
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
          error: (err: { error?: { message?: string } }) =>
            this.error.set(err?.error?.message ?? 'Deactivate failed'),
        });
      },
    });
  }

  loadPositions(): void {
    this.loading.set(true);
    this.error.set(null);
    this.orgPositionService.listPositions(this.selectedOrgUnitId ?? undefined).subscribe({
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
