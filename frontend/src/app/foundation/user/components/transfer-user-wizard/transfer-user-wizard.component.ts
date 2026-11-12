import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, concatMap, from, map, of, toArray } from 'rxjs';
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
import { LanguageService } from '../../../../core/services/language.service';
import { rootUnitNeedsHeadMessage } from '../../../organization/root-unit-refusal';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { FormatService } from '../../../../core/formatting';
import { CommitteeService } from '../../../committees/services/committee.service';
import { committeeStageRefusal } from '../../../committees/committee-stage-refusal';
import {
  TransferCommitteeSeatDto,
  TransferCommitteesDto,
  TransferCommitteesService,
} from '../../services/transfer-committees.service';
import { transferSeatReason } from './transfer-seat-reason';

// ACC-46 Section 2.6.b — the transfer wizard. Pure content, no dialog
// wrapper of its own. Both hosts — the Users list (ACC-79) and the user
// record page (ACC-120 slice 5) — wrap it in EditDialogComponent through a
// TemplateRef, so every opening starts at step one, and bind its
// `dirtyChange` to the shell's `[dirty]`. The raw p-dialog the 2.6.b.1 plan
// section chose is gone from both.
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
//
// ACC-296 — a Committees step between Manager and Review: the person's
// committee seats, each kept or removed. It shows only when the seats read
// (GET /committees/memberships, read ONCE when the wizard opens) returned at
// least one row, or failed for a reason other than a 403 (then with a Try
// again line; it never blocks the transfer). Remove is offered only when the
// committee's stage allows it AND the viewer holds committees:remove_member;
// the transfer permission never grants it. The removes run AFTER the transfer
// returns, one after another, each carrying the wizard's own reason
// (transferSeatReason), and one failure never stops the rest
// (removeSeats()). stepValues() places the step: it, and Review after it,
// shift with both conditional steps.
@Component({
  selector: 'app-transfer-user-wizard',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    MessageModule,
    StepperModule,
    OverlaySelectComponent,
  ],
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
        <!-- ACC-296 — the chosen seat removes, after the transfer. -->
        @if (seatRemoval(); as removal) {
          @if (removal.running) {
            <p class="m-0 text-sm text-[var(--am-text-secondary)]" role="status" data-testid="transfer-seats-running">
              {{ 'user.transfer.committees.removing' | translate }}
            </p>
          } @else if (removal.failed.length === 0) {
            <p-message severity="success" [text]="removedAllText()" data-testid="transfer-seats-done" />
          } @else {
            <div class="flex flex-col gap-2" data-testid="transfer-seats-failed">
              <p-message severity="warn" [text]="someFailedText()" />
              <ul class="m-0 ps-5 text-sm">
                @for (failure of removal.failed; track failure.row.memberId) {
                  <li [attr.data-failed-seat]="failure.row.memberId">
                    <span class="font-medium">{{ committeeName(failure.row) }}</span>: {{ failureText(failure.error) }}
                  </li>
                }
              </ul>
              <div>
                <p-button
                  [label]="'user.transfer.committees.tryAgain' | translate"
                  severity="secondary"
                  [outlined]="true"
                  (onClick)="retryFailedSeats()"
                  data-testid="transfer-seats-retry"
                />
              </div>
            </div>
          }
        }
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
            @if (showsCommittees()) {
              <p-step [value]="stepValues().committees">{{ 'user.transfer.stepCommittees' | translate }}</p-step>
            }
            <p-step [value]="stepValues().review">{{ 'user.transfer.stepReview' | translate }}</p-step>
          </p-step-list>

          <p-step-panels class="am-transfer-panels">
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
                      [options]="positionOptions()"
                      optionLabel="label"
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
                    <p-button [label]="'common.next' | translate" [loading]="loading()" (onClick)="goFromManager(activateCallback)" />
                  </div>
                </div>
              </ng-template>
            </p-step-panel>

            <!-- ACC-296 — Committees (conditional): keep or remove each seat. -->
            @if (showsCommittees()) {
              <p-step-panel [value]="stepValues().committees">
                <ng-template #content let-activateCallback="activateCallback">
                  <div class="am-transfer-committees flex flex-col gap-3 py-3" data-testid="transfer-committees">
                    @if (committeesLoad() === 'failed') {
                      <p class="m-0 text-sm" role="status" data-testid="transfer-committees-failed">
                        {{ 'user.transfer.committees.loadFailed' | translate }}
                      </p>
                      <div>
                        <p-button
                          [label]="'user.transfer.committees.tryAgain' | translate"
                          severity="secondary"
                          [outlined]="true"
                          [loading]="committeesRetrying()"
                          (onClick)="loadCommittees()"
                          data-testid="transfer-committees-retry"
                        />
                      </div>
                    } @else {
                      <p class="m-0 text-sm text-[var(--am-text-secondary)]" data-testid="transfer-committees-intro">
                        {{ 'user.transfer.committees.intro' | translate: { name: departingUser()?.name ?? '' } }}
                      </p>
                      <!-- The list is what grows, so IT scrolls, inside the
                           dialog's 420px body (EditDialogComponent's
                           inner-scroll rule): nothing in it floats. -->
                      <div
                        class="am-transfer-seats"
                        role="region"
                        tabindex="0"
                        [attr.aria-label]="'user.transfer.committees.listLabel' | translate"
                        data-testid="transfer-seats-list"
                      >
                        <ul class="m-0 list-none p-0">
                          @for (seat of seatRows(); track seat.id) {
                            <li class="am-transfer-seat" [attr.data-seat]="seat.id" [attr.data-offer]="seat.offer">
                              <div class="min-w-0 flex-1">
                                <div class="text-[length:var(--am-type-value-size)] leading-[var(--am-type-value-line)] font-semibold text-[var(--am-ink-900)]" [id]="'am-seat-' + seat.id" data-seat-name>{{ seat.name }}</div>
                                <div class="text-[length:var(--am-type-meta-size)] leading-[var(--am-type-meta-line)] text-[var(--am-ink-500)]" data-seat-meta>{{ seat.meta }}</div>
                                @if (seat.offer === 'stage') {
                                  <div class="text-[length:var(--am-type-meta-size)] leading-[var(--am-type-meta-line)] text-[var(--am-ink-500)]" data-seat-why="stage">{{ stageWhy(seat.row) }}</div>
                                }
                                @if (seat.offer === 'permission') {
                                  <div class="text-[length:var(--am-type-meta-size)] leading-[var(--am-type-meta-line)] text-[var(--am-ink-500)]" data-seat-why="permission">
                                    {{ 'user.transfer.committees.noPermission' | translate }}
                                  </div>
                                }
                              </div>
                              @if (seat.offer === 'choice') {
                                <!-- Two radios as one segmented control (stage-who's
                                     pattern). Not p-selectButton: its options are
                                     p-togglebuttons with a bare [ngModel], which
                                     Angular refuses inside this <form> (NG01350). -->
                                <div
                                  class="am-transfer-seat__choice"
                                  role="radiogroup"
                                  [attr.aria-labelledby]="'am-seat-' + seat.id"
                                  [attr.data-seat-choice]="seat.id"
                                >
                                  @for (option of seatOptions; track option.value) {
                                    <label
                                      class="am-transfer-seat__option"
                                      [class.am-transfer-seat__option--on]="seat.choice === option.value"
                                    >
                                      <input
                                        type="radio"
                                        class="sr-only"
                                        [name]="'am-seat-choice-' + seat.id"
                                        [value]="option.value"
                                        [checked]="seat.choice === option.value"
                                        (change)="setSeatChoice(seat.id, option.value)"
                                        [attr.data-choice]="option.value"
                                      />
                                      {{ option.labelKey | translate }}
                                    </label>
                                  }
                                </div>
                              }
                            </li>
                          }
                        </ul>
                        <!-- Inside the list, held at its foot: it stays in view
                             without adding to the body's height. -->
                        @if (overCapText(); as line) {
                          <p class="am-transfer-seats__more" data-testid="transfer-seats-over-cap">{{ line }}</p>
                        }
                      </div>
                    }
                    <div class="flex justify-between pt-2">
                      <p-button
                        [label]="'common.back' | translate"
                        severity="secondary"
                        [text]="true"
                        (onClick)="activateCallback(stepValues().manager)"
                      />
                      <p-button [label]="'common.next' | translate" (onClick)="activateCallback(stepValues().review)" />
                    </div>
                  </div>
                </ng-template>
              </p-step-panel>
            }

            <!-- Step 5 — Review & Confirm -->
            <p-step-panel [value]="stepValues().review">
              <ng-template #content let-activateCallback="activateCallback">
                <div class="flex flex-col gap-3 py-3">
                  @if (reviewSummary(); as summary) {
                    <div class="flex flex-col gap-2 text-sm">
                      <div class="flex justify-between">
                        <span class="text-[var(--am-text-secondary)]">{{ 'user.transfer.reviewDestinationUnit' | translate }}</span>
                        <span data-testid="transfer-review-unit">{{ summary.destinationUnit }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-[var(--am-text-secondary)]">{{ 'user.transfer.reviewPosition' | translate }}</span>
                        <span data-testid="transfer-review-position">{{ summary.position }}</span>
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
                      @if (reviewCommittees(); as committees) {
                        <div class="flex justify-between gap-3" data-testid="transfer-review-committees">
                          <span class="text-[var(--am-text-secondary)]">{{ 'user.transfer.reviewCommittees' | translate }}</span>
                          <span class="text-end">{{ committees.counts }}</span>
                        </div>
                        @if (committees.removedNames.length > 0) {
                          <ul class="m-0 ps-5 text-[var(--am-text-secondary)]" data-testid="transfer-review-removed">
                            @for (committeeName of committees.removedNames; track $index) {
                              <li>{{ committeeName }}</li>
                            }
                          </ul>
                        }
                      }
                    </div>
                  }
                  @if (isPromotion()) {
                    <p-message
                      severity="info"
                      [text]="('user.transfer.reviewPromotionNote' | translate: { name: departingUser()?.name, unit: reviewSummary()?.destinationUnit })"
                    />
                  }
                  <div class="flex justify-between pt-2">
                    <p-button
                      [label]="'common.back' | translate"
                      severity="secondary"
                      [text]="true"
                      (onClick)="activateCallback(showsCommittees() ? stepValues().committees : stepValues().manager)"
                      [disabled]="submitting()"
                    />
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
      /* ACC-296 — the seats list scrolls inside itself so the dialog body
         keeps 20px under its 420px cap (measured in the PR: 1 / 5 / 100 rows,
         both languages, 1280 and 390). The phone height is lower because the
         step list and the intro wrap there. */
      .am-transfer-committees {
        container-type: inline-size;
      }
      /* PrimeNG pads .p-steppanels 18px at the foot, but p-step-panels is an
         inline element, so that padding takes no space and only overflows: the
         dialog body scrolled 18px, with its "more below" cue, on every step.
         Only the foot: the rest of the padding is what spaces the panels today. */
      .am-transfer-panels {
        padding-block-end: 0;
      }
      .am-transfer-seats {
        max-block-size: 136px;
        overflow-y: auto;
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
      }
      @container (max-width: 480px) {
        .am-transfer-seats {
          max-block-size: 112px;
        }
      }
      .am-transfer-seats__more {
        position: sticky;
        inset-block-end: 0;
        margin: 0;
        padding: var(--am-space-4) var(--am-space-12);
        border-block-start: 1px solid var(--am-border);
        background: var(--am-surface-raised);
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-500);
      }
      .am-transfer-seats:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-transfer-seat {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--am-space-8) var(--am-space-12);
        padding: var(--am-space-8) var(--am-space-12);
        border-block-end: 1px solid var(--am-row-rule);
      }
      .am-transfer-seat:last-child {
        border-block-end: 0;
      }
      .am-transfer-seat__choice {
        display: inline-flex;
        flex: none;
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-control);
        overflow: hidden;
      }
      .am-transfer-seat__option {
        padding: var(--am-space-2) var(--am-space-12);
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-700);
        background: var(--am-control-bg);
        cursor: pointer;
      }
      .am-transfer-seat__option + .am-transfer-seat__option {
        border-inline-start: 1px solid var(--am-control-border);
      }
      .am-transfer-seat__option--on {
        color: var(--am-surface-raised);
        background: var(--am-primary-600);
        font-weight: 600;
      }
      .am-transfer-seat__option:has(input:focus-visible) {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
    `,
  ],
})
export class TransferUserWizardComponent implements OnInit {
  readonly userId = input.required<string>();
  readonly saved = output<void>();
  readonly cancelled = output<void>();
  /**
   * ACC-120 slice 5 — whether a choice has been made and not yet saved, so the
   * host's dialog shell can ask before Escape or ✕ throws it away. False again
   * once the transfer has gone through: the result screen holds nothing to
   * lose.
   */
  readonly dirtyChange = output<boolean>();
  private readonly destroyRef = inject(DestroyRef);

  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly orgUnitHeadService = inject(OrgUnitHeadService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly access = inject(NavigationAccessService);
  private readonly format = inject(FormatService);
  private readonly committeeService = inject(CommitteeService);
  private readonly transferCommittees = inject(TransferCommitteesService);

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
  // Safe as computed() (unlike isPromotion/reviewPicks below) because
  // it only reads transferContext(), a real tracked signal dependency.
  //
  // ACC-296 — the Committees step sits between Manager and Review, and is
  // conditional too: Review moves up one more when it shows.
  readonly stepValues = computed(() => {
    const offset = this.transferContext()?.hasActiveDirectReports ? 0 : -1;
    const committees = this.showsCommittees() ? 1 : 0;
    return {
      destination: 1,
      replacement: 2,
      position: 3 + offset,
      manager: 4 + offset,
      committees: 5 + offset,
      review: 5 + offset + committees,
    };
  });

  // ── ACC-296 — the person's committee seats ─────────────────────────────
  /** loading → ready (200), forbidden (403: not this caller's to see), or failed. */
  readonly committeesLoad = signal<'loading' | 'ready' | 'forbidden' | 'failed'>('loading');
  readonly committees = signal<TransferCommitteesDto | null>(null);
  readonly committeesRetrying = signal(false);
  /** Manager's Next, pressed while the read was still loading, waits for it. */
  private afterCommitteesLoad: (() => void) | null = null;

  /** Present with a row to decide, or with the failure line; absent for 0 rows or a 403. */
  readonly showsCommittees = computed(() => {
    const state = this.committeesLoad();
    return state === 'failed' || (state === 'ready' && (this.committees()?.rows.length ?? 0) > 0);
  });

  /** Removing a seat stays with this permission; the transfer permission never grants it. */
  readonly canRemoveSeats = computed(() => this.access.hasPermission('committees:remove_member'));

  readonly seatOptions = [
    { value: 'keep', labelKey: 'user.transfer.committees.keep' },
    { value: 'remove', labelKey: 'user.transfer.committees.remove' },
  ] as const;

  /** memberId → the admin's choice. Absent means Keep. */
  readonly seatChoices = signal<ReadonlyMap<string, 'keep' | 'remove'>>(new Map());

  readonly seatRows = computed(() =>
    (this.committees()?.rows ?? []).map((row) => {
      const stage = this.stageName(row);
      const seat = this.language.bilingual(row.seat.labelEn, row.seat.labelAr);
      // No permission says so first (it is true of every row); otherwise a
      // stage that does not allow removing says why.
      const offer: 'choice' | 'stage' | 'permission' = !this.canRemoveSeats()
        ? 'permission'
        : !row.mayRemove
          ? 'stage'
          : 'choice';
      return {
        id: row.memberId,
        row,
        name: this.committeeName(row),
        meta: stage ? `${seat} · ${stage}` : seat,
        offer,
        choice: offer === 'choice' ? (this.seatChoices().get(row.memberId) ?? 'keep') : 'keep',
      };
    }),
  );

  /** The seats to remove: only a row that offered the choice, set to Remove. */
  readonly seatsToRemove = computed(() =>
    this.seatRows()
      .filter((seat) => seat.offer === 'choice' && seat.choice === 'remove')
      .map((seat) => seat.row),
  );

  /** "Showing 100 of 140. Remove the others from each committee's page." */
  readonly overCapText = computed(() => {
    const dto = this.committees();
    if (!dto || dto.total <= dto.rows.length) return null;
    return this.format.count('user.transfer.committees.overCap', dto.total, { shown: this.format.number(dto.rows.length) });
  });

  /** Review's line: only once the seats were read and shown. */
  readonly reviewCommittees = computed(() => {
    if (!this.showsCommittees() || this.committeesLoad() !== 'ready') return null;
    const removed = this.seatsToRemove();
    const kept = Math.max(0, (this.committees()?.total ?? 0) - removed.length);
    return {
      counts: `${this.format.count('user.transfer.committees.reviewKeep', kept)} · ${this.format.count('user.transfer.committees.reviewRemove', removed.length)}`,
      removedNames: removed.map((row) => this.committeeName(row)),
    };
  });

  /** After Submit: the removes, running or done, and the rows that failed. */
  readonly seatRemoval = signal<{
    running: boolean;
    removed: number;
    failed: { row: TransferCommitteeSeatDto; error: unknown }[];
  } | null>(null);
  /** Written ONCE at Submit, reused for Try again (a language switch cannot change it). */
  private seatReason = '';

  readonly removedAllText = computed(() =>
    this.format.count('user.transfer.committees.removedAll', this.seatRemoval()?.removed ?? 0),
  );
  readonly someFailedText = computed(() =>
    this.format.count('user.transfer.committees.someFailed', this.seatRemoval()?.failed.length ?? 0),
  );

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
  // reviewPicks below. Set imperatively in goFromPosition(), the one
  // place newPositionId is finalized before it matters downstream.
  readonly isPromotion = signal(false);

  // Snapshot of what the review step shows, taken imperatively in
  // goFromManager() — see isPromotion's comment above for why this can't be
  // a computed() reading FormControl values. ACC-296: it keeps the picked
  // unit and position by id, and reviewSummary names them in the reader's
  // language (LanguageService.bilingual reads a signal), so Review, the
  // promotion note and the success message follow a language switch.
  private readonly reviewPicks = signal<{
    destinationOrgUnitId: string | null;
    newPositionId: string | null;
    replacement: string | null;
    manager: string;
  } | null>(null);

  readonly reviewSummary = computed(() => {
    const picks = this.reviewPicks();
    if (!picks) return null;
    const unit = this.orgUnits().find((u) => u.id === picks.destinationOrgUnitId);
    const position = this.transferContext()?.availablePositions.find((p) => p.id === picks.newPositionId);
    return {
      destinationUnit: unit ? this.language.bilingual(unit.nameEn, unit.nameAr) : '—',
      position: position ? this.language.bilingual(position.nameEn, position.nameAr) : '—',
      replacement: picks.replacement,
      manager: picks.manager,
    };
  });

  // ACC-296 — the position picker's labels, in the reader's language.
  readonly positionOptions = computed(() =>
    (this.transferContext()?.availablePositions ?? []).map((p) => ({
      id: p.id,
      label: this.language.bilingual(p.nameEn, p.nameAr),
    })),
  );

  readonly form = this.fb.group({
    destinationOrgUnitId: [null as string | null, [Validators.required]],
    replacementUserId: [null as string | null],
    newPositionId: [null as string | null, [Validators.required]],
    newManagerId: [null as string | null],
  });

  ngOnInit(): void {
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.dirtyChange.emit(this.form.dirty && !this.submitResult()));
    this.userService.getById(this.userId()).subscribe({ next: (u) => this.departingUser.set(u) });
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
    // ACC-296 — once, beside the other loads. No polling.
    this.loadCommittees();
  }

  /** The seats read: on open, and again only when the admin presses Try again. */
  loadCommittees(): void {
    if (this.committeesLoad() === 'failed') this.committeesRetrying.set(true);
    this.transferCommittees
      .forUser(this.userId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dto) => {
          this.committees.set(dto);
          this.committeesLoad.set('ready');
          this.committeesLoaded();
        },
        error: (err: unknown) => {
          // A 403 is "not this caller's to see": the step is absent and nothing is said.
          this.committeesLoad.set(err instanceof HttpErrorResponse && err.status === 403 ? 'forbidden' : 'failed');
          this.committeesLoaded();
        },
      });
  }

  private committeesLoaded(): void {
    this.committeesRetrying.set(false);
    const then = this.afterCommitteesLoad;
    this.afterCommitteesLoad = null;
    then?.();
  }

  setSeatChoice(memberId: string, choice: 'keep' | 'remove'): void {
    const next = new Map(this.seatChoices());
    next.set(memberId, choice);
    this.seatChoices.set(next);
    if (!this.submitResult()) this.dirtyChange.emit(true);
  }

  committeeName(row: TransferCommitteeSeatDto): string {
    return this.language.bilingual(row.nameEn, row.nameAr);
  }

  private stageName(row: TransferCommitteeSeatDto): string {
    return row.stage.nameEn || row.stage.nameAr ? this.language.bilingual(row.stage.nameEn ?? '', row.stage.nameAr) : '';
  }

  /** Why a seat cannot be removed in its stage: the committee screens' own sentence. */
  stageWhy(row: TransferCommitteeSeatDto): string {
    const stage = this.stageName(row);
    return stage
      ? (this.translate.instant('committee.refusal.membersNotAllowedInStage', { stage }) as string)
      : (this.translate.instant('committee.refusal.membersNotAllowedNoStage') as string);
  }

  /** One failed remove, said for the admin: the stage refusal, no longer a member, or the server's error. */
  failureText(error: unknown): string {
    const stage = committeeStageRefusal(error);
    if (stage) {
      const name =
        stage.stageNameEn || stage.stageNameAr ? this.language.bilingual(stage.stageNameEn ?? '', stage.stageNameAr) : '';
      return this.translate.instant(stage.key, { stage: name }) as string;
    }
    if (error instanceof HttpErrorResponse && error.status === 404) {
      return this.translate.instant('user.transfer.committees.notMember') as string;
    }
    return this.translate.instant(extractErrorMessage(error, 'user.transfer.committees.removeFailed')) as string;
  }

  /**
   * ACC-296 — THE one place seats are removed. One after another (concatMap),
   * each with its own catchError, so one failure never stops the rest. Every
   * DELETE carries the wizard's reason. Called only after the transfer
   * returned, and by Try again with the failed rows alone.
   */
  removeSeats(rows: readonly TransferCommitteeSeatDto[], reason: string): void {
    if (rows.length === 0) return;
    const before = this.seatRemoval();
    this.seatRemoval.set({ running: true, removed: before?.removed ?? 0, failed: before?.failed ?? [] });
    from(rows)
      .pipe(
        concatMap((row) =>
          this.committeeService.removeMember(row.committeeId, row.memberId, { reason }).pipe(
            map(() => ({ row, ok: true as const, error: null as unknown })),
            catchError((error: unknown) => of({ row, ok: false as const, error })),
          ),
        ),
        toArray(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((outcomes) => {
        const failed = outcomes.filter((outcome) => !outcome.ok).map(({ row, error }) => ({ row, error }));
        this.seatRemoval.set({
          running: false,
          removed: (before?.removed ?? 0) + outcomes.length - failed.length,
          failed,
        });
      });
  }

  /** Try again: ONLY the rows that failed, with the reason written at Submit. */
  retryFailedSeats(): void {
    const failed = this.seatRemoval()?.failed.map((failure) => failure.row) ?? [];
    this.removeSeats(failed, this.seatReason);
  }

  /** The reason for the removes, from the units' names in the admin's language. */
  private buildSeatReason(): string {
    const sourceId = this.departingUser()?.primaryOrgUnitId ?? null;
    const destinationId = this.form.controls.destinationOrgUnitId.value;
    const unitName = (id: string | null): string => {
      const unit = this.orgUnits().find((u) => u.id === id);
      return unit ? this.language.bilingual(unit.nameEn, unit.nameAr) : '—';
    };
    return transferSeatReason(this.translate, {
      from: unitName(sourceId),
      to: unitName(destinationId),
      sameUnit: !!sourceId && sourceId === destinationId,
    });
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
    this.reviewPicks.set(null);

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

    // Snapshot the review step's picks here, imperatively — see
    // reviewPicks's own declaration comment for why this can't be a
    // set of computed()s reading FormControl values directly.
    const destinationOrgUnitId = this.form.controls.destinationOrgUnitId.value;
    const newPositionId = this.form.controls.newPositionId.value;
    const replacementUserId = this.form.controls.replacementUserId.value;
    const newManagerId = this.form.controls.newManagerId.value;
    this.reviewPicks.set({
      destinationOrgUnitId,
      newPositionId,
      replacement: replacementUserId
        ? (this.sourceUnitCandidates().find((c) => c.id === replacementUserId)?.name ?? '—')
        : null,
      manager: this.isPromotion()
        ? (this.derivedManagerText() ?? '—')
        : (this.destinationManagerCandidates().find((c) => c.id === newManagerId)?.name ?? '—'),
    });

    // ACC-296 — to Committees when it shows, else Review. A seats read still
    // loading is waited for, so the next step is the right one.
    const advance = (): void =>
      activateCallback(this.showsCommittees() ? this.stepValues().committees : this.stepValues().review);
    if (this.committeesLoad() === 'loading') {
      this.loading.set(true);
      this.afterCommitteesLoad = () => {
        this.loading.set(false);
        advance();
      };
      return;
    }
    advance();
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

    // ACC-296 — what to remove and why, fixed now: the reason is written once.
    const seatsToRemove = this.seatsToRemove();
    this.seatReason = this.buildSeatReason();

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
          this.dirtyChange.emit(false);
        } else if (this.isPromotion()) {
          this.submitResult.set({
            promotionCompleted: true,
            message: this.translate.instant('user.transfer.promotionSuccess', { name, unit }),
          });
          this.dirtyChange.emit(false);
        } else {
          this.submitResult.set({
            promotionCompleted: true,
            message: this.translate.instant('user.transfer.transferSuccess', { name, unit }),
          });
          this.dirtyChange.emit(false);
        }
        // ACC-296 — the transfer returned (whichever branch, the promotion's
        // partial failure included): now the chosen seats. Never before, and
        // never when the transfer failed.
        this.removeSeats(seatsToRemove, this.seatReason);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        // ACC-288 — moving the root unit's last head out is refused; said here, in the wizard.
        this.error.set(
          rootUnitNeedsHeadMessage(err, this.translate, this.language) ??
            extractErrorMessage(err, 'user.transfer.errorSubmit'),
        );
      },
    });
  }

  private loadSourceUnitCandidates(): void {
    const sourceUnitId = this.departingUser()?.primaryOrgUnitId;
    if (!sourceUnitId) return;
    this.userService.listAllUsers({ status: 'ACTIVE', orgUnitId: sourceUnitId }).subscribe({
      next: (users) =>
        this.sourceUnitCandidates.set(
          users.filter((u) => u.id !== this.userId()).map((u) => ({ id: u.id, name: u.name })),
        ),
    });
  }

  private loadDestinationManagerCandidates(destinationOrgUnitId: string): void {
    this.userService.listAllUsers({ status: 'ACTIVE', orgUnitId: destinationOrgUnitId }).subscribe({
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
    const parentUnit = this.orgUnits().find((u) => u.id === parentUnitId);
    const parentUnitName = parentUnit ? this.language.bilingual(parentUnit.nameEn, parentUnit.nameAr) : '';
    this.orgUnitHeadService.getHeadStatus(parentUnitId).subscribe({
      next: (status) => {
        const holder = status.holders[0];
        if (holder) {
          this.derivedManagerText.set(
            // ACC-133 / D7 — the name is null for a caller without users:view.
            this.translate.instant('user.transfer.derivedManager', {
              name: holder.name ?? this.translate.instant('headship.head.assigned'),
              unit: parentUnitName,
            }),
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
