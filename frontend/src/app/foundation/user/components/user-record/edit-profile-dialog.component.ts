import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { OrgUnitDto, buildOrgUnitCascadeOptions } from '../../../organization/services/org-unit.service';
import { DueDateService } from '../../../tasks/services/due-date.service';
import { IUserDto, UpdateUserProfileDto, UserService } from '../../services/user.service';
import { CoverOption } from './out-of-office-dialog.component';
import { DateView } from './date-view';

// Literal labels: a language's own name is written in that language.
const LANGUAGE_OPTIONS = [
  { label: 'English', value: 'en' },
  { label: 'العربية', value: 'ar' },
];

/**
 * Edit profile — ACC-120 slice 5, from the profile page's inline form.
 *
 * ## Two shapes, one dialog
 *
 * On your OWN record: name and language. With `users:manage`, also where the
 * person sits — position, unit, manager, and an acting unit with its end date.
 * The server ignores the placement fields on a self-edit by someone without
 * `users:manage` (`user.service.ts` updateProfile), so they are not offered:
 * a field the save would silently drop is not a field.
 *
 * ## Placement edits behave exactly as before (CC-88, D5)
 *
 * Position and unit still change here directly, beside Transfer, and the body
 * still sends an empty choice as "unchanged" — so a placement field cannot be
 * CLEARED from this dialog, and never could: the old form's × on these pickers
 * sent nothing and saved nothing. The × is therefore not offered, rather than
 * offered and ignored.
 *
 * ## The language
 *
 * Saving your OWN language switches the session to it at once (ACC-19). An
 * administrator setting someone else's never changes what the administrator
 * sees.
 *
 * ## Density
 *
 * Seven field blocks with placement, so compact (`check:dialog-density`), and
 * one density for both shapes — never mixed inside a dialog. Body heights are
 * measured in the browser pass and recorded on the PR.
 */
