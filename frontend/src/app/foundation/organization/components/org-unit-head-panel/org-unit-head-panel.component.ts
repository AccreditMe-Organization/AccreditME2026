import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
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

// ACC-40 Section 2.2/2.3 — this panel renders purely from
// OrgUnitHeadService.getHeadStatus()'s LIVE derivation (holders,
// pendingHeadUserId, headHandoverEffectiveDate) — never from
// OrgUnit.isHeadVacant/actingHeadUserId, which stay inert until Phase 6/7.
@Component({
  selector: 'app-org-unit-head-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    SelectModule,
    DatePickerModule,
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
            {{ 'orgUnitHead.effectiveDate' | translate }}: {{ s.headHandoverEffectiveDate }}
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
              <label class="text-sm font-medium">{{ 'orgUnitHead.effectiveDate' | translate }}</label>
              <p-datepicker formControlName="effectiveDate" />
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
  `,
})
export class OrgUnitHeadPanelComponent implements OnInit {
  readonly orgUnitId = input.required<string>();

  readonly saved = output<void>();

  private readonly fb = inject(FormBuilder);
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
    this.userService.listUsers({ status: 'ACTIVE', orgUnitId: this.orgUnitId() }).subscribe({
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
}
