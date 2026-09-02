import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { StepperModule } from 'primeng/stepper';
import { UserService, IUserDto, ITransferContextDto, TransferUserDto } from '../../services/user.service';
import {
  OrgUnitService,
  OrgUnitDto,
  buildOrgUnitCascadeOptions,
} from '../../../organization/services/org-unit.service';
import { OrgUnitHeadService } from '../../../organization/services/org-unit-head.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

// ACC-46 Section 2.6.b — the transfer wizard. Pure content, no dialog
// wrapper of its own — the caller wraps it in a raw p-dialog, same
// convention as workflow-transition-editor.component.ts's own "Configure
// Actions" dialog (a p-dialog directly in the parent template, not
// EditDialogComponent — see this component's own 2.6.b.1 plan section for
// why neither EditDialogComponent nor a fully custom stepper fit here).
//
// Shell: a thin wrapper around PrimeNG's own p-stepper family
// (Section 2.6.b.1 of backend/Plans/step-46-manager-transfer-escalation-
// redesign.md). p-stepper owns step indicators and active-step state
// (the [(value)] on <p-stepper>, driven by numeric step values below);
// this component owns every piece of domain logic on top — gating
// advancement behind the live-gate HTTP calls, the conditional
// Replacement step, and the promotion branch's read-only derived manager
// text vs. the ordinary editable picker. We call activateCallback(targetStep)
// ourselves rather than relying on the stepper's own "next" concept.
//
// Step numbering: confirmed against PrimeNG's own source
// (primeng-stepper.mjs) that p-step's number badge is literally
// `{{ value() }}` — value is both the display number and the identifier
// correlating a p-step to its p-step-panel, with no separate "position in
// rendered list" concept to fall back on. Binding fixed literals here
// (Destination=1, Replacement=2, Position=3, Manager=4, Review=5) meant
// the user saw a gap (1,3,4,5) whenever Replacement was conditionally
// absent — found live during Playwright verification. Fixed via
// stepValues() below: Position/Manager/Review's own identifiers shift
// down by one whenever Replacement isn't shown, so the visible sequence
// is always contiguous. Destination (always 1) and Replacement (always 2,
// when present) never need to shift.
//
// Plan's own Step 2 (context load) is not a separate visible step here —
// it's the automatic fetch that gates advancing out of Step 1, exactly as
// the plan describes it ("automatic, not a user action").
@Component({
  selector: 'app-transfer-user-wizard',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, MessageModule, StepperModule, OverlaySelectComponent],
  template: `
    <form [formGroup]="form" class="flex flex-col gap-4">
      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }

      @if (submitResult(); as result) {
        <!-- Terminal state — replaces the stepper entirely once the
             transfer has actually been submitted, successfully or not.
             The partial-failure banner (2.6.e) shows here, not as a
             transient toast, so it stays visible until the user
             deliberately closes. -->
        <p-message [severity]="result.promotionCompleted === false ? 'warn' : 'success'" [text]="result.message" />
        <div class="flex justify-end pt-2">
          <p-button [label]="'common.close' | translate" (onClick)="saved.emit()" />
        </div>
      } @else {
        <p-stepper [(value)]="currentStep">
          <p-step-list>
            <p-step [value]="1">{{ 'user.transfer.stepDestination' | translate }}</p-step>
            @if (transferContext()?.hasActiveDirectReports) {
              <p-step [value]="stepValues().replacement">{{ 'user.transfer.stepReplacement' | translate }}</p-step>
            }
            <p-step [value]="stepValues().position">{{ 'user.transfer.stepPosition' | translate }}</p-step>
            <p-step [value]="stepValues().manager">{{ 'user.transfer.stepManager' | translate }}</p-step>
            <p-step [value]="stepValues().review">{{ 'user.transfer.stepReview' | translate }}</p-step>
          </p-step-list>

          <p-step-panels>
            <!-- Step 1 — Destination Unit -->
            <p-step-panel [value]="1">
              <ng-template #content let-activateCallback="activateCallback">
                <div class="flex flex-col gap-4 py-3">
                  <div class="flex flex-col gap-1">
                    <label class="text-sm font-medium">
                      {{ 'user.transfer.destinationOrgUnit' | translate }} <span class="text-red-500">*</span>
                    </label>
                    <app-overlay-select
                      formControlName="destinationOrgUnitId"
                      [options]="orgUnitCascadeOptions()"
                      optionLabel="label"
                      optionValue="value"
                      optionGroupLabel="label"
                      optionGroupChildren="items"
                    />
                  </div>
                  <div class="flex justify-end pt-2">
                    <p-button
                      [label]="'common.next' | translate"
                      [loading]="loading()"
                      [disabled]="!form.controls.destinationOrgUnitId.value"
                      (onClick)="goFromDestination(activateCallback)"
                    />
                  </div>
                </div>
              </ng-template>
            </p-step-panel>

            <!-- Step 2 — Replacement (conditional) -->
            @if (transferContext()?.hasActiveDirectReports) {
              <p-step-panel [value]="stepValues().replacement">
                <ng-template #content let-activateCallback="activateCallback">
                  <div class="flex flex-col gap-4 py-3">
                    <p class="text-sm text-[var(--am-text-secondary)]">{{ 'user.transfer.replacementHint' | translate }}</p>
                    <div class="flex flex-col gap-1">
                      <label class="text-sm font-medium">
                        {{ 'user.transfer.replacementLabel' | translate }} <span class="text-red-500">*</span>
                      </label>
                      <app-overlay-select
                        formControlName="replacementUserId"
                        [options]="sourceUnitCandidates()"
                        optionLabel="name"
                        optionValue="id"
                      />
                    </div>
                    <div class="flex justify-between pt-2">
                      <p-button [label]="'common.back' | translate" severity="secondary" [text]="true" (onClick)="activateCallback(1)" />
                      <p-button [label]="'common.next' | translate" [loading]="loading()" (onClick)="goFromReplacement(activateCallback)" />
                    </div>
                  </div>
                </ng-template>
              </p-step-panel>
            }

            <!-- Step 3 — Destination Position -->
            <p-step-panel [value]="stepValues().position">
              <ng-template #content let-activateCallback="activateCallback">
                <div class="flex flex-col gap-4 py-3">
                  <div class="flex flex-col gap-1">
                    <label class="text-sm font-medium">
                      {{ 'user.transfer.newPosition' | translate }} <span class="text-red-500">*</span>
                    </label>
                    <app-overlay-select
                      formControlName="newPositionId"
                      [options]="transferContext()?.availablePositions ?? []"
                      optionLabel="nameEn"
                      optionValue="id"
                    />
                  </div>
                  <div class="flex justify-between pt-2">
                    <p-button
                      [label]="'common.back' | translate"
                      severity="secondary"
                      [text]="true"
                      (onClick)="activateCallback(transferContext()?.hasActiveDirectReports ? stepValues().replacement : 1)"
                    />
                    <p-button
                      [label]="'common.next' | translate"
                      [loading]="loading()"
                      [disabled]="!form.controls.newPositionId.value"
                      (onClick)="goFromPosition(activateCallback)"
                    />
                  </div>
                </div>
              </ng-template>
            </p-step-panel>

            <!-- Step 4 — Manager -->
            <p-step-panel [value]="stepValues().manager">
              <ng-template #content let-activateCallback="activateCallback">
                <div class="flex flex-col gap-4 py-3">
                  @if (isPromotion()) {
                    <!-- Derived, read-only — never a caller choice for a
                         promotion (2.6.d). -->
                    <div class="flex flex-col gap-1">
                      <label class="text-sm font-medium">{{ 'user.transfer.newManager' | translate }}</label>
                      <p class="text-sm text-[var(--am-text-primary)]">{{ derivedManagerText() ?? '—' }}</p>
                    </div>
                  } @else {
                    <div class="flex flex-col gap-1">
                      <label class="text-sm font-medium">
                        {{ 'user.transfer.newManager' | translate }} <span class="text-red-500">*</span>
                      </label>
                      <app-overlay-select
                        formControlName="newManagerId"
                        [options]="destinationManagerCandidates()"
                        optionLabel="name"
                        optionValue="id"
                      />
                    </div>
                  }
                  <div class="flex justify-between pt-2">
                    <p-button [label]="'common.back' | translate" severity="secondary" [text]="true" (onClick)="activateCallback(stepValues().position)" />
                    <p-button [label]="'common.next' | translate" (onClick)="goFromManager(activateCallback)" />
                  </div>
                </div>
              </ng-template>
            </p-step-panel>

            <!-- Step 5 — Review & Confirm -->
            <p-step-panel [value]="stepValues().review">
              <ng-template #content let-activateCallback="activateCallback">
                <div class="flex flex-col gap-3 py-3">
                  @if (reviewSummary(); as summary) {
                    <div class="flex flex-col gap-2 text-sm">
                      <div class="flex justify-between">
                        <span class="text-[var(--am-text-secondary)]">{{ 'user.transfer.reviewDestinationUnit' | translate }}</span>
                        <span>{{ summary.destinationUnit }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-[var(--am-text-secondary)]">{{ 'user.transfer.reviewPosition' | translate }}</span>
                        <span>{{ summary.position }}</span>
                      </div>
                      @if (summary.replacement) {
                        <div class="flex justify-between">
                          <span class="text-[var(--am-text-secondary)]">{{ 'user.transfer.reviewReplacement' | translate }}</span>
                          <span>{{ summary.replacement }}</span>
                        </div>
                      }
                      <div class="flex justify-between">
                        <span class="text-[var(--am-text-secondary)]">{{ 'user.transfer.reviewManager' | translate }}</span>
                        <span>{{ summary.manager }}</span>
                      </div>
                    </div>
                  }
                  @if (isPromotion()) {
                    <p-message
                      severity="info"
                      [text]="('user.transfer.reviewPromotionNote' | translate: { name: departingUser()?.name, unit: reviewSummary()?.destinationUnit })"
                    />
                  }
                  <div class="flex justify-between pt-2">
                    <p-button [label]="'common.back' | translate" severity="secondary" [text]="true" (onClick)="activateCallback(stepValues().manager)" [disabled]="submitting()" />
                    <p-button [label]="'common.submit' | translate" [loading]="submitting()" (onClick)="submit()" />
                  </div>
                </div>
              </ng-template>
            </p-step-panel>
          </p-step-panels>
        </p-stepper>
      }
    </form>
  `,
  // Stacked badge-over-label step layout, replacing the earlier
  // shortened-labels-only fix for the 5-step (Replacement-present) case,
  // which still overflowed the dialog by 116px even after shortening
  // (measured live, not estimated). PrimeNG's p-step renders
  // .p-step-number and .p-step-title as sibling <span>s inside
  // .p-step-header with no custom "content" template needed — the
  // default template already has the DOM shape this needs; only the
  // layout (row -> column) and the title's wrap behavior need to change.
  // ::ng-deep is required, not a shortcut avoided elsewhere: confirmed
  // against primeng-stepper.mjs that every stepper sub-component
  // (Step, StepList, StepPanel, ...) uses ViewEncapsulation.None, so
  // .p-step-header/.p-step-title carry no Angular _ngcontent attribute
  // for a plain scoped selector to match. `:host ::ng-deep` is the
  // correct, still-scoped way to reach them: the compiled selector
  // requires an ancestor carrying *this* component's own _ngcontent
  // attribute, so it only ever applies inside this component's own
  // rendered instances — confirmed via grep that p-stepper/p-step is
  // used nowhere else in the frontend, and structurally guaranteed to
  // stay that way even if that changes later (a stepper rendered by any
  // other component has a different host, hence a different attribute,
  // hence never matches this selector).
  styles: [
    `
      :host ::ng-deep .p-step-header {
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 4px;
      }
      :host ::ng-deep .p-step-title {
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        text-align: center;
        line-height: 1.2;
      }
    `,
  ],
})
export class TransferUserWizardComponent implements OnInit {
  readonly userId = input.required<string>();
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly orgUnitHeadService = inject(OrgUnitHeadService);
  private readonly translate = inject(TranslateService);

