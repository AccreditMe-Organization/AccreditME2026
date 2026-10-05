import {
  Component,
  OnInit,
  TemplateRef,
  ViewChild,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { of, switchMap, tap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { OrgPositionService, IOrgPositionDto } from '../../services/org-position.service';
import { PositionFormComponent } from '../position-form/position-form.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import {
  DataListColumn,
  DataListComponent,
} from '../../../../shared/components/data-list/data-list.component';
import {
  DataListSource,
  clientSideSource,
} from '../../../../shared/components/data-list/data-list.source';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmNumberPipe } from '../../../../core/formatting';
import { StepStripComponent } from '../../../../shared/components/step-strip/step-strip.component';

/**
 * Org positions — ACC-120 slice 6, Template 1.
 *
 * ## A CLIENT-SIDE SOURCE, and why that is the honest choice here
 *
 * `GET /org-positions` returns a plain array: no page, no total, no sort
 * parameter. `clientSideSource()` does search, sort and slice in memory —
 * exactly what the endpoint would do in SQL — so the screen gets the whole
 * Template 1 toolbar without a backend change it does not need. A tenant has
 * fifteen positions; this is not a list that outgrows an array.
 *
 * The moment it does, the fix is an endpoint and one line here, because the
 * component only ever sees a `DataListSource`.
 *
 * ## The sortable set mirrors the comparators, deliberately
 *
 * A column is sortable only where a comparator exists, which is the same answer
 * the server gives for a column off its sort whitelist — it just does not have
 * to throw. The two boolean columns are not sortable: sorting fifteen rows into
 * "yes" and "blank" is not a reading of anything.
 */
