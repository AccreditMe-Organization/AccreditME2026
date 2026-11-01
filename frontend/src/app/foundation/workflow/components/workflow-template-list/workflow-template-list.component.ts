import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { WorkflowTemplateService, WorkflowTemplateDto } from '../../services/workflow-template.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { plainWorkflowRefusalKey } from '../../workflow-refusal';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { LanguageService } from '../../../../core/services/language.service';
import { DataListColumn, DataListComponent } from '../../../../shared/components/data-list/data-list.component';
import { DataListSource } from '../../../../shared/components/data-list/data-list.source';
import { ListRowDirective } from '../../../../shared/components/data-list/list-row.directive';
import { RowMenuComponent, RowMenuItem } from '../../../../shared/components/row-menu/row-menu.component';
import { SHELL_PHONE_BELOW_PX } from '../../../../layout/app-shell/app-shell.component';
import { workflowGroupLabelKey } from './workflow-list-groups';

/** One row of the list: a record type's heading, or one of its workflows. */
export type WorkflowListItem =
  | { kind: 'group'; key: string; objectType: string }
  // `index` counts workflow rows only: it is the row directive's index, and
  // index 0 is the list's first tab stop, which a heading never is.
  | { kind: 'workflow'; key: string; template: WorkflowTemplateDto; index: number };

/**
 * Groups the templates by record type, in the server's order (it sorts by
 * record type, then name), and pins each type's default LAST — the drawing's
 * list (Workflow Setup, section 7). A search keeps the workflows whose name
 * matches, with their headings.
 */
export function workflowListItems(templates: readonly WorkflowTemplateDto[], search = ''): WorkflowListItem[] {
  const term = search.trim().toLowerCase();
  const matches = (t: WorkflowTemplateDto): boolean =>
    !term || [t.nameEn, t.nameAr].some((name) => (name ?? '').toLowerCase().includes(term));
  const groups = new Map<string, WorkflowTemplateDto[]>();
  for (const t of templates) {
    if (!matches(t)) continue;
    groups.set(t.objectType, [...(groups.get(t.objectType) ?? []), t]);
  }
  const items: WorkflowListItem[] = [];
  let index = 0;
  for (const [objectType, rows] of groups) {
    items.push({ kind: 'group', key: `group:${objectType}`, objectType });
    for (const template of [...rows.filter((t) => !t.isDefault), ...rows.filter((t) => t.isDefault)]) {
      items.push({ kind: 'workflow', key: template.id, template, index: index++ });
    }
  }
  return items;
}

/**
 * ACC-120 slice 7 — the Workflows list as drawn (Workflow Setup, section 7,
 * and the list template, Templates, template 1).
 *
 * Grouped by record type, the default last in each group and said in words.
 * Headers are plain text: the list does not sort (the server takes no sort, and
 * the order is the meaning). One ⋯ per row holds every action, so no bare icon
 * and no destructive action sits outside the menu.
 *
 * THE PAGE OWNS ITS LOAD. It reads GET /workflow-templates once (unpaged on
 * purpose: one to a few workflows per record type), shows skeletons while it
 * waits, an alert with Retry if it fails, and the empty sentence only on a
 * successful read with no rows. The shared list renders the rows it was given.
 */
