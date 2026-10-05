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
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { of, switchMap, tap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextModule } from 'primeng/inputtext';
import { ConfirmationService } from 'primeng/api';
import { LookupService, LookupCategoryDto, LookupValueDto } from '../../services/lookup.service';
import { LookupValueFormComponent } from '../lookup-value-form/lookup-value-form.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import {
  DataListColumn,
  DataListComponent,
} from '../../../../shared/components/data-list/data-list.component';
import {
  DataListSource,
  clientSideSource,
} from '../../../../shared/components/data-list/data-list.source';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { IconButtonComponent } from '../../../../shared/components/icon-button/icon-button.component';
import { StepStripComponent } from '../../../../shared/components/step-strip/step-strip.component';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

/**
 * Lookup values — ACC-120 slice 6, Template 1.
 *
 * ## THE EXTENSIBLE TAG NOW CARRIES ITS OWN LABEL
 *
 * Beside the page title it read a bare "Yes", which CLAUDE.md already recorded
 * as needing fixing. The key is right in the CATEGORY TABLE, where an
 * "Extensible" column header explains it; beside a title it has no column to
 * lean on, so "Yes" answers a question nobody asked. The tag now says
 * "Extensible" or "Not extensible" and the row column keeps the short form.
 *
 * ## DELETE NOW ASKS
 *
 * It did not. The trash icon called removeValue() immediately, with a TODO
 * beside it saying a confirm belonged there. Deleting a tenant lookup value is
 * destructive and reaches every record that references it, so it asks — and
 * this is a migration slice touching the row the button sits on, which is the
 * cheapest moment it will ever be fixed in.
 *
 * ## Four error paths were hardcoded English
 *
 * "Hide failed", "Unhide failed", "Delete failed", "Save failed" — fallbacks
 * passed to extractErrorMessage, so an Arabic session saw English whenever the
 * server sent no message. Same class as the Working Calendar labels CLAUDE.md
 * records, and invisible to every scan because they are string literals in
 * TypeScript rather than untranslated template text.
 */
