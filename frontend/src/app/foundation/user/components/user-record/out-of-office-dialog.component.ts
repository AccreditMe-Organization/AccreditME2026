import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { FormatService } from '../../../../core/formatting';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { DueDateService } from '../../../tasks/services/due-date.service';
import { IUserDto, UserService } from '../../services/user.service';
import { DateView } from './date-view';

/** Someone who may cover: an active colleague. */
export interface CoverOption {
  id: string;
  name: string;
  /** Their unit, shown under the name so two people of one name can be told apart. */
  unit: string;
}

type DateKey = 'from' | 'to';

// The end may be the start's own day, never before it.
function endNotBeforeStart(group: AbstractControl): ValidationErrors | null {
  const from = group.get('from')?.value as Date | null;
  const to = group.get('to')?.value as Date | null;
  return from && to && to.getTime() < from.getTime() ? { toBeforeFrom: true } : null;
}

/**
 * Out of office — ACC-120 slice 5, from the profile page's inline form.
 *
 * ## It always sends all three fields (CC-88, A2)
 *
 * `PATCH /users/:id/out-of-office` REPLACES the window: a field the request
 * leaves out is written as null (`user.service.ts` updateOutOfOffice). So a
 * save that sent only what changed — the end date, say — would silently clear
 * the start date and the cover person. Every save sends from, to and the cover
 * person, null where empty; "Clear all" empties the form, and Save then sends
 * three nulls.
 *
 * ## The cover person without users:view
 *
 * The colleague list needs users:view. Without it the host passes only the
 * CURRENT cover person, named from the record's references, so the picker can
 * still show and keep them, or clear them — choosing someone new needs the
 * list (as on the profile page before this).
 *
 * ## Body height — measured in the browser pass, recorded on the PR.
 */