  readonly currentStep = signal(1);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly departingUser = signal<IUserDto | null>(null);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  readonly transferContext = signal<ITransferContextDto | null>(null);
  readonly sourceUnitCandidates = signal<{ id: string; name: string }[]>([]);
  readonly destinationManagerCandidates = signal<{ id: string; name: string }[]>([]);
  readonly derivedManagerText = signal<string | null>(null);
  readonly submitResult = signal<{ promotionCompleted: boolean; message: string } | null>(null);

  readonly orgUnitCascadeOptions = computed(() => buildOrgUnitCascadeOptions(this.orgUnits(), null, null));

  // Step 2 (Replacement) is conditionally rendered — PrimeNG's p-step
  // displays exactly the [value] it's bound to as its number badge
  // (confirmed against primeng-stepper.mjs: no separate "position in
  // rendered list" concept exists, value IS the display number, same
  // identifier used to correlate p-step <-> p-step-panel). Binding fixed
  // literals (1,3,4,5) meant the user saw a gap whenever Step 2 was
  // hidden. This computed keeps a single source of truth: Position/
  // Manager/Review shift down by one whenever Replacement is absent, so
  // the displayed sequence is always contiguous (1,2,3,4 or 1,2,3,4,5).
  // Safe as computed() (unlike isPromotion/reviewSummary above) because
  // it only reads transferContext(), a real tracked signal dependency.
  readonly stepValues = computed(() => {
    const offset = this.transferContext()?.hasActiveDirectReports ? 0 : -1;
    return { destination: 1, replacement: 2, position: 3 + offset, manager: 4 + offset, review: 5 + offset };
  });

