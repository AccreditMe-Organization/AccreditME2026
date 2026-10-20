import { Component, DestroyRef, ElementRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import {
  OrgUnitService,
  OrgUnitDto,
  UpdateOrgUnitDto,
  buildOrgUnitParentOptions,
  countDescendants,
} from '../../services/org-unit.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
// ACC-149 - the unit's type is an org_unit_type lookup value (ACC-137). Read
// through LookupService rather than a local map: ACC-137's read-path contract is
// that a label is labelOverride ?? label, and a client-side translation table is
// exactly what shows a tenant the wrong word.
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { LanguageService } from '../../../../core/services/language.service';
import { FormatService } from '../../../../core/formatting';
// ACC-42 Phase 6 — OverlaySelectComponent in hierarchy mode for the parent.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { SHELL_PHONE_BELOW_PX } from '../../../../layout/app-shell/app-shell.component';

/**
 * The server's code rule, copied CHARACTER FOR CHARACTER from
 * create-org-unit.dto.ts (`@MaxLength(10)`, `@Matches(/^[A-Z0-9-]+$/)`), so the
 * form and the API agree on every code. ACC-120 slice 11: the form used to allow
 * 20 characters and an underscore, both of which the server refused with a 400.
 */
export const ORG_UNIT_CODE_MAX = 10;
export const ORG_UNIT_CODE_PATTERN = /^[A-Z0-9-]+$/;
export const ORG_UNIT_DESCRIPTION_MAX = 1000;
/** The description counter turns amber from here (OS L633). */
export const ORG_UNIT_DESCRIPTION_WARN = 900;

/**
 * Add / Edit unit (ACC-120 slice 11, OS L377-394, L631-638).
 *
 * One form for three entry points: Add unit (no parent chosen yet), Add sub-unit
 * (the parent prefilled and changeable) and Edit. The host owns the dialog shell
 * and its footer; this form tells it what it needs through `ready` (itself) and
 * `dirtyChange`, as position-form does.
 *
 * Six fields in four rows, no steps: two name fields side by side, code beside
 * type, the parent, the description. Compact density, declared by the host:
 * artboard 13 makes a dialog compact from five field blocks, and the drawing's
 * "four blocks, standard density" counted rows (check:dialog-density counts
 * fields). org-unit-form.layout.spec measures the body in both languages at
 * 1280 and on a phone, against the 420 cap with 10px spare.
 *
 * Left out on purpose:
 * - sortOrder. A number field would ask the reader to know where every sibling
 *   sits; ordering arrives with ACC-138 (append on create, Move up / down).
 *   Until then a new unit sorts by name, and the dialog promises nothing about
 *   "last".
 * - the locked-code state as a tested state. Nothing sets isCodeLocked today
 *   (OS L634), so it renders read-only if it ever is set, and nothing tests it.
 */
@Component({
  selector: 'app-org-unit-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    NgTemplateOutlet,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    OverlaySelectComponent,
    FieldComponent,
  ],
  template: `
    @if (loadError()) {
      <p class="am-ouf__error" role="alert">{{ loadError() | translate }}</p>
    }

    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="am-ouf" novalidate>
      <!-- A name in two languages, as one pair. In the Arabic interface the
           Arabic field comes first: rendered first, so the Tab order matches. -->
      <div class="am-ouf__pair" data-testid="org-unit-names">
        @if (isArabic()) {
          <ng-container *ngTemplateOutlet="nameArTpl" />
          <ng-container *ngTemplateOutlet="nameEnTpl" />
        } @else {
          <ng-container *ngTemplateOutlet="nameEnTpl" />
          <ng-container *ngTemplateOutlet="nameArTpl" />
        }
      </div>

      <div class="am-ouf__pair">
        @if (codeLocked()) {
          <am-field
            [label]="'organization.codeShort' | translate"
            [readonly]="true"
            [readonlyText]="form.controls.code.value ?? ''"
            [hint]="'organization.codeLockedHint' | translate"
          ></am-field>
        } @else {
          <am-field
            [label]="'organization.codeShort' | translate"
            [control]="form.controls.code"
            inputId="org-unit-code"
            [hint]="'organization.codeHint' | translate"
            [counter]="{ value: codeLength(), max: codeMax }"
            [hintVisuallyHidden]="phone()"
            [forceShowErrors]="showErrors() || codeRuleBroken()"
            [errorMessages]="codeErrors"
          >
            <!-- No native maxlength: it would drop an 11th character without a
                 word. The character goes in and the rule shows at once. -->
            <input
              pInputText
              id="org-unit-code"
              class="w-full am-ouf__code"
              [class.am-ouf__code--rtl]="isArabic()"
              dir="ltr"
              formControlName="code"
              autocomplete="off"
              (input)="onCodeInput($event)"
            />
          </am-field>
        }

        <!-- ACC-141 rule 2: the root's type is system-set, so it is shown, not
             offered. -->
        @if (isRootUnit()) {
          <am-field
            [label]="'organization.unitType' | translate"
            [readonly]="true"
            [readonlyText]="rootTypeLabel()"
            [hint]="'organization.rootTypeFixed' | translate"
          ></am-field>
        } @else {
          <am-field
            [label]="'organization.unitType' | translate"
            [control]="form.controls.typeValueId"
            inputId="org-unit-type"
            [loading]="typesLoading()"
            [hint]="typeHint()"
            [forceShowErrors]="showErrors()"
          >
            @if (typesError()) {
              <!-- A retry that re-requests ONLY this list; everything already
                   typed survives. -->
              <div class="am-ouf__inline-error">
                <span>{{ typesError() }}</span>
                <p-button size="small" severity="secondary" [text]="true" [label]="'common.retry' | translate" (onClick)="retryTypes()" />
              </div>
            } @else {
              <app-overlay-select
                formControlName="typeValueId"
                [options]="typeOptions()"
                optionLabel="label"
                optionValue="value"
                [ariaLabel]="'organization.unitType' | translate"
                [placeholder]="'organization.unitTypePlaceholder' | translate"
              />
            }
          </am-field>
        }
      </div>

      @if (isRootUnit()) {
        <am-field
          [label]="'organization.parentUnit' | translate"
          [readonly]="true"
          [readonlyText]="'organization.parentRootText' | translate"
        ></am-field>
      } @else {
        <am-field
          [label]="'organization.parentUnit' | translate"
          [control]="form.controls.parentId"
          inputId="org-unit-parent"
          [loading]="unitsLoading()"
          [hint]="parentHint()"
          [forceShowErrors]="showErrors()"
        >
          <app-overlay-select
            formControlName="parentId"
            [options]="parentOptions()"
            optionLabel="label"
            optionValue="value"
            optionGroupLabel="label"
            optionGroupChildren="items"
            optionDisabled="unavailable"
            optionDisabledReason="unavailableReason"
            [ariaLabel]="'organization.parentUnit' | translate"
            [placeholder]="'organization.parentPlaceholder' | translate"
          />
        </am-field>
      }

      <am-field
        [label]="'organization.descriptionOptional' | translate"
        [control]="form.controls.description"
        inputId="org-unit-description"
        [counter]="{ value: descriptionLength(), max: descriptionMax, warnFrom: descriptionWarn }"
        [forceShowErrors]="showErrors()"
      >
        <textarea
          pTextarea
          id="org-unit-description"
          class="w-full am-ouf__description"
          formControlName="description"
          rows="2"
          [attr.maxlength]="descriptionMax"
          [placeholder]="'organization.descriptionPlaceholder' | translate"
        ></textarea>
      </am-field>

      @if (saveError()) {
        <p class="am-ouf__error" role="alert" data-testid="org-unit-save-error">{{ saveError() }}</p>
      }
    </form>

    <!-- Declared outside <form>, so these bind [formControl] directly: an
         ng-template resolves directives where it is DECLARED, and
         formControlName would find no parent group here. -->
    <ng-template #nameEnTpl>
      <am-field
        [label]="'organization.nameEnShort' | translate"
        [control]="form.controls.nameEn"
        inputId="org-unit-name-en"
        [forceShowErrors]="showErrors()"
      >
        <input pInputText id="org-unit-name-en" class="w-full" dir="ltr" [formControl]="form.controls.nameEn" (input)="onNameEnInput()" />
      </am-field>
    </ng-template>
    <ng-template #nameArTpl>
      <am-field
        [label]="'organization.nameArShort' | translate"
        [control]="form.controls.nameAr"
        inputId="org-unit-name-ar"
        [forceShowErrors]="showErrors()"
      >
        <input pInputText id="org-unit-name-ar" class="w-full am-ouf__arabic" dir="rtl" [formControl]="form.controls.nameAr" />
      </am-field>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .am-ouf {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-12);
      }
      /* Two fields side by side, 50/50 (OS L381-388). */
      .am-ouf__pair {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: var(--am-space-12);
      }
      .am-ouf__code {
        font-family: var(--am-font-mono);
        text-transform: uppercase;
      }
      /* The code reads left to right inside a right-to-left field, so its text
         starts where am-field draws the error's "!" (the field's inline end,
         the left). Room is kept there, or the glyph covers the first letter. */
      .am-ouf__code--rtl {
        padding-left: calc(var(--am-space-8) + 1.25em);
      }
      .am-ouf__description {
        resize: vertical;
      }
      .am-ouf__inline-error {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        font-size: var(--am-type-body-size);
        color: var(--am-danger-ink);
      }
      .am-ouf__error {
        margin: 0;
        font-size: var(--am-type-body-size);
        color: var(--am-danger-ink);
      }
    `,
  ],
})
export class OrgUnitFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly lookupService = inject(LookupService);
  private readonly languageService = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // null = add mode, set = edit mode.
  readonly unit = input<OrgUnitDto | null>(null);
  // Add mode only: the parent chosen by the entry point ("Add sub-unit").
  readonly parentId = input<string | null>(null);

  readonly saved = output<void>();
  readonly cancelled = output<void>();
  /** The host's footer drives the form through this reference. */
  readonly ready = output<OrgUnitFormComponent>();
  readonly dirtyChange = output<boolean>();

  readonly codeMax = ORG_UNIT_CODE_MAX;
  readonly descriptionMax = ORG_UNIT_DESCRIPTION_MAX;
  readonly descriptionWarn = ORG_UNIT_DESCRIPTION_WARN;
  readonly codeErrors = {
    pattern: 'organization.codePatternError',
    maxlength: 'organization.codeTooLong',
  };

  readonly codeLocked = signal(false);
  /**
   * A character the server refuses was typed. The rule shows as the error at
   * once, not on leaving the field: on a phone the hint is not drawn (ACC-120
   * slice 11), so this is the moment the reader learns it.
   */
  readonly codeRuleBroken = signal(false);
  /**
   * The phone layout (the shell's breakpoint, SHELL_PHONE_BELOW_PX): the Code
   * helper beside its counter wraps in a half-width column and pushes the
   * Arabic body over the 420 cap, so it is read but not drawn.
   */
  readonly phone = signal(false);
  readonly codeManuallyEdited = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  /** Set by a Save attempt on an invalid form, so every field says what's missing. */
  readonly showErrors = signal(false);

  private readonly flatUnits = signal<OrgUnitDto[]>([]);
  /**
   * The units the parent picker lists are still on their way. Without this an
   * Edit opened on a slow connection showed the placeholder instead of the
   * current parent, and the picker said "No results found".
   */
  readonly unitsLoading = signal(true);
  private readonly typeValues = signal<LookupValueDto[]>([]);
  readonly typesLoading = signal(true);
  readonly typesError = signal<string | null>(null);

  readonly isArabic = computed(() => this.languageService.isArabic());
  readonly isEdit = computed(() => this.unit() !== null);

  /** Editing the organisation's own root unit (ACC-141): no parent, fixed type. */
  readonly isRootUnit = computed(() => {
    const unit = this.unit();
    return unit != null && unit.parentId === null;
  });

  readonly rootTypeLabel = computed(() => {
    const held = this.unit()?.typeValue ?? null;
    if (!held) return '';
    return this.languageService.bilingual(held.labelEn, held.labelAr);
  });

  readonly form = this.fb.group({
    nameEn: ['', [Validators.required, Validators.maxLength(255)]],
    nameAr: ['', Validators.maxLength(255)],
    code: [
      '',
      [Validators.required, Validators.maxLength(ORG_UNIT_CODE_MAX), Validators.pattern(ORG_UNIT_CODE_PATTERN)],
    ],
    // Required: a tenant has exactly one root (ACC-134), so every other unit has
    // a parent, and Add unit from the header starts with none chosen (OS L635).
    // The root's control is disabled instead (see ngOnInit).
    parentId: [null as string | null, [Validators.required]],
    // ACC-149 - required, matching the API, on edit too.
    typeValueId: [null as string | null, [Validators.required]],
    description: ['', Validators.maxLength(ORG_UNIT_DESCRIPTION_MAX)],
  });

  private readonly codeValue = toSignal(this.form.controls.code.valueChanges, { initialValue: '' });
  private readonly descriptionValue = toSignal(this.form.controls.description.valueChanges, { initialValue: '' });
  private readonly parentValue = toSignal(this.form.controls.parentId.valueChanges, { initialValue: null });

  readonly codeLength = computed(() => (this.codeValue() ?? this.form.controls.code.value ?? '').length);
  readonly descriptionLength = computed(
    () => (this.descriptionValue() ?? this.form.controls.description.value ?? '').length,
  );

  /**
   * The selectable types, plus whatever the unit already holds (ACC-137): a
   * retired value the unit holds is shown, marked, so saving can't change it
   * silently. `organization` is never offered (ACC-141).
   */
  readonly typeOptions = computed(() => {
    const options = this.typeValues()
      .filter((v) => v.key !== 'organization')
      .map((v) => ({ label: this.labelFor(v), value: v.id }));
    const held = this.unit()?.typeValue ?? null;
    if (held && held.key !== 'organization' && !options.some((o) => o.value === held.id)) {
      options.push({
        // ACC-160 — through bilingual(), never a bare ternary.
        label: `${this.languageService.bilingual(held.labelEn, held.labelAr)} (${this.translate.instant('organization.typeRetired')})`,
        value: held.id,
      });
    }
    return options;
  });

  /** The held type's retired note, or the empty states' cause. */
  readonly typeHint = computed(() => {
    if (!this.typesLoading() && !this.typesError() && this.typeOptions().length === 0) {
      return this.translate.instant('organization.typesEmpty');
    }
    return '';
  });

  /** The whole active tree, with this unit and its descendants greyed (OS L637). */
  readonly parentOptions = computed(() =>
    buildOrgUnitParentOptions(
      this.flatUnits(),
      this.unit()?.id ?? null,
      (u) => this.languageService.bilingual(u.nameEn, u.nameAr),
      {
        self: this.translate.instant('organization.parentUnavailableSelf'),
        descendant: this.translate.instant('organization.parentUnavailableDescendant'),
      },
    ),
  );

  /**
   * "Moves Pharmacy and its 3 sub-units" — only in Edit, only once the parent
   * has changed (OS L635). Counts every unit below this one, because a move
   * takes all of them.
   */
  readonly parentHint = computed(() => {
    const unit = this.unit();
    if (!unit) return '';
    const chosen = this.parentValue() ?? this.form.controls.parentId.value;
    if (chosen === unit.parentId || chosen === null) {
      return this.translate.instant('organization.parentHintEdit');
    }
    const name = this.languageService.bilingual(unit.nameEn, unit.nameAr);
    const below = countDescendants(this.flatUnits(), unit.id);
    return below === 0
      ? this.translate.instant('organization.movesAlone', { unit: name })
      : this.format.count('orgUnit.movesWith', below, { unit: name });
  });

  /** The footer's primary button. */
  readonly submitLabelKey = computed(() => {
    if (this.isEdit()) return 'common.save';
    return this.parentId() ? 'organization.addSubUnit' : 'organization.addUnit';
  });

  constructor() {
    const media = inject(DOCUMENT).defaultView?.matchMedia?.(`(max-width: ${SHELL_PHONE_BELOW_PX - 0.02}px)`);
    if (media) {
      this.phone.set(media.matches);
      const onChange = (e: MediaQueryListEvent): void => this.phone.set(e.matches);
      media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
    }
  }

  ngOnInit(): void {
    this.orgUnitService.getFlat().subscribe({
      next: (units) => {
        this.flatUnits.set(units);
        this.unitsLoading.set(false);
      },
      error: () => {
        this.loadError.set('organization.loadUnitsFailed');
        this.unitsLoading.set(false);
      },
    });

    this.loadTypes();

    const unit = this.unit();
    if (unit) {
      if (unit.isCodeLocked) {
        this.codeLocked.set(true);
        this.form.controls.code.disable();
      }
      this.codeManuallyEdited.set(true);

      if (unit.parentId === null) {
        // ACC-141 / ACC-134 - the root has no parent and a fixed type. Disabled,
        // not removed: getRawValue() still sends the unchanged values, and the
        // validators can no longer block a save on fields nobody may change.
        this.form.controls.typeValueId.disable();
        this.form.controls.parentId.disable();
      }

      this.form.patchValue({
        nameEn: unit.nameEn,
        nameAr: unit.nameAr ?? '',
        code: unit.code,
        parentId: unit.parentId,
        typeValueId: unit.typeValueId,
        description: unit.description ?? '',
      });
    } else if (this.parentId()) {
      this.form.patchValue({ parentId: this.parentId() });
    }
    this.form.markAsPristine();

    this.ready.emit(this);
    this.form.valueChanges.subscribe(() => this.dirtyChange.emit(this.form.dirty));
  }

  /** While the code hasn't been typed by hand, it follows the English name. */
  onNameEnInput(): void {
    if (this.codeManuallyEdited()) return;
    const raw = (this.form.controls.nameEn.value ?? '') as string;
    const code = raw
      .toUpperCase()
      .replace(/\s+/g, '-')
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, ORG_UNIT_CODE_MAX);
    this.form.controls.code.setValue(code);
  }

  /**
   * Auto-uppercase as you type (OS L634), keeping the caret where it was. Only
   * the case changes: an underscore, an 11th character or anything else the
   * server refuses is left in place, and the rule shows as the error at once,
   * rather than the character vanishing without a word.
   */
  onCodeInput(event: Event): void {
    this.codeManuallyEdited.set(true);
    const el = event.target as HTMLInputElement;
    const upper = el.value.toUpperCase();
    if (upper !== el.value) {
      const caret = el.selectionStart;
      el.value = upper;
      if (caret !== null) el.setSelectionRange(caret, caret);
    }
    this.form.controls.code.setValue(upper, { emitEvent: true });
    const errors = this.form.controls.code.errors;
    if (errors?.['pattern'] || errors?.['maxlength']) this.codeRuleBroken.set(true);
  }

  private loadTypes(): void {
    this.typesLoading.set(true);
    this.typesError.set(null);
    this.lookupService.getValues('org_unit_type').subscribe({
      next: (values) => {
        this.typeValues.set(values);
        this.typesLoading.set(false);
      },
      error: (err: unknown) => {
        this.typesError.set(extractErrorMessage(err, this.translate.instant('organization.typeLoadFailed')));
        this.typesLoading.set(false);
      },
    });
  }

  retryTypes(): void {
    this.loadTypes();
  }

  /** labelOverride ?? label, in the reader's language (ACC-137). */
  private labelFor(value: LookupValueDto): string {
    return this.languageService.bilingual(value.labelOverrideEn ?? value.labelEn, value.labelOverrideAr ?? value.labelAr);
  }

  onSubmit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.form.markAllAsTouched();
      // Focus the first field that needs attention, in reading order.
      queueMicrotask(() =>
        this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"], .ng-invalid input, .ng-invalid textarea')?.focus(),
      );
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);

    const id = this.unit()?.id ?? null;
    const value = this.form.getRawValue();

    // sortOrder is not sent: create keeps the server's default, and update
    // leaves the stored order alone (ACC-138 owns ordering).
    const payload = {
      nameEn: value.nameEn!,
      nameAr: value.nameAr || undefined,
      code: value.code!,
      parentId: value.parentId ?? undefined,
      typeValueId: value.typeValueId!,
      description: value.description || undefined,
    };

    const request$ = id
      ? this.orgUnitService.update(id, payload as UpdateOrgUnitDto)
      : this.orgUnitService.create(payload);

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.saveError.set(this.refusalText(err));
        this.saving.set(false);
      },
    });
  }

  /** A coded refusal in the reader's language; anything else as the server says it. */
  private refusalText(err: unknown): string {
    const code = (err as { error?: { code?: string } } | null)?.error?.code;
    if (code === 'ORG_UNIT_PARENT_CYCLE') return this.translate.instant('organization.refusal.parentCycle');
    return extractErrorMessage(err, this.translate.instant('organization.saveFailed'));
  }
}
