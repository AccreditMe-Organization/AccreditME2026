import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
// ACC-96 — the effective-date calendar is its own LAYER rather than a floating
// panel inside this dialog. See the template comment beside it.
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FormatService } from '../../../../core/formatting';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { ConfirmationService } from 'primeng/api';
import {
  OrgUnitHeadService,
  IOrgUnitHeadStatus,
} from '../../services/org-unit-head.service';
import { OrgPositionService, IOrgPositionDto } from '../../../org-position/services/org-position.service';
import { UserService } from '../../../user/services/user.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { AmDatePipe } from '../../../../core/formatting';

// ACC-40 Section 2.2/2.3 — this panel renders purely from
// OrgUnitHeadService.getHeadStatus()'s LIVE derivation (holders,
// pendingHeadUserId, headHandoverEffectiveDate) — never from
// OrgUnit.isHeadVacant/actingHeadUserId, which stay inert until Phase 6/7.
@Component({
  selector: 'app-org-unit-head-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    TranslatePipe,
    AmDatePipe,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    EditDialogComponent,
    InputTextModule,
    MessageModule,
    TagModule,
  ],
  template: `
    @if (error()) {
      <p-message severity="error" [text]="error()! | translate" styleClass="mb-4 w-full" />
    }

    @if (loading()) {
      <p class="text-sm text-[var(--am-text-secondary)]">{{ 'common.loading' | translate }}</p>
    } @else if (status(); as s) {
      @if (s.pendingHeadUserId) {
        <!-- Handover in progress -->
        <div class="flex flex-col gap-4">
          <p-tag severity="warn" [value]="'orgUnitHead.handoverInProgress' | translate" />
          <p class="text-sm">
            {{ 'orgUnitHead.handoverSummary' | translate }}
            <strong>{{ holderName(outgoingHolderId()) }}</strong>
            →
            <strong>{{ holderName(s.pendingHeadUserId) }}</strong>
          </p>
          <p class="text-sm text-[var(--am-text-secondary)]">
            {{ 'orgUnitHead.effectiveDate' | translate }}: {{ s.headHandoverEffectiveDate | amDate }}
          </p>
          <div class="flex gap-2">
            <p-button
              [label]="'orgUnitHead.completeNow' | translate"
              [loading]="acting()"
              (onClick)="onCompleteHandoverNow()"
            />
            <p-button
              [label]="'orgUnitHead.cancelHandover' | translate"
              severity="danger"
              [text]="true"
              [loading]="acting()"
              (onClick)="onCancelHandover()"
            />
          </div>
        </div>
      } @else if (s.holders.length === 0) {
        <!-- Vacant -->
        <div class="flex flex-col gap-4">
          <p-tag severity="danger" [value]="'orgUnitHead.vacant' | translate" />
          <form [formGroup]="assignForm" (ngSubmit)="onAssign()" class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">{{ 'orgUnitHead.position' | translate }}</label>
              <p-select
                formControlName="positionId"
                [options]="headPositions()"
                optionLabel="nameEn"
                optionValue="id"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">{{ 'orgUnitHead.candidate' | translate }}</label>
              <p-select
                formControlName="userId"
                [options]="unitUsers()"
                optionLabel="name"
                optionValue="id"
              />
            </div>
            <p-button
              [label]="'orgUnitHead.assign' | translate"
              type="submit"
              [loading]="acting()"
              [disabled]="assignForm.invalid"
            />
          </form>

          <hr />

          <h4 class="text-sm font-medium">{{ 'orgUnitHead.actingHead' | translate }}</h4>
          @if (s.actingHeadUserId) {
            <p-tag severity="info" [value]="'orgUnitHead.actingHeadCurrent' | translate: { name: holderName(s.actingHeadUserId) }" />
            <p-button
              [label]="'orgUnitHead.actingHeadClear' | translate"
              severity="danger"
              [text]="true"
              [loading]="acting()"
              (onClick)="onClearActingHead()"
            />
          } @else {
            <form [formGroup]="actingHeadForm" (ngSubmit)="onAssignActingHead()" class="flex flex-col gap-3">
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium">{{ 'orgUnitHead.actingHeadCandidate' | translate }}</label>
                <p-select
                  formControlName="userId"
                  [options]="unitUsers()"
                  optionLabel="name"
                  optionValue="id"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium">{{ 'orgUnitHead.actingHeadCoveringFor' | translate }}</label>
                <p-select
                  formControlName="coveringForUserId"
                  [options]="unitUsers()"
                  optionLabel="name"
                  optionValue="id"
                  [showClear]="true"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium">{{ 'orgUnitHead.reason' | translate }}</label>
                <input pInputText formControlName="reason" />
              </div>
              <p-button
                [label]="'orgUnitHead.actingHeadAssign' | translate"
                type="submit"
                [loading]="acting()"
                [disabled]="actingHeadForm.invalid"
              />
            </form>
          }
        </div>
      } @else {
        <!-- One (or, mid-handover only, two) active holder(s) -->
        <div class="flex flex-col gap-4">
          <p-tag severity="success" [value]="'orgUnitHead.currentHead' | translate: { name: holderName(s.holders[0].id) }" />
          <p-button
            [label]="'orgUnitHead.vacate' | translate"
            severity="danger"
            [text]="true"
            [loading]="acting()"
            (onClick)="onVacate()"
          />

          <hr />

          <h4 class="text-sm font-medium">{{ 'orgUnitHead.declareHandover' | translate }}</h4>
          <form [formGroup]="handoverForm" (ngSubmit)="onDeclareHandover()" class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">{{ 'orgUnitHead.successor' | translate }}</label>
              <p-select
                formControlName="incomingUserId"
                [options]="unitUsers()"
                optionLabel="name"
                optionValue="id"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label for="effectiveDate" class="text-sm font-medium">
                {{ 'orgUnitHead.effectiveDate' | translate }}
              </label>
              <!-- ACC-96 — NOT a <p-datepicker> with its own floating panel.
                   Confirmed live on this screen: the panel opened INSIDE the
                   dialog and ran 165px below its bottom edge, so the lower
                   weeks of the month were unreachable, and it closed on a
                   scroll of the app shell's <main>. The calendar is now its
                   own layer at the root, which has neither problem.
                   Typing stays a complete path to a value. -->
              <div class="flex gap-1">
                <input
                  pInputText
                  id="effectiveDate"
                  class="flex-1"
                  [value]="effectiveDateText()"
                  (input)="onEffectiveDateTyped($any($event.target).value)"
                  (blur)="commitTypedEffectiveDate()"
                  autocomplete="off"
                />
                <p-button
                  type="button"
                  icon="pi pi-calendar"
                  [text]="true"
                  [ariaLabel]="'orgUnitHead.toggleDatePanel' | translate"
                  (onClick)="toggleDatePanel()"
                />
              </div>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">{{ 'orgUnitHead.reason' | translate }}</label>
              <input pInputText formControlName="reason" />
            </div>
            <p-button
              [label]="'orgUnitHead.declare' | translate"
              type="submit"
              [loading]="acting()"
              [disabled]="handoverForm.invalid"
            />
          </form>
        </div>
      }
    }

    <!-- ACC-96 — the calendar as its own layer at the root, as
         public-holiday-form does it (ACC-111 a613fcb). [inline] means PrimeNG
         builds no overlay, so there is nothing for ConnectedOverlayScrollHandler
         to close and nothing for the dialog to clip; appendTo="body" keeps the
         layer out of THIS dialog's scrolling body. EditDialogComponent
         registers it with LayerStackService, which is what makes Escape close
         exactly one layer per press. -->
    <ng-template #effectiveDateTpl>
      <p-datepicker
        [inline]="true"
        [ngModel]="controlEffectiveDate()"
        [ngModelOptions]="{ standalone: true }"
        (ngModelChange)="onEffectiveDatePicked($event)"
        styleClass="w-full"
      />
    </ng-template>
    <app-edit-dialog
      [visible]="datePanelOpen()"
      (visibleChange)="onDatePanelVisibleChange($event)"
      [header]="'orgUnitHead.chooseEffectiveDate' | translate"
      [content]="effectiveDateTpl"
      size="picker"
      appendTo="body"
    />
  `,
})
export class OrgUnitHeadPanelComponent implements OnInit {
  readonly orgUnitId = input.required<string>();