  // Derived from the selected position's own isUnitHeadPosition flag —
  // picking a head-conferring position *is* what makes this a promotion
  // (2.6.b Step 4), mirrored client-side from the same derivation the
  // backend uses.
  //
  // Deliberately a plain writable signal, NOT computed() — a computed()
  // reading form.controls.newPositionId.value directly is an untracked
  // read (FormControl.value is a plain property, not a signal), so it
  // would only re-evaluate when its one real tracked dependency
  // (transferContext()) changes. transferContext() changes exactly once,
  // right after Step 1 — before the user has picked any position in
  // Step 3 — so a computed() here would permanently cache `false` and
  // never reflect the user's actual selection. Same class of bug (and
  // same fix) as invite-user.component.ts's isRootUnitHeadInvite, and as
  // reviewSummary below. Set imperatively in goFromPosition(), the one
  // place newPositionId is finalized before it matters downstream.
  readonly isPromotion = signal(false);

  // Snapshot of the review step's own display values, populated
  // imperatively in goFromManager() — see isPromotion's comment above
  // for why this can't be a computed() reading FormControl values.
  readonly reviewSummary = signal<{
    destinationUnit: string;
    position: string;
    replacement: string | null;
    manager: string;
  } | null>(null);

  readonly form = this.fb.group({
    destinationOrgUnitId: [null as string | null, [Validators.required]],
    replacementUserId: [null as string | null],
    newPositionId: [null as string | null, [Validators.required]],
    newManagerId: [null as string | null],
  });

