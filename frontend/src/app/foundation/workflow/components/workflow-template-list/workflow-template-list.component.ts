import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { WorkflowTemplateService, WorkflowTemplateDto } from '../../services/workflow-template.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { workflowLabelKey } from '../../workflow-labels';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { LanguageService } from '../../../../core/services/language.service';

@Component({
  selector: 'app-workflow-template-list',
  standalone: true,
  imports: [PageHeaderComponent, TranslatePipe, TableModule, ButtonModule, TagModule, TooltipModule],
  template: `
    <div class="flex flex-col h-full gap-4">

      <app-page-header [title]="'workflow.title' | translate" />

      @if (error()) {
        <p class="text-red-500">{{ error() | translate }}</p>
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
            <td dir="rtl">{{ template.nameAr || '—' }}</td>
            <td>
              <p-tag [value]="objectTypeLabelKey(template.objectType) | translate" severity="info" data-testid="template-object-type" />
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
              <!-- ACC-123 — both actions are workflows:manage, which the
                   endpoints enforce. Before this they were shown to anyone who
                   could READ the list, and the server refused each one. -->
              <div class="flex gap-1 justify-end">
                @if (canManage()) {
                  <p-button
                    icon="pi pi-star"
                    [text]="true"
                    size="small"
                    [disabled]="template.isDefault"
                    [pTooltip]="
                      (template.isDefault
                        ? 'workflow.alreadyDefault'
                        : 'workflow.setDefault'
                      ) | translate
                    "
                    [ariaLabel]="
                      (template.isDefault ? 'workflow.alreadyDefaultNamed' : 'workflow.setDefaultNamed')
                        | translate: { name: templateName(template) }
                    "
                    (onClick)="onSetDefault(template, $event)"
                  />
                  @if (template.isActive) {
                    <p-button
                      icon="pi pi-ban"
                      [text]="true"
                      size="small"
                      severity="danger"
                      [pTooltip]="'workflow.deactivateTemplate' | translate"
                      [ariaLabel]="'workflow.deactivateTemplateNamed' | translate: { name: templateName(template) }"
                      (onClick)="onDeactivate(template, $event)"
                    />
                  }
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
  /** ACC-254 — the record type in words, never the stored code. */
  /** The template's name in the reader's language, for the controls that name it. */
  templateName(template: { nameEn: string; nameAr: string | null }): string {
    return this.languageService.bilingual(template.nameEn, template.nameAr);
  }

  objectTypeLabelKey(objectType: string | null | undefined): string {
    return workflowLabelKey('objectType', objectType);
  }

  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly amConfirm = inject(AmConfirmService);
  private readonly languageService = inject(LanguageService);
  private readonly navigationAccess = inject(NavigationAccessService);

  // ACC-123 — workflows:manage, the permission both write endpoints carry
  // (workflow-template.controller.ts). workflows:view opens this list and does
  // nothing else.
  readonly canManage = computed(() =>
    this.navigationAccess.hasPermission('workflows:manage'),
  );

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
      error: (err: unknown) =>
        this.error.set(extractErrorMessage(err, 'Set default failed')),
    });
  }

  onDeactivate(template: WorkflowTemplateDto, event: Event): void {
    event.stopPropagation();
    this.amConfirm.ask({
      tone: 'destructive',
      // workflow.service.ts startInstance() starts new records only on the
      // active DEFAULT template; transitions never check isActive, so records
      // already on it carry on.
      message: this.translate.instant(
        template.isDefault ? 'workflow.confirmDeactivateDefaultTemplate' : 'workflow.confirmDeactivateTemplate',
      ),
      header: this.translate.instant('workflow.confirmDeactivateTemplateHeader', {
        name: this.languageService.bilingual(template.nameEn, template.nameAr),
      }),
      acceptLabel: this.translate.instant('confirm.deactivateTemplate'),
      accept: () => {
        this.workflowTemplateService.deactivateTemplate(template.id).subscribe({
          next: () => this.loadTemplates(),
          error: (err: unknown) =>
            this.error.set(extractErrorMessage(err, 'Deactivate failed')),
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