@Component({
  selector: 'app-lookup-value-list',
  standalone: true,
  imports: [
    PageHeaderComponent,
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    TagModule,
    TooltipModule,
    InputTextModule,
    LookupValueFormComponent,
    EditDialogComponent,
    DataListComponent,
    FieldComponent,
    IconButtonComponent,
    StepStripComponent,
  ],
  template: `
    <div class="flex h-full flex-col gap-4">
      <!-- ACC-79 — no back arrow: the breadcrumb links Lookups, one step up. -->
      @if (category(); as cat) {
        <app-page-header [title]="displayLabel(cat)" [eyebrow]="'lookup.valuesEyebrow' | translate">
          <div pageActions class="flex items-center gap-3">
            <p-tag
              [value]="(cat.isSystem ? 'lookup.typeSystem' : 'lookup.typeTenant') | translate"
              [severity]="cat.isSystem ? 'info' : 'secondary'"
            />
            <!-- Its own label, not a bare "Yes" — there is no column here to
                 explain one. -->
            <p-tag
              [value]="
                (cat.isExtensible ? 'lookup.extensibleTag' : 'lookup.notExtensibleTag') | translate
              "
              [severity]="cat.isExtensible ? 'success' : 'secondary'"
              [pTooltip]="cat.isExtensible ? '' : ('lookup.extensibleNoTooltip' | translate)"
            />
            @if (cat.isExtensible && canCreate()) {
              <p-button
                icon="pi pi-plus"
                [label]="'lookup.addValue' | translate"
                (onClick)="openAdd()"
              />
            }
          </div>
        </app-page-header>
      }

      @if (error()) {
        <p class="text-red-500">{{ error() }}</p>
      }

      <app-data-list
        #list
        variant="page"
        [source]="source"
        [trackBy]="trackById"
        [columns]="columns()"
        [searchPlaceholder]="'lookup.valuesSearchPlaceholder' | translate"
        [emptyTitle]="'lookup.noValues' | translate"
        [emptyMessage]="'lookup.noValuesReason' | translate"
        persistKey="lookupValues"
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

        <ng-template #listRow let-val let-visible="visible">
          <div
            class="grid items-center gap-3 border-b border-[var(--am-border)] px-3 py-2"
            style="grid-template-columns: var(--am-list-cols)"
          >
            @if (visible('label')) {
              <span class="truncate text-[13px]" [class.italic]="val.labelOverrideEn">
                {{ effectiveLabel(val) }}
                @if (val.labelOverrideEn) {
                  <sup class="ms-0.5" [pTooltip]="'lookup.overriddenTooltip' | translate">*</sup>
                }
              </span>
            }
            @if (visible('key')) {
              <span class="truncate font-mono text-[12px]" dir="ltr">{{ val.key }}</span>
            }
            @if (visible('layer')) {
              <span>
                <p-tag
                  [value]="
                    (val.layer === 'SYSTEM' ? 'lookup.typeSystem' : 'lookup.typeTenant') | translate
                  "
                  [severity]="val.layer === 'SYSTEM' ? 'info' : 'secondary'"
                />
              </span>
            }
            @if (visible('status')) {
              <span>
                <p-tag [value]="statusLabel(val) | translate" [severity]="statusSeverity(val)" />
              </span>
            }

            <!-- ACC-123 — hide, unhide, override label, edit and delete are all
                 lookups:manage (lookup.controller.ts). Gated as one block
                 because they share the permission, and because the
                 override-label control uses pi-tag, which is not in
                 check:action-gating's icon vocabulary — gating the container
                 covers what the scan cannot see. -->
            @if (canManage()) {
              <div class="flex shrink-0 justify-end gap-1">
                @if (val.layer === 'SYSTEM' && !val.isHidden) {
                  <am-icon-button
                    icon="pi pi-eye-slash"
                    [label]="'lookup.hideFor' | translate: { name: effectiveLabel(val) }"
                    (activated)="onHide(val)"
                  />
                }
                @if (val.layer === 'SYSTEM' && val.isHidden) {
                  <am-icon-button
                    icon="pi pi-eye"
                    [label]="'lookup.unhideFor' | translate: { name: effectiveLabel(val) }"
                    (activated)="onUnhide(val)"
                  />
                }
                <am-icon-button
                  icon="pi pi-tag"
                  [label]="'lookup.overrideLabelFor' | translate: { name: effectiveLabel(val) }"
                  (activated)="openOverride(val)"
                />
                @if (val.layer === 'TENANT') {
                  <am-icon-button
                    icon="pi pi-pencil"
                    [label]="'lookup.editFor' | translate: { name: effectiveLabel(val) }"
                    (activated)="openEdit(val)"
                  />
                  <am-icon-button
                    icon="pi pi-trash"
                    severity="danger"
                    [label]="'lookup.deleteFor' | translate: { name: effectiveLabel(val) }"
                    (activated)="onDelete(val)"
                  />
                }
              </div>
            } @else {
              <span></span>
            }
          </div>
        </ng-template>
      </app-data-list>

      <!-- Add / Edit -->
      <ng-template #formTpl>
        <app-lookup-value-form
          [categoryKey]="categoryKey"
          [value]="editingValue()"
          (saved)="onSaved()"
          (cancelled)="valueDialog.requestClose()"
          (ready)="valueFormRef.set($event)"
          (dirtyChange)="valueDirty.set($event)"
        />
      </ng-template>
      <!-- The step strip lives in the dialog HEADER, where it costs nothing
           against the 420px body cap — the same placement task-form uses, and
           for the same reason. It renders only when the category has attributes
           to put on a second step. -->
      <ng-template #valueStepsTpl>
        @if (valueFormRef(); as f) {
          <am-step-strip
            [steps]="f.steps()"
            [current]="f.step()"
            [ariaLabel]="'lookup.steps' | translate"
          />
        }
      </ng-template>
      <ng-template #valueFooterTpl>
        <div class="flex justify-end gap-2">
          @if (valueFormRef()?.canGoBack()) {
            <p-button
              [label]="'common.back' | translate"
              severity="secondary"
              [text]="true"
              (onClick)="valueFormRef()!.back()"
              [disabled]="!!valueFormRef()?.saving()"
            />
          }
          <p-button
            [label]="'common.cancel' | translate"
            severity="secondary"
            [text]="true"
            (onClick)="valueDialog.requestClose()"
            [disabled]="!!valueFormRef()?.saving()"
          />
          @if (valueFormRef()?.canAdvance()) {
            <p-button [label]="'common.next' | translate" (onClick)="valueFormRef()!.next()" />
          } @else {
            <p-button
              [label]="(editingValue() ? 'common.save' : 'common.add') | translate"
              [loading]="!!valueFormRef()?.saving()"
              [disabled]="!valueFormRef() || !!valueFormRef()?.saving()"
              (onClick)="valueFormRef()!.onSubmit()"
            />
          }
        </div>
      </ng-template>
      <app-edit-dialog
        #valueDialog
        [(visible)]="showFormDialog"
        [header]="(editingValue() ? 'lookup.editValue' : 'lookup.addValue') | translate"
        [content]="formTpl"
        [headerExtra]="valueStepsTpl"
        [footer]="valueFooterTpl"
        density="compact"
        [dirty]="valueDirty()"
      />

      <!-- Override label. Two fields, through am-field like every other dialog
           form — it was a hand-rolled label + input pair with its own spacing. -->
      <!-- ACC-120 — A REACTIVE FORM, converted from [(ngModel)] on a plain
           object. It was the ONE dialog form in the application that was not
           reactive, and the consequence was not stylistic: am-field's showError
           bails on a missing control BEFORE forceShowErrors is consulted, so
           these two fields were structurally incapable of showing a validation
           error. They passed through the slice-6 migration looking migrated.
           Their only feedback was a disabled Save.

           It is also what lets am-field read FormGroupDirective.submitted,
           which is how every other form now reveals its errors without the
           caller passing anything. -->
      <ng-template #overrideFormTpl>
        <form [formGroup]="overrideForm" (ngSubmit)="onSaveOverride()" class="flex flex-col">
          <am-field
            [label]="'lookup.labelEn' | translate"
            [control]="overrideForm.controls.labelEn"
            inputId="override-label-en"
            [errorMessages]="overrideErrors()"
          >
            <input
              pInputText
              id="override-label-en"
              class="w-full"
              formControlName="labelEn"
            />
          </am-field>
          <am-field
            [label]="'lookup.labelAr' | translate"
            [control]="overrideForm.controls.labelAr"
            inputId="override-label-ar"
            [errorMessages]="overrideErrors()"
          >
            <input
              pInputText
              id="override-label-ar"
              dir="rtl"
              class="w-full"
              formControlName="labelAr"
            />
          </am-field>
          @if (overrideError()) {
            <p class="text-sm text-red-500">{{ overrideError() }}</p>
          }
        </form>
      </ng-template>
      <ng-template #overrideFooterTpl>
        <div class="flex justify-end gap-2">
          <p-button
            [label]="'common.cancel' | translate"
            severity="secondary"
            [text]="true"
            type="button"
            (onClick)="overrideDialog.requestClose()"
            [disabled]="overrideSaving()"
          />
          <p-button
            [label]="'common.save' | translate"
            [loading]="overrideSaving()"
            [disabled]="overrideSaving()"
            (onClick)="onSaveOverride()"
          />
        </div>
      </ng-template>
      <app-edit-dialog
        #overrideDialog
        [(visible)]="showOverrideDialog"
        [header]="'lookup.overrideLabelTitle' | translate"
        [context]="overridingValue() ? effectiveLabel(overridingValue()!) : ''"
        [content]="overrideFormTpl"
        [footer]="overrideFooterTpl"
      />
    </div>
  `,
})
export class LookupValueListComponent implements OnInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;
  @ViewChild('overrideFormTpl', { read: TemplateRef, static: true })
  overrideFormTpl!: TemplateRef<unknown>;

  private readonly lookupService = inject(LookupService);
  private readonly route = inject(ActivatedRoute);
  private readonly languageService = inject(LanguageService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly translate = inject(TranslateService);
  private readonly fb = inject(FormBuilder);

  readonly list = viewChild.required<DataListComponent<LookupValueDto>>('list');

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it. POST /lookups/categories/:key/values enforces
  // lookups:manage; there is no lookups:create string at all.
  readonly canCreate = computed(() => this.navigationAccess.hasPermission('lookups:manage'));
  // ACC-123 — the same permission, asked about changing an existing value.
  readonly canManage = this.canCreate;

  categoryKey = '';

  readonly category = signal<LookupCategoryDto | null>(null);
  /** null means NOT LOADED — distinct from loaded-and-empty. */
  readonly values = signal<readonly LookupValueDto[] | null>(null);
  readonly error = signal<string | null>(null);

  readonly showFormDialog = signal(false);
  readonly editingValue = signal<LookupValueDto | null>(null);
  readonly valueFormRef = signal<LookupValueFormComponent | null>(null);
  // A SIGNAL fed by the form's own output. A computed() over form.dirty never
  // re-evaluates — form.dirty is a plain property — and the unsaved-work prompt
  // then never fires, which is what the first wiring did.
  readonly valueDirty = signal(false);

  readonly showOverrideDialog = signal(false);
  readonly overridingValue = signal<LookupValueDto | null>(null);
  readonly overrideSaving = signal(false);
  readonly overrideError = signal<string | null>(null);
  /**
   * Reactive, and Save is NO LONGER DISABLED on an empty field. A disabled
   * button was this dialog's only feedback and it could not say why; now an
   * empty field says so itself, which is the whole point of the conversion.
   */
  readonly overrideForm = this.fb.group({
    labelEn: ['', [Validators.required, Validators.maxLength(255)]],
    labelAr: ['', [Validators.required, Validators.maxLength(255)]],
  });

  readonly overrideErrors = computed(() => {
    this.translate.currentLang();
    return {
      required: this.translate.instant('validation.required'),
      maxlength: this.translate.instant('validation.maxLength255'),
    };
  });

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    return [
      {
        key: 'label',
        label: this.translate.instant('lookup.valueColumnLabel'),
        sortBy: 'label',
        alwaysVisible: true,
        width: 'minmax(200px, 1.8fr)',
      },
      {
        key: 'key',
        label: this.translate.instant('lookup.valueColumnKey'),
        sortBy: 'key',
        width: 'minmax(160px, 1.2fr)',
      },
      {
        key: 'layer',
        label: this.translate.instant('lookup.valueColumnLayer'),
        sortBy: 'layer',
        width: '120px',
      },
      {
        key: 'status',
        label: this.translate.instant('lookup.valueColumnStatus'),
        width: '120px',
      },
    ];
  });

  readonly trackById = (value: LookupValueDto): string => value.id;

  private readonly slice: DataListSource<LookupValueDto> = clientSideSource(() => this.values() ?? [], {
    // Overrides are searched as well as the originals: the override is what is
    // ON SCREEN, and the original is what an admin may remember the value by.
    searchFields: (v) => [v.labelEn, v.labelAr, v.labelOverrideEn, v.labelOverrideAr, v.key],
    comparators: {
      // Sorts by what the reader sees, override and language included.
      label: (a, b) => this.effectiveLabel(a).localeCompare(this.effectiveLabel(b)),
      key: (a, b) => a.key.localeCompare(b.key),
      layer: (a, b) => a.layer.localeCompare(b.layer),
    },
  });

  /**
   * ACC-120 slice 6 — THE SOURCE FETCHES, and that is a fix rather than a
   * preference. `clientSideSource()` resolves SYNCHRONOUSLY, so on first render
   * it returned 0 rows from a cache that had not loaded. The list went straight
   * to `status: 'rows'` with nothing in it and drew the genuinely-empty state
   * for the ~2 seconds before the request came back. Its skeleton never got a
   * chance, because nothing was ever pending.
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
  readonly source: DataListSource<LookupValueDto> = (query) => {
    const cached = this.values();
    const items$ = cached
      ? of(cached)
      : this.lookupService.getValues(this.categoryKey).pipe(tap((rows) => this.values.set(rows)));
    return items$.pipe(switchMap(() => this.slice(query)));
  };

  // NO LOAD HERE. The list fetches through `source` on its own first query —
  // calling a loader as well would fire two requests and, worse, would put rows
  // in the cache before the list ever asked, so its skeleton would again never
  // show. The loaders exist for AFTER a mutation.
  ngOnInit(): void {
    this.categoryKey = this.route.snapshot.paramMap.get('key') ?? '';
    this.loadCategory();
  }

  displayLabel(cat: LookupCategoryDto): string {
    return this.languageService.isArabic() ? cat.labelAr || cat.labelEn : cat.labelEn;
  }

  effectiveLabel(val: LookupValueDto): string {
    return this.languageService.bilingual(val.labelOverrideEn || val.labelEn, val.labelOverrideAr || val.labelAr);
  }

  statusLabel(val: LookupValueDto): string {
    if (val.isHidden) return 'lookup.statusHidden';
    return val.isActive ? 'common.active' : 'common.inactive';
  }

  statusSeverity(val: LookupValueDto): 'success' | 'warn' | 'secondary' {
    if (val.isHidden) return 'warn';
    return val.isActive ? 'success' : 'secondary';
  }

  openAdd(): void {
    this.valueFormRef.set(null);
    this.valueDirty.set(false);
    this.editingValue.set(null);
    this.showFormDialog.set(true);
  }

  openEdit(val: LookupValueDto): void {
    this.valueFormRef.set(null);
    this.valueDirty.set(false);
    this.editingValue.set(val);
    this.showFormDialog.set(true);
  }

  openOverride(val: LookupValueDto): void {
    this.overridingValue.set(val);
    this.overrideForm.reset({
      labelEn: val.labelOverrideEn ?? val.labelEn,
      labelAr: val.labelOverrideAr ?? val.labelAr,
    });
    this.overrideError.set(null);
    this.showOverrideDialog.set(true);
  }

  onSaved(): void {
    this.showFormDialog.set(false);
    this.loadValues();
  }

  onHide(val: LookupValueDto): void {
    this.lookupService.hideSystemValue(val.id).subscribe({
      next: () => this.loadValues(),
      error: (err: unknown) =>
        this.error.set(extractErrorMessage(err, this.translate.instant('lookup.errorHide'))),
    });
  }

  onUnhide(val: LookupValueDto): void {
    this.lookupService.unhideSystemValue(val.id).subscribe({
      next: () => this.loadValues(),
      error: (err: unknown) =>
        this.error.set(extractErrorMessage(err, this.translate.instant('lookup.errorUnhide'))),
    });
  }

  /**
   * ACC-120 — ASKS FIRST. It did not: the trash called removeValue() straight
   * away, with a TODO beside it saying a confirm belonged there. A tenant
   * lookup value is referenced by records, so the message names the value
   * rather than asking an abstract "are you sure".
   */
  onDelete(val: LookupValueDto): void {
    this.confirmationService.confirm({
      header: this.translate.instant('common.confirm'),
      message: this.translate.instant('lookup.deleteConfirm', { name: this.effectiveLabel(val) }),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.lookupService.removeValue(val.id).subscribe({
          next: () => this.loadValues(),
          error: (err: unknown) =>
            this.error.set(extractErrorMessage(err, this.translate.instant('lookup.errorDelete'))),
        });
      },
    });
  }

  onSaveOverride(): void {
    const val = this.overridingValue();
    if (!val) return;
    // No reveal call here: the field wrapper reads the form's own submitted
    // state, and this form submits.
    if (this.overrideForm.invalid) return;
    this.overrideSaving.set(true);
    this.overrideError.set(null);
    this.lookupService
      .overrideLabel(val.id, {
        labelOverrideEn: this.overrideForm.controls.labelEn.value ?? '',
        labelOverrideAr: this.overrideForm.controls.labelAr.value ?? '',
      })
      .subscribe({
        next: () => {
          this.overrideSaving.set(false);
          this.showOverrideDialog.set(false);
          this.loadValues();
        },
        error: (err: unknown) => {
          this.overrideError.set(
            extractErrorMessage(err, this.translate.instant('lookup.errorOverride')),
          );
          this.overrideSaving.set(false);
        },
      });
  }

  private loadCategory(): void {
    this.lookupService.getCategoryByKey(this.categoryKey).subscribe({
      next: (cat) => this.category.set(cat),
      error: () => this.error.set(this.translate.instant('lookup.errorLoad')),
    });
  }

  private loadValues(): void {
    // Invalidate, then let the LIST refetch through `source`. Doing the request
    // here instead would put the rows in the cache without the list ever
    // entering a pending state — which is the defect this replaced.
    this.values.set(null);
    this.list().reload();
  }
}