  ngOnInit(): void {
    this.userService.getById(this.userId()).subscribe({ next: (u) => this.departingUser.set(u) });
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
  }

  // Step 1 -> Step 2 (context load, 2.6.b Step 2 — automatic, not a user
  // action) -> Step 2 or 3 depending on hasActiveDirectReports.
  goFromDestination(activateCallback: (value: number) => void): void {
    const destinationOrgUnitId = this.form.controls.destinationOrgUnitId.value;
    if (!destinationOrgUnitId) return;

    this.error.set(null);
    this.loading.set(true);
    // Destination changed — every downstream selection is stale.
    this.form.patchValue(
      { newPositionId: null, newManagerId: null, replacementUserId: null },
      { emitEvent: false },
    );
    this.derivedManagerText.set(null);
    this.isPromotion.set(false);
    this.reviewSummary.set(null);

    this.userService.getTransferContext(this.userId(), destinationOrgUnitId).subscribe({
      next: (ctx) => {
        this.loading.set(false);
        this.transferContext.set(ctx);
        if (ctx.hasActiveDirectReports) {
          this.loadSourceUnitCandidates();
          activateCallback(this.stepValues().replacement);
        } else {
          activateCallback(this.stepValues().position);
        }
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(extractErrorMessage(err, 'user.transfer.errorContext'));
      },
    });
  }

