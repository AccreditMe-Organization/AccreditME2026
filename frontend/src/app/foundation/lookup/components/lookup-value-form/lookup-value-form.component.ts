import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CheckboxModule } from 'primeng/checkbox';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import {
  LookupService,
  LookupValueDto,
  CreateLookupValueDto,
  UpdateLookupValueDto,
} from '../../services/lookup.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

@Component({
  selector: 'app-lookup-value-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    CheckboxModule,
    FieldComponent,
  ],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col">
      @if (step() === 1) {

      <!-- ACC-120 slice 6 — am-field, not a hand-rolled label + input pair.
           The required marker is DERIVED from the control's own validators
           (probeRequired), so the asterisks are gone from the template: a
           hand-written one drifts from the validator the day the validator
           changes, and on this form the key field's own asterisk was already
           conditional on create-vs-edit in one place and not the other. -->
      <am-field
        [label]="'lookup.fieldKey' | translate"
        [control]="form.controls.key"
        inputId="key"
        [hint]="value ? '' : ('lookup.fieldKeyHint' | translate)"
      >
        <input id="key" pInputText class="w-full" formControlName="key" />
      </am-field>

      <am-field
        [label]="'lookup.fieldLabelEn' | translate"
        [control]="form.controls.labelEn"
        inputId="labelEn"
      >
        <input id="labelEn" pInputText class="w-full" formControlName="labelEn" />
      </am-field>

      <am-field
        [label]="'lookup.fieldLabelAr' | translate"
        [control]="form.controls.labelAr"
        inputId="labelAr"
      >
        <input id="labelAr" pInputText dir="rtl" class="w-full" formControlName="labelAr" />
      </am-field>

      <am-field
        [label]="'lookup.fieldSortOrder' | translate"
        [control]="form.controls.sortOrder"
        inputId="sortOrder"
      >
        <input id="sortOrder" pInputText type="number" class="w-full" formControlName="sortOrder" />
      </am-field>

      @if (value) {
        <div class="flex items-center gap-3 pb-2">
          <p-checkbox formControlName="isActive" [binary]="true" inputId="isActive" />
          <label for="isActive" class="text-sm cursor-pointer">
            {{ 'common.active' | translate }}
          </label>
        </div>
      }

      @if (categoryLoading()) {
        <p class="text-sm text-[var(--am-text-secondary)]">{{ 'common.loading' | translate }}</p>
      }
      }

      @if (step() === 2) {
        <div [formGroup]="attributeGroup" class="flex flex-col">
          @for (field of attributeFields(); track field.key) {
            <div class="flex flex-col gap-1">
              @if (field.type === 'boolean') {
                <div class="flex items-center gap-3">
                  <p-checkbox
                    [binary]="true"
                    [formControlName]="field.key"
                    [inputId]="'attr_' + field.key"
                  />
                  <label [for]="'attr_' + field.key" class="font-medium text-sm cursor-pointer">
                    {{ field.label }}
                  </label>
                </div>
              } @else if (field.type === 'number') {
                <!-- The attribute schema's own label, which is tenant data and
                     so is NOT translated — same rule as a workflow transition's
                     label (CLAUDE.md, ACC-22). -->
                <am-field [label]="field.label" [inputId]="'attr_' + field.key">
                  <input
                    [id]="'attr_' + field.key"
                    pInputText
                    type="number"
                    class="w-full"
                    [formControlName]="field.key"
                  />
                </am-field>
              } @else {
                <am-field [label]="field.label" [inputId]="'attr_' + field.key">
                  <input
                    [id]="'attr_' + field.key"
                    pInputText
                    class="w-full"
                    [formControlName]="field.key"
                  />
                </am-field>
              }
            </div>
          }
        </div>
      }

      @if (saveError()) {
        <p class="text-red-500 text-sm">{{ saveError() }}</p>
      }
    </form>
  `,
})
export class LookupValueFormComponent implements OnInit {
  @Input() categoryKey = '';
  @Input() value: LookupValueDto | null = null;
  @Output() saved = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  private readonly lookupService = inject(LookupService);
  private readonly fb = inject(FormBuilder);
  private readonly translate = inject(TranslateService);

  /**
   * ACC-120 slice 6 — STEPPED, and only when the category gives it something to
   * put on a second step.
   *
   * Measured rather than chosen: with the field wrapper the four core fields
   * reached EXACTLY the 420px body cap and scrolled. And the field count is not
   * fixed — it is the category's own attribute schema, so `document_type` adds
   * five more. Nine field blocks cannot be made to fit by compacting them.
   *
   * The seam is editorial, as ACC-111 requires rather than arithmetic: step 1
   * is the VALUE — what it is called and where it sorts — and step 2 is what
   * this category happens to record ABOUT a value. A category with no attribute
   * schema has no step 2 at all: no strip, no Next, exactly the form it was.
   */
  readonly step = signal(1);
  readonly ready = output<LookupValueFormComponent>();

  /**
   * The host holds this in a SIGNAL and passes it to the dialog's [dirty].
   *
   * It is an output rather than the host reading `form.dirty` directly, because
   * `form.dirty` is a plain property: a computed() over it never re-evaluates,
   * so the unsaved-work prompt silently never fires. Measured in a browser —
   * the first wiring here did exactly that, and a dirty form closed without
   * asking. Same shape as invite-user and manage-roles for the same reason.
   */
  readonly dirtyChange = output<boolean>();

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly categoryLoading = signal(false);
  readonly attributeFields = signal<Array<{ key: string; type: string; label: string }>>([]);

  readonly hasAttributes = computed(() => this.attributeFields().length > 0);

  /** The strip renders only when there is more than one step to show. */
  readonly steps = computed(() =>
    this.hasAttributes()
      ? [
          { n: 1, key: 'lookup.stepValue' },
          { n: 2, key: 'lookup.stepAttributes' },
        ]
      : [],
  );

  readonly canAdvance = computed(() => this.hasAttributes() && this.step() === 1);
  readonly canGoBack = computed(() => this.step() === 2);
  /** Save is offered on the last step only, so Next and Save never compete. */
  readonly canSubmit = computed(() => !this.canAdvance());

  next(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.step.set(2);
  }

  back(): void {
    this.step.set(1);
  }

  readonly form = this.fb.group({
    key:       ['', [Validators.required, Validators.maxLength(100), Validators.pattern(/^[a-z0-9_]+$/)]],
    labelEn:   ['', [Validators.required, Validators.maxLength(255)]],
    labelAr:   ['', [Validators.required, Validators.maxLength(255)]],
    sortOrder: [0 as number | null],
    isActive:  [true],
  });

  // Rebuilt dynamically from JSON Schema properties — must remain untyped
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributeGroup: FormGroup = this.fb.group({} as Record<string, any>);

  ngOnInit(): void {
    this.ready.emit(this);
    this.form.valueChanges.subscribe(() => this.dirtyChange.emit(this.form.dirty));
    this.attributeGroup.valueChanges.subscribe(() => this.dirtyChange.emit(true));
    if (this.value) {
      this.form.get('key')?.disable();
      this.form.patchValue({
        key:       this.value.key,
        labelEn:   this.value.labelEn,
        labelAr:   this.value.labelAr,
        sortOrder: this.value.sortOrder,
        isActive:  this.value.isActive,
      });
    }
    this.loadCategory();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      // A validation failure lives on step 1, so go back to it rather than
      // disabling Save on a step that shows nothing wrong.
      this.step.set(1);
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);

    const raw = this.form.getRawValue();
    const attrs: Record<string, unknown> | undefined =
      this.attributeFields().length > 0
        ? (this.attributeGroup.value as Record<string, unknown>)
        : undefined;

    const request$ = this.value
      ? this.lookupService.updateValue(this.value.id, {
          labelEn:    raw.labelEn   ?? undefined,
          labelAr:    raw.labelAr   ?? undefined,
          isActive:   raw.isActive  ?? undefined,
          ...(raw.sortOrder !== null ? { sortOrder: raw.sortOrder } : {}),
          ...(attrs !== undefined    ? { attributes: attrs }        : {}),
        } satisfies UpdateLookupValueDto)
      : this.lookupService.addValue(this.categoryKey, {
          key:     raw.key!,
          labelEn: raw.labelEn!,
          labelAr: raw.labelAr!,
          ...(raw.sortOrder !== null ? { sortOrder: raw.sortOrder } : {}),
          ...(attrs !== undefined    ? { attributes: attrs }        : {}),
        } satisfies CreateLookupValueDto);

    request$.subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, this.translate.instant('lookup.errorSaveValue')));
        this.saving.set(false);
      },
    });
  }

  private loadCategory(): void {
    this.categoryLoading.set(true);
    this.lookupService.getCategoryByKey(this.categoryKey).subscribe({
      next: (cat) => {
        this.categoryLoading.set(false);
        this.buildAttributeGroup(cat.attributeSchema);
      },
      error: () => this.categoryLoading.set(false),
    });
  }

  private buildAttributeGroup(schema: Record<string, unknown> | null): void {
    const props =
      (schema as { properties?: Record<string, { type?: string; label?: string }> } | null)
        ?.properties ?? {};

    const fields = Object.entries(props).map(([key, def]) => ({
      key,
      type:  def.type  ?? 'string',
      label: def.label ?? key,
    }));
    this.attributeFields.set(fields);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- values determined at runtime
    const config: Record<string, any> = {};
    for (const field of fields) {
      config[field.key] = field.type === 'boolean' ? false
                        : field.type === 'number'  ? null
                        : '';
    }
    this.attributeGroup = this.fb.group(config);

    if (this.value?.attributes) {
      this.attributeGroup.patchValue(this.value.attributes as Record<string, unknown>);
    }
  }
}
