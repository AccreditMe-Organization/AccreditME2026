import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { WorkflowTemplateService, WorkflowTemplateDto } from '../../services/workflow-template.service';

@Component({
  selector: 'app-workflow-template-list',
  standalone: true,
  imports: [TranslatePipe, TableModule, ButtonModule, TagModule, TooltipModule],
  template: `
    <div class="flex flex-col h-full gap-4">

      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'workflow.title' | translate }}</h2>
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() }}</p>
      }

      <p-table
        [value]="templates()"
        [loading]="loading()"
        scrollable
        scrollHeight="flex"
        styleClass="w-full"
      >
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 22%">{{ 'workflow.nameEn' | translate }}</th>
            <th style="width: 18%">{{ 'workflow.nameAr' | translate }}</th>
            <th style="width: 16%">{{ 'workflow.objectType' | translate }}</th>
            <th style="width: 12%">{{ 'workflow.isDefault' | translate }}</th>
            <th style="width: 12%">{{ 'common.active' | translate }}</th>
            <th style="width: 20%"></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-template>
          <tr class="cursor-pointer hover:bg-surface-50" (click)="onRowClick(template)">
            <td>{{ template.nameEn }}</td>
            <td dir="rtl">{{ template.nameAr }}</td>
            <td>
              <p-tag [value]="template.objectType" severity="info" />
            </td>
            <td>
              @if (template.isDefault) {
                <i class="pi pi-star-fill text-yellow-500" [pTooltip]="'workflow.isDefault' | translate"></i>
              }
            </td>
            <td>
              <p-tag
                [value]="(template.isActive ? 'common.active' : 'common.inactive') | translate"
                [severity]="template.isActive ? 'success' : 'secondary'"
              />
            </td>
            <td>
              <div class="flex gap-1 justify-end">
                <p-button
                  icon="pi pi-star"
                  [text]="true"
                  size="small"
                  [disabled]="template.isDefault"
                  [pTooltip]="'workflow.setDefault' | translate"
                  (onClick)="onSetDefault(template, $event)"
                />
                @if (template.isActive) {
                  <p-button
                    icon="pi pi-ban"
                    [text]="true"
                    size="small"
                    severity="danger"
                    [pTooltip]="'workflow.deactivateTemplate' | translate"
                    (onClick)="onDeactivate(template, $event)"
                  />
                }
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="text-center py-8 text-[var(--am-text-secondary)]">
              {{ 'workflow.noTemplates' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>

    </div>
  `,
})
export class WorkflowTemplateListComponent implements OnInit {
  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);

  readonly loading = signal(false);
  readonly templates = signal<WorkflowTemplateDto[]>([]);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadTemplates();
  }

  onRowClick(template: WorkflowTemplateDto): void {
    void this.router.navigate([template.id, 'stages'], { relativeTo: this.route });
  }

  onSetDefault(template: WorkflowTemplateDto, event: Event): void {
    event.stopPropagation();
    this.workflowTemplateService.setDefault(template.id).subscribe({
      next: () => this.loadTemplates(),
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err?.error?.message ?? 'Set default failed'),
    });
  }

  onDeactivate(template: WorkflowTemplateDto, event: Event): void {
    event.stopPropagation();
    this.confirmationService.confirm({
      message: `Deactivate template "${template.nameEn}"?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.workflowTemplateService.deactivateTemplate(template.id).subscribe({
          next: () => this.loadTemplates(),
          error: (err: { error?: { message?: string } }) =>
            this.error.set(err?.error?.message ?? 'Deactivate failed'),
        });
      },
    });
  }

  private loadTemplates(): void {
    this.loading.set(true);
    this.error.set(null);
    this.workflowTemplateService.listTemplates().subscribe({
      next: (templates) => {
        this.templates.set(templates);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('workflow.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
