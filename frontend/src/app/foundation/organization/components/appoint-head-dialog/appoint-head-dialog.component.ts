import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { OrgUnitHeadService } from '../../services/org-unit-head.service';

/** Someone this unit's dialogs can choose: an active person whose primary unit it is. */
export interface HeadshipPerson {
  id: string;
  name: string;
  email?: string;
  positionId?: string | null;
}

/**
 * ACC-133 — Appoint head, dialog A (the vacant unit, Horizon 1). Calls
 * `POST /assign`.
 *
 * - **From is a read-only row reading "Now, when you save"**, in its final
 *   position. `assignHead()` takes no date: it appoints now. Horizon 2 makes the
 *   row editable once ACC-131 brings scheduled assignment.
 * - **No note field.** `assignHead()` takes none, so a note would be text that
 *   is silently dropped.
 * - **The button says "Appoint now"**, never Save: it names what happens.
 * - **The position slot always names the position**, because being head means
 *   holding one. One head-conferring position: a read-only pair. Two or more: a
 *   select. None: the panel does not open this dialog at all.
 *
 * Standard density: three field blocks, 211px drawn (OS fits table).
 */
@Component({
  selector: 'am-appoint-head-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, EditDialogComponent, FieldComponent, OverlaySelectComponent],
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="form" (ngSubmit)="submit()" class="am-ahd" novalidate>
        <am-field
          [label]="'headship.appoint.head' | translate"
          [control]="form.controls.userId"
          inputId="am-ahd-person"
          [hint]="personHint()"
          [forceShowErrors]="showErrors()"
        >
          <app-overlay-select
            formControlName="userId"
            [options]="personOptions()"
            optionLabel="label"
            optionValue="value"
            [ariaLabel]="'headship.appoint.head' | translate"
            [placeholder]="(people().length ? 'headship.appoint.personPlaceholder' : 'headship.appoint.nobody') | translate"
          />
        </am-field>

        @if (positionOptions().length > 1) {
          <am-field
            [label]="'headship.appoint.position' | translate"
            [control]="form.controls.positionId"
            inputId="am-ahd-position"
            [forceShowErrors]="showErrors()"
          >
            <app-overlay-select
              formControlName="positionId"
              [options]="positionOptions()"
              optionLabel="label"
              optionValue="value"
              [ariaLabel]="'headship.appoint.position' | translate"
              [placeholder]="'headship.appoint.positionPlaceholder' | translate"
            />
          </am-field>
        } @else {
          <am-field
            [label]="'headship.appoint.position' | translate"
            [readonly]="true"
            [readonlyText]="positionOptions()[0]?.label ?? ''"
            [hint]="'headship.appoint.onlyPosition' | translate"
          ></am-field>
        }

        <am-field
          [label]="'headship.appoint.from' | translate"
          [readonly]="true"
          [readonlyText]="'headship.appoint.fromNow' | translate"
          [hint]="'headship.appoint.fromHint' | translate: { date: today() }"
        ></am-field>

        @if (saveError()) {
          <p class="am-ahd__error" role="alert" data-testid="appoint-head-error">{{ saveError() }}</p>
        }
      </form>
    </ng-template>

    <ng-template #footerTpl>
      <div class="flex justify-end gap-2">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="saving()"
          (onClick)="dialog.requestClose()"
        />
        <p-button
          type="button"
          data-testid="appoint-head-submit"
          [label]="'headship.appoint.submit' | translate"
          [loading]="saving()"
          [disabled]="saving()"
          (onClick)="submit()"
        />
      </div>
    </ng-template>

    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'headship.appoint.title' | translate: { unit: unitName() }"
      [context]="'headship.appoint.noHead' | translate: { unit: unitName() }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="dirty()"
      [saving]="saving()"
      size="form"
    />
  `,
  styles: [
    `
      .am-ahd {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-12);
      }
      .am-ahd__error {
        margin: 0;
        font-size: var(--am-type-body-size);
        color: var(--am-danger-ink);
      }
    `,
  ],
})
export class AppointHeadDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly headService = inject(OrgUnitHeadService);
  private readonly format = inject(FormatService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);

  readonly orgUnitId = input.required<string>();
  readonly unitName = input.required<string>();
  readonly people = input.required<HeadshipPerson[]>();
  /** The organisation's active head-conferring positions; null while loading. */
  readonly positions = input.required<IOrgPositionDto[] | null>();
  readonly visible = input.required<boolean>();
  readonly visibleChange = output<boolean>();
  readonly saved = output<void>();

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly showErrors = signal(false);

  readonly form = this.fb.group({
    userId: [null as string | null, Validators.required],
    positionId: [null as string | null, Validators.required],
  });

  private readonly userIdValue = toSignal(this.form.controls.userId.valueChanges, { initialValue: null });
  private readonly positionIdValue = toSignal(this.form.controls.positionId.valueChanges, { initialValue: null });

  readonly today = computed(() => this.format.date(new Date()));

  readonly personOptions = computed(() =>
    this.people().map((p) => ({ label: p.name, value: p.id })),
  );

  readonly personHint = computed(() => {
    const id = this.userIdValue();
    return this.people().find((p) => p.id === id)?.email ?? '';
  });

  readonly positionOptions = computed(() =>
    (this.positions() ?? []).map((p) => ({ label: this.language.bilingual(p.nameEn, p.nameAr), value: p.id })),
  );

  /** A chosen person, or a changed position, is work Escape must ask about. */
  readonly dirty = computed(() => this.userIdValue() !== null || this.positionIdValue() !== this.defaultPositionId());

  private defaultPositionId(): string | null {
    const options = this.positionOptions();
    return options.length === 1 ? options[0]!.value : null;
  }

  constructor() {
    // Each open starts clean, with the only position filled in when there is
    // exactly one. The component outlives the dialog (ACC-29), so a discarded
    // choice must not be there on the next open.
    // Untracked: only opening resets, never a list arriving while it is open.
    effect(() => {
      if (this.visible()) untracked(() => this.reset());
    });
  }

  private reset(): void {
    this.form.reset({ userId: null, positionId: this.defaultPositionId() });
    this.showErrors.set(false);
    this.saveError.set(null);
  }

  submit(): void {
    if (this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      this.form.markAllAsTouched();
      return;
    }
    const { userId, positionId } = this.form.getRawValue();
    this.saving.set(true);
    this.saveError.set(null);
    this.headService.assignHead(this.orgUnitId(), { userId: userId!, positionId: positionId! }).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(extractErrorMessage(err, this.translate.instant('headship.saveFailed')));
      },
    });
  }
}