@Component({
  selector: 'app-position-list',
  standalone: true,
  imports: [
    PageHeaderComponent,
    TranslatePipe,
    ButtonModule,
    TagModule,
    TooltipModule,
    PositionFormComponent,
    EditDialogComponent,
    DataListComponent,
    IconButtonComponent,
    AmNumberPipe,
    StepStripComponent,
  ],
  template: `
    <div class="flex h-full flex-col gap-4">
      <app-page-header
        [title]="'orgPosition.title' | translate"
        [purpose]="'orgPosition.purpose' | translate"
      >
        <div pageActions>
          @if (canCreate()) {
            <p-button
              [label]="'orgPosition.addPosition' | translate"
              icon="pi pi-plus"
              (onClick)="onAdd()"
            />
          }
        </div>
      </app-page-header>

      @if (error()) {
        <p class="text-red-500">{{ error() }}</p>
      }

      <app-data-list
        #list
        variant="page"
        [source]="source"
        [trackBy]="trackById"
        [columns]="columns()"
        [searchPlaceholder]="'orgPosition.searchPlaceholder' | translate"
        [emptyTitle]="'orgPosition.noPositions' | translate"
        [emptyMessage]="'orgPosition.noPositionsReason' | translate"
        persistKey="orgPositions"
        [urlSync]="true"
      >
        <ng-template #listHeader let-h>
          @for (column of columns(); track column.key) {
            @if (h.visible(column.key)) {
              @if (column.sortBy) {
                <button
                  type="button"
                  class="flex items-center gap-1 text-start uppercase hover:text-[var(--am-blue-primary)]"
                  (click)="h.sort(column.key)"
                >
                  {{ column.label }}
                  @if (h.sortBy === column.sortBy) {
                    <i
                      class="pi text-[10px]"
                      [class.pi-arrow-up]="h.sortDir === 'asc'"
                      [class.pi-arrow-down]="h.sortDir === 'desc'"
                    ></i>
                  }
                </button>
              } @else {
                <span class="uppercase">{{ column.label }}</span>
              }
            }
          }
          <span></span>
        </ng-template>

        <!-- The row supplies its own grid from --am-list-cols: app-data-list
             wraps the HEADER in that grid but renders this template straight
             into the rows body. -->
        <ng-template #listRow let-position let-visible="visible">
          <div
            class="grid items-center gap-3 border-b border-[var(--am-border)] px-3 py-2"
            style="grid-template-columns: var(--am-list-cols)"
          >
            @if (visible('nameEn')) {
              <span class="truncate text-[13px] font-medium">{{ position.nameEn }}</span>
            }
            @if (visible('nameAr')) {
              <span class="truncate text-[13px]" dir="rtl">{{ position.nameAr || '—' }}</span>
            }
            @if (visible('grade')) {
              <span
                class="text-[13px]"
                style="font-variant-numeric: tabular-nums"
                dir="ltr"
                >{{ position.grade | amNumber }}</span
              >
            }
            @if (visible('isSingleAssignee')) {
              <span>
                @if (position.isSingleAssignee) {
                  <p-tag [value]="'common.yes' | translate" severity="info" />
                }
              </span>
            }
            @if (visible('isUnitHeadPosition')) {
              <span>
                @if (position.isUnitHeadPosition) {
                  <p-tag [value]="'common.yes' | translate" severity="warn" />
                }
              </span>
            }
            @if (visible('isActive')) {
              <span>
                <p-tag
                  [value]="(position.isActive ? 'common.active' : 'common.inactive') | translate"
                  [severity]="position.isActive ? 'success' : 'secondary'"
                />
              </span>
            }

            <!-- ACC-123 — edit, deactivate and reactivate are all
                 positions:manage (org-position.controller.ts). -->
            @if (canManage()) {
              <div class="flex shrink-0 justify-end gap-1">
                <am-icon-button
                  icon="pi pi-pencil"
                  [label]="'orgPosition.editFor' | translate: { name: position.nameEn }"
                  (activated)="onEdit(position)"
                />
                @if (position.isActive) {
                  <am-icon-button
                    icon="pi pi-ban"
                    severity="danger"
                    [label]="'orgPosition.deactivateFor' | translate: { name: position.nameEn }"
                    (activated)="onDeactivate(position)"
                  />
                } @else {
                  <!-- am-icon-button has no 'success' severity (primary |
                       secondary | danger | contrast). Reactivate is the
                       primary action on an inactive row, so primary is the
                       right one rather than the nearest-looking one. -->
                  <am-icon-button
                    icon="pi pi-check-circle"
                    severity="primary"
                    [label]="'orgPosition.reactivateFor' | translate: { name: position.nameEn }"
                    (activated)="onReactivate(position)"
                  />
                }
              </div>
            } @else {
              <span></span>
            }
          </div>
        </ng-template>
      </app-data-list>
    </div>

    <ng-template #formTpl>
      <app-position-form
        [position]="editingPosition()"
        (saved)="onSaved($event)"
        (cancelled)="positionDialog.requestClose()"
        (ready)="positionFormRef.set($event)"
        (dirtyChange)="positionDirty.set($event)"
      />
    </ng-template>
    <!-- Declared HERE, not inside the form: p-dialog collects its pTemplate
         children at content init, so a footer arriving later never lands.
         Keeping the actions out of the body is also what keeps the body under
         the 420 cap — with them inside, both languages measured exactly 420
         and scrolled.

         Cancel goes through requestClose(), never straight to visible=false:
         that is the single place the unsaved-work question is asked. -->
    <ng-template #positionStepsTpl>
      @if (positionFormRef(); as f) {
        <am-step-strip
          [steps]="f.steps"
          [current]="f.step()"
          [ariaLabel]="'orgPosition.steps' | translate"
        />
      }
    </ng-template>
    <ng-template #positionFooterTpl>
      <div class="flex justify-end gap-2">
        @if (positionFormRef()?.canGoBack()) {
          <p-button
            [label]="'common.back' | translate"
            severity="secondary"
            [text]="true"
            (onClick)="positionFormRef()!.back()"
            [disabled]="!!positionFormRef()?.saving()"
          />
        }
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="positionDialog.requestClose()"
          [disabled]="!!positionFormRef()?.saving()"
        />
        @if (positionFormRef()?.canAdvance()) {
          <p-button [label]="'common.next' | translate" (onClick)="positionFormRef()!.next()" />
        } @else {
          <p-button
            [label]="'common.save' | translate"
            [loading]="!!positionFormRef()?.saving()"
            [disabled]="!positionFormRef() || !!positionFormRef()?.saving()"
            (onClick)="positionFormRef()!.onSubmit()"
          />
        }
      </div>
    </ng-template>
    <app-edit-dialog
      #positionDialog
      [(visible)]="formVisible"
      [header]="
        (editingPosition() ? 'orgPosition.editPosition' : 'orgPosition.addPosition') | translate
      "
      [content]="formTpl"
      [headerExtra]="positionStepsTpl"
      [footer]="positionFooterTpl"
      density="compact"
      [dirty]="positionDirty()"
    />
  `,
})
export class PositionListComponent {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly orgPositionService = inject(OrgPositionService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);