@Component({
  selector: 'app-out-of-office-dialog',
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
      @if (dateView.picking(); as key) {
        <div class="am-ooo-dateview" data-ooo-dateview>
          <button type="button" class="am-backlink" (click)="dateView.close()">
            <i class="pi pi-arrow-left am-backlink__icon" aria-hidden="true"></i>
            {{ 'task.request.backToDetails' | translate }}
          </button>
          <am-inline-calendar
            [value]="form.controls[key].value"
            (valueChange)="onDayPicked(key, $event)"
            [workingDays]="dueDates.workingDays()"
            [holidays]="dueDates.holidays()"
          />
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-col">
          <p class="am-ooo-hint">{{ 'userRecord.outOfOfficeDialog.hint' | translate }}</p>

          @for (key of dateKeys; track key) {
            <am-field
              [label]="labelFor(key) | translate"
              [control]="form.controls[key]"
              [inputId]="'ooo-' + key"
              [forceShowErrors]="showErrors()"
            >
              <div class="am-ooo-date">
                <input
                  pInputText
                  dir="ltr"
                  readonly
                  [id]="'ooo-' + key"
                  class="am-ooo-date__text"
                  [value]="dateText(key)"
                  [placeholder]="'task.request.chooseDate' | translate"
                  (click)="dateView.openFor(key)"
                  [attr.data-ooo-date]="key"
                />
                <button
                  type="button"
                  class="am-ooo-date__button"
                  [attr.aria-label]="'task.request.chooseDate' | translate"
                  (click)="dateView.openFor(key)"
                >
                  <i class="pi pi-calendar" aria-hidden="true"></i>
                </button>
                @if (form.controls[key].value) {
                  <button
                    type="button"
                    class="am-ooo-date__button"
                    [attr.aria-label]="'userRecord.outOfOfficeDialog.clearDate' | translate: { label: (labelFor(key) | translate) }"
                    (click)="clearDate(key)"
                    [attr.data-ooo-clear]="key"
                  >
                    <i class="pi pi-times" aria-hidden="true"></i>
                  </button>
                }
              </div>
            </am-field>
          }
          @if (showErrors() && form.hasError('toBeforeFrom')) {
            <p class="am-ooo-error" role="alert" data-ooo-order-error>
              {{ 'userRecord.outOfOfficeDialog.toBeforeFrom' | translate }}
            </p>
          }

          <am-field
            [label]="'userRecord.outOfOfficeDialog.cover' | translate"
            [control]="form.controls.actingUserId"
            inputId="ooo-cover"
          >
            <app-overlay-select
              formControlName="actingUserId"
              [options]="coverOptions()"
              optionLabel="name"
              optionValue="id"
              [showClear]="true"
              [itemTemplate]="coverItemTpl"
            />
            <ng-template #coverItemTpl let-option>
              <div class="flex flex-col">
                <span>{{ option.name }}</span>
                @if (option.unit) {
                  <span class="text-xs text-[var(--am-text-secondary)]">{{ option.unit }}</span>
                }
              </div>
            </ng-template>
          </am-field>

          @if (error()) {
            <p class="am-ooo-error" role="alert">{{ error()! | translate }}</p>
          }
        </form>
      }
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex items-center justify-between gap-3">
        <p-button
          [label]="'userRecord.outOfOfficeDialog.clearAll' | translate"
          [text]="true"
          severity="secondary"
          type="button"
          [disabled]="saving() || isEmpty()"
          (onClick)="clearAll()"
          data-ooo-clear-all
        />
        <div class="flex gap-3">
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
            [label]="'common.save' | translate"
            [loading]="saving()"
            (onClick)="submit()"
            data-ooo-save
          />
        </div>
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'userRecord.outOfOffice' | translate"
      [context]="user()?.name ?? ''"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="form.dirty"
      [saving]="saving()"
      size="form"
    />
  `,
  styles: [
    `
      .am-ooo-hint {
        margin: 0 0 var(--am-space-12);
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-500);
      }
      .am-ooo-error {
        margin: 0 0 var(--am-space-12);
        font-size: var(--am-type-meta-size);
        color: var(--am-danger-ink);
      }
      .am-ooo-date {
        display: flex;
        gap: var(--am-space-8);
        align-items: center;
      }
      .am-ooo-date__text {
        flex: 1 1 auto;
        min-width: 0;
        cursor: pointer;
      }
      .am-ooo-date__button {
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
      .am-ooo-date__button:hover {
        border-color: var(--am-control-border-hover);
      }
      .am-ooo-dateview {
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
      .am-ooo-date__button:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
    `,
  ],
})
export class OutOfOfficeDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly format = inject(FormatService);
  readonly dueDates = inject(DueDateService);
  readonly dateView = new DateView<DateKey>();

  readonly visible = input.required<boolean>();
  readonly user = input<IUserDto | null>(null);
  readonly coverOptions = input<CoverOption[]>([]);
  readonly visibleChange = output<boolean>();
  /** The saved record; the host keeps its references. */
  readonly saved = output<IUserDto>();

  readonly dateKeys: readonly DateKey[] = ['from', 'to'];
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showErrors = signal(false);
  private readonly values = signal<{ from: Date | null; to: Date | null; actingUserId: string | null }>({
    from: null,
    to: null,
    actingUserId: null,
  });

  readonly form = this.fb.group(
    {
      from: [null as Date | null],
      to: [null as Date | null],
      actingUserId: [null as string | null],
    },
    { validators: endNotBeforeStart },
  );

  readonly isEmpty = computed(() => {
    const v = this.values();
    return !v.from && !v.to && !v.actingUserId;
  });

  constructor() {
    this.form.valueChanges.subscribe(() => this.values.set(this.form.getRawValue()));
    // Each OPENING starts from the record as saved.
    effect(() => {
      if (!this.visible()) return;
      const user = this.user();
      untracked(() => {
        this.dueDates.load();
        this.form.reset({
          from: user?.outOfOfficeFrom ? new Date(user.outOfOfficeFrom) : null,
          to: user?.outOfOfficeTo ? new Date(user.outOfOfficeTo) : null,
          actingUserId: user?.actingUserId ?? null,
        });
        this.error.set(null);
        this.showErrors.set(false);
        this.dateView.close();
      });
    });
  }

  labelFor(key: DateKey): string {
    return key === 'from' ? 'user.outOfOfficeFrom' : 'user.outOfOfficeTo';
  }

  dateText(key: DateKey): string {
    const day = this.values()[key];
    return day ? this.format.dateForInput(day) : '';
  }

  onDayPicked(key: DateKey, day: Date | null): void {
    this.form.controls[key].setValue(day);
    this.form.controls[key].markAsDirty();
    this.dateView.close();
  }

  clearDate(key: DateKey): void {
    this.form.controls[key].setValue(null);
    this.form.controls[key].markAsDirty();
  }

  clearAll(): void {
    this.form.setValue({ from: null, to: null, actingUserId: null });
    this.form.markAsDirty();
  }

  submit(): void {
    const user = this.user();
    if (!user || this.saving()) return;
    if (this.form.invalid) {
      this.showErrors.set(true);
      return;
    }
    const value = this.form.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    // ALL THREE, every time — see the class comment (A2).
    this.userService
      .updateOutOfOffice(user.id, {
        outOfOfficeFrom: value.from ? value.from.toISOString() : null,
        outOfOfficeTo: value.to ? value.to.toISOString() : null,
        actingUserId: value.actingUserId ?? null,
      })
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.form.markAsPristine();
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