  // Step 2's own live gate (2.6.b Step 3) — blocks advancing on a real
  // conflict, same as goFromPosition() below.
  goFromReplacement(activateCallback: (value: number) => void): void {
    const replacementUserId = this.form.controls.replacementUserId.value;
    if (!replacementUserId) {
      this.error.set(this.translate.instant('user.transfer.replacementRequired'));
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    this.userService.validateTransferReplacement(this.userId(), { replacementUserId }).subscribe({
      next: () => {
        this.loading.set(false);
        activateCallback(this.stepValues().position);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(extractErrorMessage(err, 'user.transfer.errorReplacement'));
      },
    });
  }

  // Step 3's own live gate (2.6.b Step 4) — the step with genuine
  // multi-user race exposure; blocks advancing on a real conflict rather
  // than silently proceeding on a stale snapshot.
  goFromPosition(activateCallback: (value: number) => void): void {
    const destinationOrgUnitId = this.form.controls.destinationOrgUnitId.value;
    const newPositionId = this.form.controls.newPositionId.value;
    if (!destinationOrgUnitId || !newPositionId) return;

    // Set here, imperatively, the one place newPositionId is finalized —
    // see isPromotion's own declaration comment for why this can't be a
    // computed() reading the FormControl directly.
    this.isPromotion.set(
      this.transferContext()?.availablePositions.find((p) => p.id === newPositionId)?.isUnitHeadPosition ?? false,
    );

    this.error.set(null);
    this.loading.set(true);
    this.userService.validateTransferPosition(this.userId(), { destinationOrgUnitId, newPositionId }).subscribe({
      next: () => {
        this.loading.set(false);
        if (this.isPromotion()) {
          this.loadDerivedManagerText(destinationOrgUnitId);
        } else {
          this.loadDestinationManagerCandidates(destinationOrgUnitId);
          // Auto-default to the destination unit's current Head, still
          // editable afterward — same "not disabled" rule already
          // verified for invite-user.component.ts's own manager picker.
          const headId = this.transferContext()?.currentDestinationHead?.id ?? null;
          this.form.controls.newManagerId.setValue(headId);
        }
        activateCallback(this.stepValues().manager);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(extractErrorMessage(err, 'user.transfer.errorPosition'));
      },
    });
  }

  goFromManager(activateCallback: (value: number) => void): void {
    if (!this.isPromotion() && !this.form.controls.newManagerId.value) {
      this.error.set(this.translate.instant('user.transfer.managerRequired'));
      return;
    }
    this.error.set(null);

    // Snapshot the review step's display values here, imperatively — see
    // reviewSummary's own declaration comment for why this can't be a
    // set of computed()s reading FormControl values directly.
    const destinationOrgUnitId = this.form.controls.destinationOrgUnitId.value;
    const newPositionId = this.form.controls.newPositionId.value;
    const replacementUserId = this.form.controls.replacementUserId.value;
    const newManagerId = this.form.controls.newManagerId.value;
    this.reviewSummary.set({
      destinationUnit: this.orgUnits().find((u) => u.id === destinationOrgUnitId)?.nameEn ?? '—',
      position: this.transferContext()?.availablePositions.find((p) => p.id === newPositionId)?.nameEn ?? '—',
      replacement: replacementUserId
        ? (this.sourceUnitCandidates().find((c) => c.id === replacementUserId)?.name ?? '—')
        : null,
      manager: this.isPromotion()
        ? (this.derivedManagerText() ?? '—')
        : (this.destinationManagerCandidates().find((c) => c.id === newManagerId)?.name ?? '—'),
    });

    activateCallback(this.stepValues().review);
  }

  submit(): void {
    const value = this.form.getRawValue();
    const dto: TransferUserDto = {
      destinationOrgUnitId: value.destinationOrgUnitId!,
      newPositionId: value.newPositionId!,
      // Silently omitted for a promotion — derived server-side (2.6.d),
      // never a caller choice, matching UserService.transferUser()'s own
      // "any caller-supplied newManagerId is silently ignored" rule.
      newManagerId: this.isPromotion() ? undefined : (value.newManagerId ?? undefined),
      replacementUserId: value.replacementUserId ?? undefined,
    };

    this.submitting.set(true);
    this.error.set(null);
    this.userService.transferUser(this.userId(), dto).subscribe({
      next: (result) => {
        this.submitting.set(false);
        const name = this.departingUser()?.name ?? '';
        const unit = this.reviewSummary()?.destinationUnit ?? '—';
        if (result.promotionCompleted === false) {
          this.submitResult.set({
            promotionCompleted: false,
            message: this.translate.instant('user.transfer.promotionPartialFailure', {
              name,
              unit,
              error: result.promotionError ?? '',
            }),
          });
        } else if (this.isPromotion()) {
          this.submitResult.set({
            promotionCompleted: true,
            message: this.translate.instant('user.transfer.promotionSuccess', { name, unit }),
          });
        } else {
          this.submitResult.set({
            promotionCompleted: true,
            message: this.translate.instant('user.transfer.transferSuccess', { name, unit }),
          });
        }
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.error.set(extractErrorMessage(err, 'user.transfer.errorSubmit'));
      },
    });
  }

  private loadSourceUnitCandidates(): void {
    const sourceUnitId = this.departingUser()?.primaryOrgUnitId;
    if (!sourceUnitId) return;
    this.userService.listUsers({ status: 'ACTIVE', orgUnitId: sourceUnitId }).subscribe({
      next: (users) =>
        this.sourceUnitCandidates.set(
          users.filter((u) => u.id !== this.userId()).map((u) => ({ id: u.id, name: u.name })),
        ),
    });
  }

  private loadDestinationManagerCandidates(destinationOrgUnitId: string): void {
    this.userService.listUsers({ status: 'ACTIVE', orgUnitId: destinationOrgUnitId }).subscribe({
      next: (users) => this.destinationManagerCandidates.set(users.map((u) => ({ id: u.id, name: u.name }))),
    });
  }

  // Mirrors the backend's own 2.6.d manager-derivation exactly, for
  // display only — the backend re-derives and re-validates authoritatively
  // at submit time regardless, this is never trusted as the real answer.
  private loadDerivedManagerText(destinationOrgUnitId: string): void {
    const unit = this.orgUnits().find((u) => u.id === destinationOrgUnitId);
    if (!unit) {
      this.derivedManagerText.set(null);
      return;
    }
    if (unit.parentId === null) {
      this.derivedManagerText.set(this.translate.instant('user.transfer.rootPromotionNoManager'));
      return;
    }
    const parentUnitId = unit.parentId;
    const parentUnitName = this.orgUnits().find((u) => u.id === parentUnitId)?.nameEn ?? '';
    this.orgUnitHeadService.getHeadStatus(parentUnitId).subscribe({
      next: (status) => {
        const holder = status.holders[0];
        if (holder) {
          this.derivedManagerText.set(
            this.translate.instant('user.transfer.derivedManager', { name: holder.name, unit: parentUnitName }),
          );
        } else if (status.actingHeadUserId) {
          this.userService.getById(status.actingHeadUserId).subscribe({
            next: (u) =>
              this.derivedManagerText.set(
                this.translate.instant('user.transfer.derivedManagerActing', { name: u.name, unit: parentUnitName }),
              ),
          });
        } else {
          this.derivedManagerText.set(null);
        }
      },
    });
  }
}