  readonly list = viewChild.required<DataListComponent<IOrgPositionDto>>('list');

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. POST /org-positions enforces positions:manage.
  readonly canCreate = computed(() => this.navigationAccess.hasPermission('positions:manage'));
  // ACC-123 — the same permission, asked about changing an existing position.
  readonly canManage = this.canCreate;

  /** null means NOT LOADED — distinct from loaded-and-empty. */
  readonly positions = signal<readonly IOrgPositionDto[] | null>(null);
  readonly error = signal<string | null>(null);
  readonly formVisible = signal(false);
  readonly editingPosition = signal<IOrgPositionDto | null>(null);
  readonly positionFormRef = signal<PositionFormComponent | null>(null);
  readonly positionDirty = signal(false);

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    return [
      {
        key: 'nameEn',
        label: this.translate.instant('orgPosition.nameEn'),
        sortBy: 'nameEn',
        alwaysVisible: true,
        width: 'minmax(180px, 1.4fr)',
      },
      {
        key: 'nameAr',
        label: this.translate.instant('orgPosition.nameAr'),
        sortBy: 'nameAr',
        width: 'minmax(140px, 1.1fr)',
      },
      {
        key: 'grade',
        label: this.translate.instant('orgPosition.grade'),
        sortBy: 'grade',
        width: '80px',
      },
      {
        key: 'isSingleAssignee',
        label: this.translate.instant('orgPosition.isSingleAssignee'),
        width: '130px',
      },
      {
        key: 'isUnitHeadPosition',
        label: this.translate.instant('orgPosition.isUnitHeadPosition'),
        width: '140px',
      },
      {
        key: 'isActive',
        label: this.translate.instant('common.active'),
        sortBy: 'isActive',
        width: '110px',
      },
    ];
  });

  readonly trackById = (position: IOrgPositionDto): string => position.id;

  private readonly slice: DataListSource<IOrgPositionDto> = clientSideSource(() => this.positions() ?? [], {
    searchFields: (p) => [p.nameEn, p.nameAr],
    comparators: {
      nameEn: (a, b) => a.nameEn.localeCompare(b.nameEn),
      nameAr: (a, b) => (a.nameAr ?? '').localeCompare(b.nameAr ?? ''),
      grade: (a, b) => a.grade - b.grade,
      isActive: (a, b) => Number(a.isActive) - Number(b.isActive),
    },
    // ACC-160 — a position with no Arabic name sorts LAST in both directions,
    // the same rule Role.nameAr's server sort follows. Before this, '' sorted
    // first ascending, ahead of every position that had the name being sorted.
    nullsLast: { nameAr: (p) => p.nameAr },
  });

  /**
   * ACC-120 slice 6 — THE SOURCE FETCHES, and that is a fix rather than a
   * preference. `clientSideSource()` resolves SYNCHRONOUSLY, so on first render
   * it returned 0 rows from a cache that had not loaded. The list went straight
   * to `status: 'rows'` with nothing in it and drew the genuinely-empty state —
   * "No positions defined yet" — for the ~2 seconds before the request came
   * back. Its skeleton never got a chance, because nothing was ever pending.
   *
   * That is loading rendered as nothing-exists, which ACC-111 forbids, and it is
   * not cosmetic: an admin who believes there are none creates a duplicate.
   *
   * Fetch once, then slice the cache. A query change (search, sort, page) does
   * NOT refetch — the cache answers it — and a mutation invalidates by setting
   * the cache to null before reload(). The list owns loading, empty, no-results
   * and error from here; this component's own `error` signal is for MUTATIONS
   * only, which the list never sees.
   */
  readonly source: DataListSource<IOrgPositionDto> = (query) => {
    const cached = this.positions();
    const items$ = cached
      ? of(cached)
      : this.orgPositionService.listPositions().pipe(tap((rows) => this.positions.set(rows)));
    return items$.pipe(switchMap(() => this.slice(query)));
  };


  // NO LOAD HERE. The list fetches through `source` on its own first query —
  // calling a loader as well would fire two requests and, worse, would put rows
  // in the cache before the list ever asked, so its skeleton would again never
  // show. The loaders exist for AFTER a mutation.

  onAdd(): void {
    this.positionFormRef.set(null);
    this.positionDirty.set(false);
    this.editingPosition.set(null);
    this.formVisible.set(true);
  }

  onEdit(position: IOrgPositionDto): void {
    this.positionFormRef.set(null);
    this.positionDirty.set(false);
    this.editingPosition.set(position);
    this.formVisible.set(true);
  }

  // ACC-43 — the dialog stays open when the vacant-role warning fires, so the
  // user actually sees it, rather than closing the instant the save succeeds.
  // Switches to edit-mode against the just-saved position so that a create left
  // open does not turn a second Save click into a duplicate create.
  onSaved(result: { position: IOrgPositionDto; hadVacantRoleWarning: boolean }): void {
    if (result.hadVacantRoleWarning) {
      this.editingPosition.set(result.position);
    } else {
      this.formVisible.set(false);
    }
    this.loadPositions();
  }

  onDeactivate(position: IOrgPositionDto): void {
    // ACC-120 — TRANSLATED. This confirm was three hardcoded English strings
    // ("Deactivate position …?", header "Confirm", "Deactivate failed"), so an
    // Arabic session got an English modal. Same class as the Working Calendar
    // labels CLAUDE.md already records; found by migrating the screen, not by a
    // scan, because no scan reads a ConfirmationService call.
    this.confirmationService.confirm({
      header: this.translate.instant('common.confirm'),
      message: this.translate.instant('orgPosition.deactivateConfirm', { name: position.nameEn }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.orgPositionService.deactivate(position.id).subscribe({
          next: () => this.loadPositions(),
          error: (err: unknown) =>
            this.error.set(
              extractErrorMessage(err, this.translate.instant('orgPosition.errorDeactivate')),
            ),
        });
      },
    });
  }

  // ACC-43 — no confirmation: reactivating is non-destructive, unlike
  // deactivate above, and tenant-list's own onReactivate() does the same.
  onReactivate(position: IOrgPositionDto): void {
    this.orgPositionService.reactivate(position.id).subscribe({
      next: () => this.loadPositions(),
      error: (err: unknown) =>
        this.error.set(
          extractErrorMessage(err, this.translate.instant('orgPosition.errorReactivate')),
        ),
    });
  }

  loadPositions(): void {
    // Invalidate, then let the LIST refetch through `source`. Doing the request
    // here instead would put the rows in the cache without the list ever
    // entering a pending state — which is the defect this replaced.
    this.positions.set(null);
    this.list().reload();
  }
}