  readonly saved = output<void>();

  private readonly fb = inject(FormBuilder);
  private readonly format = inject(FormatService);
  private readonly orgUnitHeadService = inject(OrgUnitHeadService);
  private readonly orgPositionService = inject(OrgPositionService);
  private readonly userService = inject(UserService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly translateService = inject(TranslateService);

  readonly loading = signal(false);
  readonly acting = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal<IOrgUnitHeadStatus | null>(null);
  readonly headPositions = signal<IOrgPositionDto[]>([]);
  readonly unitUsers = signal<{ id: string; name: string }[]>([]);

  readonly assignForm = this.fb.group({
    positionId: [null as string | null, [Validators.required]],
    userId: [null as string | null, [Validators.required]],
  });

  readonly handoverForm = this.fb.group({
    incomingUserId: [null as string | null, [Validators.required]],
    effectiveDate: [null as Date | null, [Validators.required]],
    reason: [''],
  });

  readonly actingHeadForm = this.fb.group({
    userId: [null as string | null, [Validators.required]],
    coveringForUserId: [null as string | null],
    reason: [''],
  });

  ngOnInit(): void {
    this.orgPositionService.listPositions().subscribe({
      next: (positions) => this.headPositions.set(positions.filter((p) => p.isUnitHeadPosition)),
    });
    this.userService.listAllUsers({ status: 'ACTIVE', orgUnitId: this.orgUnitId() }).subscribe({
      next: (users) => this.unitUsers.set(users.map((u) => ({ id: u.id, name: u.name }))),
    });
    this.load();
  }

  holderName(userId: string | null): string {
    if (!userId) return '—';
    return this.unitUsers().find((u) => u.id === userId)?.name ?? userId;
  }

  outgoingHolderId(): string | null {
    const s = this.status();
    if (!s) return null;
    return s.holders.find((h) => h.id !== s.pendingHeadUserId)?.id ?? null;
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.orgUnitHeadService.getHeadStatus(this.orgUnitId()).subscribe({
      next: (status) => {
        this.status.set(status);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(extractErrorMessage(err, 'orgUnitHead.errorLoad'));
        this.loading.set(false);
      },
    });
  }

  onAssign(): void {
    if (this.assignForm.invalid) return;
    const { positionId, userId } = this.assignForm.getRawValue();
    this.acting.set(true);
    this.error.set(null);
    this.orgUnitHeadService.assignHead(this.orgUnitId(), { positionId: positionId!, userId: userId! }).subscribe({
      next: () => {
        this.acting.set(false);
        this.assignForm.reset();
        this.load();
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.acting.set(false);
        this.error.set(extractErrorMessage(err, 'orgUnitHead.errorSave'));
      },
    });
  }

  onVacate(): void {
    this.confirmationService.confirm({
      message: this.translateService.instant('orgUnitHead.vacateConfirmMessage'),
      header: this.translateService.instant('common.confirm'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.acting.set(true);
        this.error.set(null);
        this.orgUnitHeadService.vacateHead(this.orgUnitId()).subscribe({
          next: () => {
            this.acting.set(false);
            this.load();
            this.saved.emit();
          },
          error: (err: unknown) => {
            this.acting.set(false);
            this.error.set(extractErrorMessage(err, 'orgUnitHead.errorSave'));
          },
        });
      },
    });
  }

  onDeclareHandover(): void {
    if (this.handoverForm.invalid) return;
    const { incomingUserId, effectiveDate, reason } = this.handoverForm.getRawValue();
    this.acting.set(true);
    this.error.set(null);
    this.orgUnitHeadService
      .declareHandover(this.orgUnitId(), {
        incomingUserId: incomingUserId!,
        effectiveDate: effectiveDate!.toISOString(),
        reason: reason || undefined,
      })
      .subscribe({
        next: () => {
          this.acting.set(false);
          this.handoverForm.reset();
          this.load();
          this.saved.emit();
        },
        error: (err: unknown) => {
          this.acting.set(false);
          this.error.set(extractErrorMessage(err, 'orgUnitHead.errorSave'));
        },
      });
  }

  onCompleteHandoverNow(): void {
    this.acting.set(true);
    this.error.set(null);
    this.orgUnitHeadService.completeHandoverNow(this.orgUnitId()).subscribe({
      next: () => {
        this.acting.set(false);
        this.load();
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.acting.set(false);
        this.error.set(extractErrorMessage(err, 'orgUnitHead.errorSave'));
      },
    });
  }

  onCancelHandover(): void {
    this.confirmationService.confirm({
      message: this.translateService.instant('orgUnitHead.cancelHandoverConfirmMessage'),
      header: this.translateService.instant('common.confirm'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.acting.set(true);
        this.error.set(null);
        this.orgUnitHeadService.cancelHandover(this.orgUnitId()).subscribe({
          next: () => {
            this.acting.set(false);
            this.load();
            this.saved.emit();
          },
          error: (err: unknown) => {
            this.acting.set(false);
            this.error.set(extractErrorMessage(err, 'orgUnitHead.errorSave'));
          },
        });
      },
    });
  }

  onAssignActingHead(): void {
    if (this.actingHeadForm.invalid) return;
    const { userId, coveringForUserId, reason } = this.actingHeadForm.getRawValue();
    this.acting.set(true);
    this.error.set(null);
    this.orgUnitHeadService
      .assignActingHead(this.orgUnitId(), {
        userId: userId!,
        coveringForUserId: coveringForUserId || undefined,
        reason: reason || undefined,
      })
      .subscribe({
        next: () => {
          this.acting.set(false);
          this.actingHeadForm.reset();
          this.load();
          this.saved.emit();
        },
        error: (err: unknown) => {
          this.acting.set(false);
          this.error.set(extractErrorMessage(err, 'orgUnitHead.errorSave'));
        },
      });
  }

  onClearActingHead(): void {
    this.confirmationService.confirm({
      message: this.translateService.instant('orgUnitHead.actingHeadClearConfirmMessage'),
      header: this.translateService.instant('common.confirm'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.acting.set(true);
        this.error.set(null);
        this.orgUnitHeadService.clearActingHead(this.orgUnitId()).subscribe({
          next: () => {
            this.acting.set(false);
            this.load();
            this.saved.emit();
          },
          error: (err: unknown) => {
            this.acting.set(false);
            this.error.set(extractErrorMessage(err, 'orgUnitHead.errorSave'));
          },
        });
      },
    });
  }

  // ── Effective date (ACC-96) ────────────────────────────────────────────
  // Mirrors public-holiday-form's date field. `typed` holds what is part-way
  // written, `controlEffectiveDate` the committed value; the text prefers the
  // former, so re-rendering mid-keystroke cannot rewrite the field under the
  // cursor.
  readonly datePanelOpen = signal(false);
  private readonly typedEffectiveDate = signal<string | null>(null);
  readonly controlEffectiveDate = signal<Date | null>(null);

  // dateForInput, not date(): this value is typed back, so it stays Gregorian
  // with English months even for an Arabic or Hijri reader (ACC-94 D4).
  readonly effectiveDateText = computed(
    () => this.typedEffectiveDate() ?? this.format.dateForInput(this.controlEffectiveDate()),
  );

  toggleDatePanel(): void {
    this.datePanelOpen.set(!this.datePanelOpen());
  }

  onEffectiveDatePicked(value: Date | null): void {
    this.handoverForm.controls.effectiveDate.setValue(value);
    this.handoverForm.controls.effectiveDate.markAsDirty();
    this.controlEffectiveDate.set(value);
    this.typedEffectiveDate.set(null);
    this.datePanelOpen.set(false);
    this.focusEffectiveDateInput();
  }

  onDatePanelVisibleChange(visible: boolean): void {
    this.datePanelOpen.set(visible);
    if (!visible) this.focusEffectiveDateInput();
  }

  onEffectiveDateTyped(value: string): void {
    this.typedEffectiveDate.set(value);
  }

  /** On BLUR, not per keystroke — "15 S" is not an error, it is unfinished. */
  commitTypedEffectiveDate(): void {
    const text = this.typedEffectiveDate();
    if (text === null) return;

    const control = this.handoverForm.controls.effectiveDate;
    const trimmed = text.trim();

    if (trimmed === '') {
      control.setValue(null);
      control.markAsDirty();
      this.controlEffectiveDate.set(null);
      this.typedEffectiveDate.set(null);
      return;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      control.setErrors({ ...(control.errors ?? {}), invalidDate: true });
      control.markAsDirty();
      return;
    }

    control.setValue(parsed);
    control.markAsDirty();
    this.controlEffectiveDate.set(parsed);
    this.typedEffectiveDate.set(null);
  }

  private focusEffectiveDateInput(): void {
    setTimeout(() => {
      document.getElementById('effectiveDate')?.focus();
    });
  }
}