@Component({
  selector: 'app-edit-profile-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    EditDialogComponent,
    FieldComponent,
    InlineCalendarComponent,
    OverlaySelectComponent,
  ],
  template: `
    <ng-template #bodyTpl>
      @if (dateView.picking()) {
        <div class="am-ep-dateview" data-ep-dateview>
          <button type="button" class="am-backlink" (click)="dateView.close()">
            <i class="pi pi-arrow-left am-backlink__icon" aria-hidden="true"></i>
            {{ 'task.request.backToDetails' | translate }}
          </button>
          <am-inline-calendar
            [value]="form.controls.actingOrgUnitUntil.value"
            (valueChange)="onDayPicked($event)"
            [workingDays]="dueDates.workingDays()"
            [holidays]="dueDates.holidays()"
          />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col">
          <am-field
            [label]="'user.name' | translate"
            [control]="form.controls.name"
            inputId="ep-name"
            [forceShowErrors]="showErrors()"
            [errorMessages]="{ required: 'userRecord.editProfileDialog.nameRequired' }"
          >
            <input pInputText id="ep-name" formControlName="name" autocomplete="off" />
          </am-field>

          <am-field [label]="'user.language' | translate" [control]="form.controls.language" inputId="ep-language">
            <app-overlay-select
              formControlName="language"
              [options]="languageOptions"
              optionLabel="label"
              optionValue="value"
            />
          </am-field>

          @if (canEditPlacement()) {
            <h3 class="am-ep-section" data-ep-placement>{{ 'userRecord.editProfileDialog.placement' | translate }}</h3>

            <am-field [label]="'user.position' | translate" [control]="form.controls.positionId" inputId="ep-position">
              <app-overlay-select
                formControlName="positionId"
                [options]="positionOptions()"
                optionLabel="label"
                optionValue="value"
              />
            </am-field>

            <am-field
              [label]="'user.primaryOrgUnit' | translate"
              [control]="form.controls.primaryOrgUnitId"
              inputId="ep-unit"
            >
              <app-overlay-select
                formControlName="primaryOrgUnitId"
                [options]="unitOptions()"
                optionLabel="label"
                optionValue="value"
                optionGroupLabel="label"
                optionGroupChildren="items"
              />
            </am-field>

            <am-field [label]="'user.manager' | translate" [control]="form.controls.managerId" inputId="ep-manager">
              <app-overlay-select
                formControlName="managerId"
                [options]="managerOptions()"
                optionLabel="name"
                optionValue="id"
                [itemTemplate]="personItemTpl"
              />
            </am-field>

            <div class="am-ep-pair">
              <am-field
                [label]="'user.actingOrgUnit' | translate"
                [control]="form.controls.actingOrgUnitId"
                inputId="ep-acting-unit"
              >
                <app-overlay-select
                  formControlName="actingOrgUnitId"
                  [options]="unitOptions()"
                  optionLabel="label"
                  optionValue="value"
                  optionGroupLabel="label"
                  optionGroupChildren="items"
                />
              </am-field>
              <am-field
                [label]="'user.actingOrgUnitUntil' | translate"
                [control]="form.controls.actingOrgUnitUntil"
                inputId="ep-acting-until"
              >
                <div class="am-ep-date">
                  <input
                    pInputText
                    dir="ltr"
                    readonly
                    id="ep-acting-until"
                    class="am-ep-date__text"
                    [value]="untilText()"
                    [placeholder]="'task.request.chooseDate' | translate"
                    (click)="dateView.openFor('until')"
                    data-ep-until
                  />
                  <button
                    type="button"
                    class="am-ep-date__button"
                    [attr.aria-label]="'task.request.chooseDate' | translate"
                    (click)="dateView.openFor('until')"
                  >
                    <i class="pi pi-calendar" aria-hidden="true"></i>
                  </button>
                </div>
              </am-field>
            </div>
          }

          @if (error()) {
            <p class="am-ep-error" role="alert">{{ error()! | translate }}</p>
          }
        </form>
      }
      <ng-template #personItemTpl let-option>
        <div class="flex flex-col">
          <span>{{ option.name }}</span>
          @if (option.unit) {
            <span class="text-xs text-[var(--am-text-secondary)]">{{ option.unit }}</span>
          }
        </div>
      </ng-template>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          type="button"
          [disabled]="saving()"
          (onClick)="dialog.requestClose()"
        />
        <p-button type="button" [label]="'common.save' | translate" [loading]="saving()" (onClick)="submit()" data-ep-save />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'userRecord.editProfile' | translate"
      [context]="user()?.name ?? ''"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      density="compact"
      size="form"
    />
  `,
  styles: [
    `
      .am-ep-section {
        margin: var(--am-space-4) 0 var(--am-space-8);
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--am-ink-500);
      }
      .am-ep-pair {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: var(--am-space-12);
      }
      .am-ep-error {
        margin: 0;
        font-size: var(--am-type-meta-size);
        color: var(--am-danger-ink);
      }
      .am-ep-date {
        display: flex;
        gap: var(--am-space-8);
        align-items: center;
      }
      .am-ep-date__text {
        flex: 1 1 auto;
        min-width: 0;
        cursor: pointer;
      }
      .am-ep-date__button {
        flex: none;
        inline-size: 36px;
        block-size: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-control);
        background: var(--am-surface-raised);
        color: var(--am-ink-700);
        cursor: pointer;
      }
      .am-ep-date__button:hover {
        border-color: var(--am-control-border-hover);
      }
      .am-ep-dateview {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-8);
      }
      .am-backlink {
        align-self: flex-start;
        display: inline-flex;
        gap: var(--am-space-8);
        align-items: center;
        border: 0;
        background: none;
        padding: 0;
        font: inherit;
        color: var(--am-primary-600);
        cursor: pointer;
      }
      :dir(rtl) .am-backlink__icon {
        transform: scaleX(-1);
      }
      .am-backlink:focus-visible,
      .am-ep-date__button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
    `,
  ],
})
export class EditProfileDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly languageService = inject(LanguageService);
  private readonly format = inject(FormatService);
  readonly dueDates = inject(DueDateService);
  readonly dateView = new DateView<'until'>();

  readonly visible = input.required<boolean>();
  readonly user = input<IUserDto | null>(null);
  /** The viewer is the person on the record. */
  readonly isOwn = input(false);
  /** The viewer holds users:manage — the server's gate for the placement fields. */
  readonly canEditPlacement = input(false);
  readonly positions = input<readonly IOrgPositionDto[]>([]);
  readonly orgUnits = input<readonly OrgUnitDto[]>([]);
  readonly managers = input<readonly CoverOption[]>([]);
  readonly visibleChange = output<boolean>();
  readonly saved = output<IUserDto>();

  readonly languageOptions = LANGUAGE_OPTIONS;
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  private readonly until = signal<Date | null>(null);

  readonly form = this.fb.group({
    name: ['', [Validators.required]],
    language: ['en'],
    positionId: [null as string | null],
    primaryOrgUnitId: [null as string | null],
    managerId: [null as string | null],
    actingOrgUnitId: [null as string | null],
    actingOrgUnitUntil: [null as Date | null],
  });

  // ACC-160 — a picker gets a resolved label, never a field name.
  readonly positionOptions = computed(() =>
    this.positions().map((p) => ({ label: this.languageService.bilingual(p.nameEn, p.nameAr), value: p.id })),
  );
  readonly unitOptions = computed(() => buildOrgUnitCascadeOptions([...this.orgUnits()], null, null));
  /** Never the person themselves: nobody is their own manager. */
  readonly managerOptions = computed(() => this.managers().filter((m) => m.id !== this.user()?.id));

  readonly untilText = computed(() => {
    const day = this.until();
    return day ? this.format.dateForInput(day) : '';
  });

  constructor() {
    this.form.controls.actingOrgUnitUntil.valueChanges.subscribe((day) => this.until.set(day));
    effect(() => {
      if (!this.visible()) return;
      const user = this.user();
      untracked(() => {
        this.dueDates.load();
        this.form.reset({
          name: user?.name ?? '',
          language: user?.language ?? 'en',
          positionId: user?.positionId ?? null,
          primaryOrgUnitId: user?.primaryOrgUnitId ?? null,
          managerId: user?.managerId ?? null,
          actingOrgUnitId: user?.actingOrgUnitId ?? null,
          actingOrgUnitUntil: user?.actingOrgUnitUntil ? new Date(user.actingOrgUnitUntil) : null,
        });
        this.error.set(null);
        this.showErrors.set(false);
        this.dateView.close();
      });
    });
  }

  onDayPicked(day: Date | null): void {
    this.form.controls.actingOrgUnitUntil.setValue(day);
    this.form.controls.actingOrgUnitUntil.markAsDirty();
    this.dateView.close();
  }

  submit(): void {
    const user = this.user();
    if (!user || this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      return;
    }
    const value = this.form.getRawValue();
    const dto: UpdateUserProfileDto = {
      name: value.name!.trim(),
      language: value.language ?? undefined,
    };
    if (this.canEditPlacement()) {
      // As the profile page sent them (D5): an empty choice means unchanged.
      dto.positionId = value.positionId ?? undefined;
      dto.primaryOrgUnitId = value.primaryOrgUnitId ?? undefined;
      dto.managerId = value.managerId ?? undefined;
      dto.actingOrgUnitId = value.actingOrgUnitId ?? undefined;
      dto.actingOrgUnitUntil = value.actingOrgUnitUntil ? value.actingOrgUnitUntil.toISOString() : undefined;
    }
    this.saving.set(true);
    this.error.set(null);
    this.userService.updateProfile(user.id, dto).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.form.markAsPristine();
        // ACC-19 — your own language applies at once; someone else's never
        // changes what you see.
        if (this.isOwn() && saved.language) {
          this.languageService.use(saved.language).subscribe();
        }
        this.saved.emit(saved);
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.error.set(extractErrorMessage(err, 'user.errorSave'));
      },
    });
  }
}