@Component({
  selector: 'app-workflow-template-list',
  standalone: true,
  imports: [PageHeaderComponent, TranslatePipe, ButtonModule, DataListComponent, ListRowDirective, RowMenuComponent],
  template: `
    <div class="flex flex-col h-full gap-4">
      <app-page-header [title]="'workflow.title' | translate" />

      @if (refusal(); as message) {
        <div class="am-wf-banner am-wf-banner--danger" role="alert" data-testid="workflow-refusal">
          <span class="flex-1 min-w-0">{{ message | translate }}</span>
          <p-button
            size="small"
            [text]="true"
            [label]="'workflow.list.dismiss' | translate"
            (onClick)="refusal.set(null)"
          />
        </div>
      }

      @if (status() === 'loading') {
        <div class="am-wf-frame" aria-busy="true" data-testid="workflow-list-loading">
          <span class="sr-only">{{ 'workflow.list.loading' | translate }}</span>
          @for (n of skeletonRows; track n) {
            <div class="am-wf-skeleton" aria-hidden="true">
              <span class="am-skeleton-bar"></span>
              <span class="am-skeleton-bar"></span>
            </div>
          }
        </div>
      } @else if (status() === 'error') {
        <div class="am-wf-banner am-wf-banner--danger" role="alert" data-testid="workflow-list-error">
          <span class="flex flex-col flex-1 min-w-0">
            <span class="font-semibold">{{ 'workflow.list.loadErrorTitle' | translate }}</span>
            <span>{{ 'workflow.list.nothingChanged' | translate }}</span>
          </span>
          <p-button
            size="small"
            [outlined]="true"
            [label]="'workflow.list.retry' | translate"
            (onClick)="loadTemplates()"
            data-testid="workflow-list-retry"
          />
        </div>
      } @else if (templates().length === 0) {
        <div class="am-wf-frame am-wf-empty" data-testid="workflow-list-empty">
          <span class="text-value font-semibold">{{ 'workflow.list.emptyTitle' | translate }}</span>
          <span class="text-meta text-[var(--am-ink-500)] max-w-[44ch]">{{ 'workflow.list.emptyBody' | translate }}</span>
        </div>
      } @else {
        <div class="am-wf-frame flex flex-col min-h-0">
          <app-data-list
            variant="page"
            [source]="source()"
            [trackBy]="trackByKey"
            [columns]="columns()"
            [showPager]="false"
            [searchPlaceholder]="'workflow.list.searchPlaceholder' | translate"
            [emptyTitle]="'workflow.list.emptyTitle' | translate"
            gridSuffix="48px"
          >
            <!-- Plain text: the list does not sort. -->
            <ng-template #listHeader let-h>
              @for (column of columns(); track column.key) {
                <span role="columnheader">{{ column.label }}</span>
              }
              <span></span>
            </ng-template>

            <ng-template #listRow let-item>
              @if (item.kind === 'group') {
                <div class="am-wf-group" role="row" data-testid="workflow-group">
                  <span role="rowheader">{{ groupLabelKey(item.objectType) | translate }}</span>
                </div>
              } @else {
                <div
                  amListRow
                  [amListRowKey]="item.template.id"
                  [amListRowIndex]="item.index"
                  (rowOpen)="open(item.template)"
                  (click)="open(item.template)"
                  class="am-wf-row grid items-center gap-3 px-3 py-2 cursor-pointer"
                  [class.am-wf-row--default]="item.template.isDefault"
                  style="grid-template-columns: var(--am-list-cols)"
                  data-testid="workflow-row"
                  [attr.data-template-id]="item.template.id"
                >
                  <span class="flex flex-col min-w-0" data-cell="workflow">
                    <!-- A phone wraps the name; a desktop cuts a long one and keeps it whole in its title. -->
                    <span
                      class="text-value font-medium"
                      [class.truncate]="!phone()"
                      [attr.title]="phone() ? null : templateName(item.template)"
                      data-testid="workflow-name"
                      >{{ templateName(item.template) }}</span
                    >
                    @if (item.template.isDefault) {
                      <span class="text-meta text-[var(--am-ink-500)]" data-testid="workflow-default-line">
                        <span class="font-semibold">{{ 'workflow.list.default' | translate }}</span>
                        · {{ (item.template.isProtected ? 'workflow.list.protectedSub' : 'workflow.list.defaultSub') | translate }}
                      </span>
                    }
                    @if (phone()) {
                      <span class="text-meta truncate" [class.am-wf-inactive]="!item.template.isActive" data-testid="workflow-state">
                        {{ (item.template.isActive ? 'common.active' : 'common.inactive') | translate }}
                      </span>
                    }
                  </span>
                  @if (!phone()) {
                    <span class="text-meta" [class.am-wf-inactive]="!item.template.isActive" data-testid="workflow-state">
                      {{ (item.template.isActive ? 'common.active' : 'common.inactive') | translate }}
                    </span>
                  }
                  <span class="justify-self-end" (click)="$event.stopPropagation()">
                    <am-row-menu
                      [groups]="menuFor(item.template)"
                      [label]="'workflow.list.actionsFor' | translate: { name: templateName(item.template) }"
                      (picked)="pick(item.template, $event)"
                    />
                  </span>
                </div>
              }
            </ng-template>
          </app-data-list>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .am-wf-frame {
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
        background: var(--am-card);
        overflow: hidden;
      }
      .am-wf-skeleton {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 120px;
        gap: var(--am-space-12);
        padding: var(--am-space-12);
        border-bottom: 1px solid var(--am-row-rule);
      }
      .am-wf-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--am-space-4);
        padding: var(--am-space-32) var(--am-space-24);
      }
      .am-wf-banner {
        display: flex;
        align-items: center;
        gap: var(--am-space-12);
        padding: var(--am-space-8) var(--am-space-12);
        border: 1px solid;
        border-radius: var(--am-radius-card);
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
      }
      .am-wf-banner--danger {
        background: var(--am-danger-bg);
        border-color: var(--am-danger-border);
        color: var(--am-danger-ink);
      }
      /* A record type's heading: the micro type, which Arabic sets without
         capitals or tracking (design-tokens.scss). */
      .am-wf-group {
        padding: var(--am-space-8) var(--am-space-12) var(--am-space-6);
        border-bottom: 1px solid var(--am-border);
        background: var(--am-surface);
        font-size: var(--am-type-micro-size);
        line-height: var(--am-type-micro-line);
        font-weight: var(--am-type-micro-weight);
        letter-spacing: var(--am-type-micro-tracking);
        text-transform: var(--am-type-micro-transform);
        color: var(--am-type-micro-color);
      }
      .am-wf-row {
        border-bottom: 1px solid var(--am-row-rule);
      }
      .am-wf-row:hover {
        background: var(--am-surface);
      }
      /* The default is pinned last and lightly tinted, as drawn; its words say
         what it is, so the tint is never the only signal. */
      .am-wf-row--default {
        background: color-mix(in srgb, var(--am-surface) 40%, var(--am-card));
      }
      .am-wf-inactive {
        color: var(--am-ink-500);
        font-style: italic;
      }
    `,
  ],
})
export class WorkflowTemplateListComponent implements OnInit {
  private readonly workflowTemplateService = inject(WorkflowTemplateService);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly amConfirm = inject(AmConfirmService);
  private readonly languageService = inject(LanguageService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly document = inject(DOCUMENT);

  // ACC-123 — workflows:manage, the permission both write endpoints carry
  // (workflow-template.controller.ts). The page itself needs it too since
  // ACC-255 PR 4a, so today every viewer holds it; the menu still asks, so the
  // actions follow the permission rather than the route.
  readonly canManage = computed(() => this.navigationAccess.hasPermission('workflows:manage'));

  /** The read's outcome: skeletons, the alert, or rows (empty only on a 200). */
  readonly status = signal<'loading' | 'error' | 'ready'>('loading');
  readonly templates = signal<WorkflowTemplateDto[]>([]);
  /** A refused Set as default or Deactivate: the server's sentence, dismissible. */
  readonly refusal = signal<string | null>(null);

  readonly skeletonRows = [0, 1, 2, 3, 4];

  /** Below the shell's phone width the row is one column of lines, as drawn. */
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

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    const workflow: DataListColumn = {
      key: 'workflow',
      label: this.translate.instant('workflow.list.colWorkflow'),
      alwaysVisible: true,
      width: 'minmax(0, 1fr)',
    };
    if (this.phone()) return [workflow];
    return [workflow, { key: 'state', label: this.translate.instant('workflow.list.colState'), alwaysVisible: true, width: '120px' }];
  });

  /** The loaded templates as the shared list's source; a new read is a new source. */
  readonly source = computed<DataListSource<WorkflowListItem>>(() => {
    const templates = this.templates();
    return (query) => {
      const data = workflowListItems(templates, query.search ?? '');
      const total = data.filter((i) => i.kind === 'workflow').length;
      return of({ data, total, page: 1, pageSize: Math.max(data.length, 1) });
    };
  });

  readonly trackByKey = (item: WorkflowListItem): string => item.key;

  ngOnInit(): void {
    this.loadTemplates();
  }

  /** The template's name in the reader's language (the English one when it has no Arabic). */
  templateName(template: { nameEn: string; nameAr: string | null }): string {
    return this.languageService.bilingual(template.nameEn, template.nameAr);
  }

  groupLabelKey(objectType: string): string {
    return workflowGroupLabelKey(objectType);
  }

  /**
   * The row's ⋯. Open always; Set as default (not on the default) and
   * Deactivate (only while active) for whoever may manage workflows. A
   * protected template offers Open only: the server refuses both for it.
   */
  menuFor(template: WorkflowTemplateDto): RowMenuItem[][] {
    const open: RowMenuItem = { id: 'open', label: this.translate.instant('workflow.list.open') };
    if (template.isProtected || !this.canManage()) return [[open]];
    const writes: RowMenuItem[] = [];
    if (!template.isDefault) writes.push({ id: 'setDefault', label: this.translate.instant('workflow.list.setDefault') });
    if (template.isActive) writes.push({ id: 'deactivate', label: this.translate.instant('workflow.list.deactivate'), danger: true });
    return writes.length ? [[open], writes] : [[open]];
  }

  pick(template: WorkflowTemplateDto, id: string): void {
    if (id === 'open') this.open(template);
    else if (id === 'setDefault') this.onSetDefault(template);
    else if (id === 'deactivate') this.onDeactivate(template);
  }

  open(template: WorkflowTemplateDto): void {
    void this.router.navigate([template.id, 'stages'], { relativeTo: this.route });
  }

  /** `event`: a caller outside the menu (a spec, a future button) may pass its click. */
  onSetDefault(template: WorkflowTemplateDto, event?: Event): void {
    event?.stopPropagation();
    this.refusal.set(null);
    this.workflowTemplateService.setDefault(template.id).subscribe({
      next: () => this.loadTemplates(),
      error: (err: unknown) =>
        this.refusal.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.setDefaultFailed')),
    });
  }

  onDeactivate(template: WorkflowTemplateDto, event?: Event): void {
    event?.stopPropagation();
    this.refusal.set(null);
    this.amConfirm.ask({
      tone: 'destructive',
      // workflow.service.ts startInstance() starts new records only on the
      // active DEFAULT template; transitions never check isActive, so records
      // already on it carry on.
      message: this.translate.instant(
        template.isDefault ? 'workflow.confirmDeactivateDefaultTemplate' : 'workflow.confirmDeactivateTemplate',
      ),
      header: this.translate.instant('workflow.confirmDeactivateTemplateHeader', { name: this.templateName(template) }),
      acceptLabel: this.translate.instant('confirm.deactivateTemplate'),
      accept: () => {
        this.workflowTemplateService.deactivateTemplate(template.id).subscribe({
          next: () => this.loadTemplates(),
          error: (err: unknown) =>
            this.refusal.set(plainWorkflowRefusalKey(err) ?? extractErrorMessage(err, 'workflow.error.deactivateFailed')),
        });
      },
    });
  }

  /** One read of GET /workflow-templates; Retry calls it again. */
  loadTemplates(): void {
    this.status.set('loading');
    this.workflowTemplateService.listTemplates().subscribe({
      next: (templates) => {
        this.templates.set(templates);
        this.status.set('ready');
      },
      error: () => this.status.set('error'),
    });
  }
}
