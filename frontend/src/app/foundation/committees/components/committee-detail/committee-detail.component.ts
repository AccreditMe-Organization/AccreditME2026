import { Component, DestroyRef, OnInit, TemplateRef, ViewChild, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { RecordPanelComponent } from '../../../../shared/components/record-panel/record-panel.component';
import { TaskFormComponent } from '../../../tasks/components/task-form/task-form.component';
import { TaskFormFooterComponent } from '../../../tasks/components/task-form/task-form-footer.component';
import { TaskFormStepsComponent } from '../../../tasks/components/task-form/task-form-steps.component';
import { RecordTasksPanelComponent } from '../../../tasks/components/record-tasks-panel/record-tasks-panel.component';
import { CommitteeMembersPanelComponent } from '../committee-members-panel/committee-members-panel.component';
import { CommitteeSubCommitteesPanelComponent } from '../committee-sub-committees-panel/committee-sub-committees-panel.component';
import { WorkflowStageIndicatorComponent } from '../../../workflow/components/workflow-stage-indicator/workflow-stage-indicator.component';
import {
  CommitteeService,
  CommitteeDetailDto,
  CommitteeDto,
  CommitteeListItemDto,
  CommitteeMemberDto,
  CommitteeMemberRowDto,
  CommitteeMembershipEventDto,
} from '../../services/committee.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { UserService, IUserDto } from '../../../user/services/user.service';
// ACC-135 — the owning unit is resolved from the org units; RoleService is gone.
// Its only consumer here was the "reports to a role" label, and the unconditional
// listAllRoles() call it needed is what gave a Quality Manager a 403 on opening
// any committee — rendered as "No results found" in the form's picker.
import { OrgUnitService, OrgUnitDto, orgUnitDisplayName } from '../../../organization/services/org-unit.service';
import { WorkflowService, WorkflowInstanceDto } from '../../../workflow/services/workflow.service';
import { WorkflowTransitionActionsComponent } from '../../../workflow/components/workflow-transition-actions/workflow-transition-actions.component';
import { LanguageService } from '../../../../core/services/language.service';
import { registerPageName } from '../../../../core/services/document-title.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmDatePipe, FormatService } from '../../../../core/formatting';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { CommitteeFormComponent } from '../committee-form/committee-form.component';
import { CommitteeMemberFormComponent } from '../committee-member-form/committee-member-form.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { COMMITTEE_HEADER_GRID, COMMITTEE_PANEL_GRID } from './committee-panel-grid';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { committeeOffers } from '../../committee-offers';
import { CommitteeStageRefusal, committeeStageRefusal } from '../../committee-stage-refusal';
import { ChangeRequestBannerComponent, ChangeRequestBannerState } from '../../change-requests/change-request-banner.component';
import { CommitteeChangeRequestsPanelComponent } from '../../change-requests/committee-change-requests-panel.component';
import { ChangeRequestDto, ChangeRequestService } from '../../change-requests/change-request.service';

/** ACC-174/177 — the task-row dialogs this page opens, one at a time. */
type TaskRowAction = 'edit' | 'cancel' | 'reopen' | 'addEvidence' | 'evidence';

@Component({
  selector: 'app-committee-detail',
  standalone: true,
  imports: [
    TranslatePipe,
    AmDatePipe,
    ButtonModule,
    TagModule,
    MessageModule,
    RecordPanelComponent,
    RouterLink,
    TaskFormComponent,
    TaskFormFooterComponent,
    TaskFormStepsComponent,
    RecordTasksPanelComponent,
    CommitteeMembersPanelComponent,
    CommitteeSubCommitteesPanelComponent,
    WorkflowStageIndicatorComponent,
    CommitteeFormComponent,
    CommitteeMemberFormComponent,
    WorkflowTransitionActionsComponent,
    EditDialogComponent,
    ChangeRequestBannerComponent,
    CommitteeChangeRequestsPanelComponent,
  ],
  template: `
    @if (stageRefusal(); as r) {
      <p-message
        severity="error"
        [text]="r.key | translate: { stage: stageName(r) }"
        data-testid="committee-stage-refusal"
      />
    } @else if (error()) {
      <p-message severity="error" [text]="error()! | translate" />
    }

    @if (committee(); as c) {
      <!-- ACC-76 — built against
           frontend/design-reference/AccreditMe Committee Record.dc.html.
           (Path corrected in ACC-78: the export is a wholesale replacement per
           its own Readme, and it moved the file out of a committee-record/
           subfolder to the reference root.)
           That reference supplies the LAYOUT and information design; colours,
           components and i18n follow this codebase's conventions, not its raw
           HTML (tokens over oklch, p-button over <button>, Inter over IBM Plex,
           every string through ngx-translate).
           Supersedes the two-column tabbed layout at 206d687.

           Reads top to bottom as: what this committee IS (identity + dense
           fact strip), where it is in its lifecycle (stepper + history), what
           it CONTAINS (five equal panels), and how its membership got that way.

           BREAKPOINTS. Panels are auto-fit at a 320px floor, so the row count
           follows available width rather than a hardcoded five: five across
           needs ~1650px of content, which with the 260px sidebar means a
           ~1960px viewport. Below that it degrades 4 -> 3 -> 2 -> 1 with no
           breakage. The fact strip reflows the same way on a 170px basis. -->
      <div class="flex flex-col gap-3">

        <section class="rounded-lg bg-[var(--am-card)] border border-[var(--am-border)]">
          <div class="flex flex-wrap items-start justify-between gap-4 px-[18px] pt-4 pb-3.5">
            <div class="min-w-[280px] flex-1">
              <h1 class="text-2xl font-semibold leading-tight tracking-tight">{{ c.nameEn }}</h1>
              <!-- Both names always, not one selected by language: a
                   bilingual governance record is read by people who need the
                   Arabic name even in an English session. isolate keeps it
                   from reordering the line.

                   ACC-160 — OMITTED when there is no Arabic name. This is a
                   subtitle, not a column: a "—" under a title reads as noise,
                   and the English fallback would only repeat the H1 above it. -->
              @if (c.nameAr) {
                <div
                  dir="rtl"
                  style="unicode-bidi: isolate"
                  class="text-base text-[var(--am-text-secondary)] mt-1 text-start"
                >
                  {{ c.nameAr }}
                </div>
              }
            </div>

            <div class="flex items-center gap-2.5 flex-wrap">
              @if (currentStageName(); as stage) {
                <!-- The live workflow stage. Deliberately NOT StatusBadgeComponent:
                     a stage name is tenant-editable data, so it renders via
                     isArabic() rather than a translate key (SYSTEM-REFERENCE
                     §9.2/§10.2). -->
                <span
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold"
                  style="background: color-mix(in srgb, var(--am-status-approved) 12%, transparent);
                         border: 1px solid color-mix(in srgb, var(--am-status-approved) 35%, transparent);
                         color: var(--am-status-approved)"
                >
                  <span class="w-[7px] h-[7px] rounded-full bg-[var(--am-status-approved)]"></span>
                  {{ stage }}
                </span>
              }
              @if (!c.isActive) {
                <p-tag [value]="'common.inactive' | translate" severity="secondary" />
              }
              @if (currentInstance(); as instance) {
                <app-workflow-transition-actions
                  [instance]="instance"
                  [recordLabel]="displayName(c)"
                  (transitioned)="onWorkflowTransitioned($event)"
                />
              }
              <!-- ACC-238 / ACC-255 — Edit where the server says the stage
                   allows edit_details (Formation, on the seeded workflow), for
                   holders of committees:edit_details (committee-offers.ts),
                   after the transition buttons. -->
              @if (offers().edit) {
                <p-button
                  [label]="'common.edit' | translate"
                  icon="pi pi-pencil"
                  size="small"
                  [outlined]="true"
                  (onClick)="onEdit()"
                  data-testid="committee-edit"
                />
              }
              <!-- ACC-240 — Request a change follows the server's canRaise
                   (its permission, the stage policy and no open request), and
                   shows only once the open read has answered. -->
              @if (openState() === 'ready' && canRaise()) {
                <p-button
                  [label]="'committee.changeRequest.requestChange' | translate"
                  icon="pi pi-file-edit"
                  size="small"
                  [outlined]="true"
                  (onClick)="onRequestChange()"
                  data-testid="committee-request-change"
                />
              }
            </div>
          </div>
          @if (offers().lockedLine) {
            <!-- ACC-238 — Terms Review: read-only. Said to the people who
                 could edit in Formation, so a missing Edit is explained. -->
            <p class="am-cd__locked" data-testid="committee-locked-line">
              <i class="pi pi-lock" aria-hidden="true"></i>
              {{ 'committee.lockedTermsReview' | translate }}
            </p>
          }

          <!-- Dense fact strip, replacing the four stat cards. Six short values
               do not need six bordered boxes; they need to be readable in one
               sweep. -->
          <div class="flex flex-wrap">
            <div class="px-[18px] py-2.5 flex-[2_1_320px] min-w-0 border-t border-e border-[var(--am-border)]">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--am-text-secondary)] mb-1">
                {{ 'committee.purpose' | translate }}
              </div>
              <div class="text-[13px]">{{ c.purpose || '—' }}</div>
            </div>
            <div class="px-[18px] py-2.5 flex-[1_1_170px] min-w-0 border-t border-e border-[var(--am-border)]">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--am-text-secondary)] mb-1">
                {{ 'committee.type' | translate }}
              </div>
              <div class="text-[13px]">{{ typeLabel(c.typeValueId) }}</div>
            </div>
            <div class="px-[18px] py-2.5 flex-[1_1_170px] min-w-0 border-t border-e border-[var(--am-border)]">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--am-text-secondary)] mb-1">
                {{ 'committee.parentCommittee' | translate }}
              </div>
              <div class="text-[13px]">
                @if (c.parentCommitteeId) {
                  <a class="text-[var(--am-blue-primary)]" [routerLink]="['/committees', c.parentCommitteeId]">
                    {{ parentCommitteeName(c) }}
                  </a>
                } @else {
                  —
                }
              </div>
            </div>
            <div class="px-[18px] py-2.5 flex-[1_1_170px] min-w-0 border-t border-e border-[var(--am-border)]">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--am-text-secondary)] mb-1">
                {{ 'committee.owningUnit' | translate }}
              </div>
              <div class="text-[13px]">{{ owningUnitName(c) }}</div>
            </div>
            <div class="px-[18px] py-2.5 flex-[1_1_170px] min-w-0 border-t border-e border-[var(--am-border)]">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--am-text-secondary)] mb-1">
                {{ 'committee.reportingTo' | translate }}
              </div>
              <div class="text-[13px]">{{ reportingToName(c) }}</div>
            </div>
            <div class="px-[18px] py-2.5 flex-[1_1_170px] min-w-0 border-t border-e border-[var(--am-border)]">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--am-text-secondary)] mb-1">
                {{ 'committee.quorumCount' | translate }}
              </div>
              <div
                dir="ltr"
                style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
                class="text-[13px] text-start"
              >
                {{ quorumSummary() }}
              </div>
            </div>
            <div class="px-[18px] py-2.5 flex-[1_1_170px] min-w-0 border-t border-[var(--am-border)]">
              <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--am-text-secondary)] mb-1">
                {{ 'committee.meetingFrequency' | translate }}
              </div>
              <div class="text-[13px]">
                {{ 'committee.frequency.' + c.meetingFrequency.toLowerCase() | translate }}
              </div>
            </div>
          </div>
        </section>

        <!-- Lifecycle and its history, side by side. The stepper takes two
             columns because a six-stage sequence needs the width; the history
             sits beside it rather than below so "where is it" and "how did it
             get there" are read together. -->
        <!-- ACC-240 — the open change request, between the header card and
             the Lifecycle row. -->
        <am-change-request-banner [state]="openState()" [request]="openRequest()" (retry)="loadOpenRequest()" />

        @if (currentInstance(); as instance) {
          <section class="grid gap-3" [style.grid-template-columns]="headerGrid">
            <div
              class="rounded-lg bg-[var(--am-card)] border border-[var(--am-border)] px-[18px] py-3.5 min-w-0"
              style="grid-column: span 2"
            >
              <app-workflow-stage-indicator [instance]="instance" [show]="'sequence'" />
            </div>

            <app-record-panel
              [heading]="'committee.stageHistory' | translate"
              [count]="stageHistoryCount()"
              [bodyHeight]="146"
            >
              <div class="px-4 py-1">
                <app-workflow-stage-indicator
                  [instance]="instance"
                  [show]="'history'"
                  (loaded)="stageHistoryCount.set($event)"
                />
              </div>
            </app-record-panel>
          </section>
        }

        <!-- What the committee contains. Five equal panels: the four surveyor
             checks that need Meetings and Documents are named here even while
             those modules do not exist, because a section that is absent reads
             as a design that never considered it. -->
        <section class="grid gap-3" [style.grid-template-columns]="panelGrid">

          <!-- ACC-230 — Members, capped at five, ordered by seat; Change role and
               Remove in a worded ⋯ menu (Q12), with the same permissions as
               before. The page owns the dialogs. -->
          <app-committee-members-panel
            [committeeId]="committeeId"
            [committeeName]="committee() ? displayName(committee()!) : ''"
            [canAddMember]="offers().addMember"
            [canChangeRole]="offers().changeMemberRole"
            [canRemove]="offers().removeMember"
            (addRequested)="onAddMember()"
            (changeRoleRequested)="onChangeMemberRoleRow($event)"
            (removeRequested)="onRemoveMemberRow($event)"
          />

          <!-- ACC-229 — the record Tasks panel: at most five rows at a fixed
               height, the total in the header, "See all" for the rest. Shown
               to everyone who can see this committee: without View all tasks it is
               "Your tasks on this committee" (Q1) — the server decides which
               tasks, and which actions on each. -->
          <app-record-tasks-panel
            sourceType="COMMITTEE"
            [sourceId]="committeeId"
            [recordName]="committee() ? displayName(committee()!) : ''"
            [canCreate]="canCreateTasks()"
            [soughtTask]="soughtTask()"
            (createRequested)="onAddTask()"
          />

          <!-- ACC-230 — Sub-committees, capped at five, read from this
               committee's own children (no longer a filter of every committee). -->
          <app-committee-sub-committees-panel
            [committeeId]="committeeId"
            [committeeName]="committee() ? displayName(committee()!) : ''"
          />

          <!-- Four of the seven things a surveyor checks for a committee live
               here (module-designs.md:880-887): attendance, quorum
               confirmation, decisions with vote counts, action items. -->
          <app-record-panel
            [heading]="'committee.meetings' | translate"
            [count]="0"
            [isEmpty]="true"
            [emptyTitle]="'committee.noMeetings' | translate"
            [emptyMessage]="'committee.meetingsDescription' | translate"
          />

          <!-- Terms of Reference and reports to the parent body — the other
               two. Committee.termsOfReferenceDocumentId is already in the
               schema, annotated there as unpopulated until Documents ships. -->
          <app-record-panel
            [heading]="'committee.documents' | translate"
            [count]="0"
            [isEmpty]="true"
            [emptyTitle]="'committee.noDocuments' | translate"
            [emptyMessage]="'committee.documentsDescription' | translate"
          />

          <app-record-panel
            [heading]="'committee.membershipHistory' | translate"
            [count]="membershipEvents().length"
            [isEmpty]="membershipEvents().length === 0"
            [emptyTitle]="'committee.noMembershipHistory' | translate"
          >
            @for (event of membershipEvents(); track event.id) {
              <div
                class="grid grid-cols-[8px_1fr_auto] gap-2.5 items-baseline px-4 py-2 border-b border-[var(--am-border)]"
              >
                <span
                  class="w-[7px] h-[7px] rounded-full mt-1.5"
                  [style.background]="membershipEventColor(event.action)"
                ></span>
                <span class="min-w-0 text-[12.5px]">
                  <span class="font-medium">{{ userName(event.userId) }}</span>
                  <span class="text-[var(--am-text-secondary)]">
                    {{ 'committee.action.' + event.action.toLowerCase() | translate }} —
                    {{ memberRoleLabel(event.roleValueId) }}
                  </span>
                  <!-- Who authorised it. A membership log without this is not a
                       compliance trail — resolved from approvedBy against the
                       users already loaded, no extra request. -->
                  @if (approvedByName(event.approvedBy); as approver) {
                    <span class="block text-[11.5px] text-[var(--am-text-secondary)]">{{ approver }}</span>
                  }
                </span>
                <span
                  dir="ltr"
                  style="unicode-bidi: isolate"
                  class="text-[11.5px] whitespace-nowrap text-[var(--am-text-secondary)]"
                >
                  {{ event.effectiveDate | amDate }}
                </span>
              </div>
            }
          </app-record-panel>
          <!-- ACC-240 — last in the grid. -->
          <am-committee-change-requests-panel
            [committeeId]="committeeId"
            [committeeName]="displayName(c)"
            [reloadKey]="changeRequestsReload()"
          />
        </section>
      </div>
    }

    <!-- Declared HERE, not inside the form: p-dialog collects pTemplate
         children at content init, so a footer arriving later never lands. -->
    <!-- The step strip belongs to the HEADER, beside the title and the
         context line, exactly as Template 3 draws it — so it does not change
         when the date view substitutes the body, and costs nothing against
         the 420px body cap. -->
    <ng-template #taskStepsTpl>
      <app-task-form-steps [form]="taskFormRef()" />
    </ng-template>
    <ng-template #taskFooterTpl>
      <app-task-form-footer [form]="taskFormRef()" />
    </ng-template>
    <!-- ACC-238 — the three-tab Edit dialog owns its own dialog shell. -->
    <app-committee-form
      [visible]="formVisible()"
      (visibleChange)="formVisible.set($event)"
      [committee]="committee()"
      (saved)="onCommitteeSaved()"
      (reloaded)="committee.set($event)"
    />

    <ng-template #taskFormTpl>
      @if (committee(); as c) {
        <!-- Source prefilled and locked: the task belongs to this committee,
             so it is not a question to ask. -->
        <app-task-form
          lockedSourceType="COMMITTEE"
          [lockedSourceId]="committeeId"
          [lockedSourceLabel]="displayName(c)"
          (saved)="onTaskSaved()"
          (cancelled)="taskDialog.requestClose()"
          (dirtyChange)="taskFormDirty.set($event)"
        (ready)="taskFormRef.set($event)"
        />
      }
    </ng-template>
    <!-- ACC-96 — [dirty] is an opt-in input on the DIALOG, and task-form sits
         inside it, so the state travels outward through (dirtyChange). Without
         it Escape discards a part-filled task silently. -->
    <app-edit-dialog
      #taskDialog
      [(visible)]="taskFormVisible"
      [header]="'task.newTask' | translate"
      [context]="committee() ? ('task.raisedFrom' | translate: { record: displayName(committee()!) }) : ''"
      [content]="taskFormTpl"
      [dirty]="taskFormDirty()"
      [headerExtra]="taskStepsTpl"
      [footer]="taskFooterTpl"
    />


    <ng-template #memberFormTpl>
      <app-committee-member-form
        [committeeId]="committeeId"
        [member]="editingMember()"
        [activeMembers]="members()"
        (saved)="onMemberSaved()"
        (cancelled)="memberFormVisible.set(false)"
        (dirtyChange)="memberFormDirty.set($event)"
      />
    </ng-template>
    <app-edit-dialog
      [(visible)]="memberFormVisible"
      [header]="(editingMember() ? 'committee.editMemberRole' : 'committee.addMember') | translate"
      [content]="memberFormTpl"
      [dirty]="memberFormDirty()"
    />
  `,
  styles: [
    `
      .am-cd__locked {
        display: flex;
        align-items: center;
        gap: var(--am-space-8);
        margin: 0;
        padding: 0 18px var(--am-space-12);
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
      }
    `,
  ],
})
export class CommitteeDetailComponent implements OnInit {
  /** ACC-232 — never wider than the page; see committee-panel-grid.ts. */
  protected readonly panelGrid = COMMITTEE_PANEL_GRID;
  protected readonly headerGrid = COMMITTEE_HEADER_GRID;

  @ViewChild('memberFormTpl', { read: TemplateRef, static: true }) memberFormTpl!: TemplateRef<unknown>;

  private readonly route = inject(ActivatedRoute);
  private readonly committeeService = inject(CommitteeService);
  private readonly lookupService = inject(LookupService);
  private readonly userService = inject(UserService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly workflowService = inject(WorkflowService);
  private readonly languageService = inject(LanguageService);
  private readonly amConfirm = inject(AmConfirmService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly committeeId = this.route.snapshot.paramMap.get('id')!;

  readonly committee = signal<CommitteeDetailDto | null>(null);

  constructor() {
    // ACC-79 — the browser tab names the committee. This page's H1 lives in its
    // own identity card rather than PageHeaderComponent, so it registers the
    // name directly — in the reader's language, since a tab has room for one.
    registerPageName(() => {
      const c = this.committee();
      return c ? this.displayName(c) : null;
    });
  }
  readonly members = signal<CommitteeMemberDto[]>([]);
  readonly membershipEvents = signal<CommitteeMembershipEventDto[]>([]);
  readonly membersLoading = signal(false);
  readonly error = signal<string | null>(null);
  /** ACC-255 — a change the committee's stage does not allow (STAGE_ACTION_NOT_ALLOWED). */
  readonly stageRefusal = signal<CommitteeStageRefusal | null>(null);

  /** The stage's own name, in the reader's language (English when it has no Arabic). */
  stageName(refusal: CommitteeStageRefusal): string {
    return this.languageService.bilingual(refusal.stageNameEn ?? refusal.stageNameAr ?? '', refusal.stageNameAr);
  }

  readonly allCommittees = signal<CommitteeListItemDto[]>([]);
  readonly committeeTypes = signal<LookupValueDto[]>([]);
  readonly memberRoles = signal<LookupValueDto[]>([]);
  readonly users = signal<IUserDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  readonly currentInstance = signal<WorkflowInstanceDto | null>(null);


  readonly stageHistoryCount = signal<number | null>(null);

  /**
   * ACC-208 (D2) — a "Can't move yet" link names a task by ?task=<id>. Read
   * from the query params as they CHANGE (the link is followed from this same
   * page), then removed so Back and a reload do not repeat it.
   *
   * ACC-229 — handed to the Tasks panel, which highlights the row when it is
   * among its five and otherwise opens All tasks at it. A new object each
   * time, so the same task linked twice is shown twice.
   */
  readonly soughtTask = signal<{ id: string } | null>(null);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tasksPanel = viewChild(RecordTasksPanelComponent);
  private readonly membersPanel = viewChild(CommitteeMembersPanelComponent);

  private watchSoughtTask(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('task');
      if (!id) return;
      this.soughtTask.set({ id });
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { task: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }
  readonly taskFormVisible = signal(false);
  readonly taskFormDirty = signal(false);
  readonly taskFormRef = signal<TaskFormComponent | null>(null);

  // "5 of 9 members" — the configured quorum against who is actually on the
  // committee. Either number alone is half the picture: a quorum of 5 means
  // something different on a committee of 9 than on one of 5.
  readonly quorumSummary = computed(() =>
    this.format.count('committee.quorumOf', this.members().length, {
      quorum: this.committee()?.quorumCount ?? 0,
    }),
  );

  // PANEL-LEVEL PERMISSION GATING. An action is shown only where the caller
  // holds the permission its endpoint requires, rather than shown and failing
  // on click. Client-side only — every one of these is re-checked server-side
  // by PermissionGuard, same contract as WorkflowTransitionActionsComponent's
  // own filtering.
  //
  // Committee's CRUD permissions are action-specific by design (ACC-28): an
  // umbrella committees:manage is seeded holding all eight strings directly,
  // never computed at runtime, so checking the specific string here is correct
  // and not a narrowing.
  readonly canEdit = computed(() => this.navigationAccess.hasPermission('committees:edit_details'));
  // ACC-255 — Edit, the locked line and the member actions: the server's
  // stageRules for the committee's current stage, with each action's own
  // permission (committee-offers.ts). No stage key is read.
  readonly offers = computed(() =>
    committeeOffers(this.committee()?.stageRules, {
      editDetails: this.canEdit(),
      addMember: this.canAddMember(),
      removeMember: this.canRemoveMember(),
      changeMemberRole: this.canChangeMemberRole(),
    }),
  );

  // ACC-240 — the committee's open change request and canRaise, one read.
  private readonly changeRequests = inject(ChangeRequestService);
  readonly openState = signal<ChangeRequestBannerState>('loading');
  readonly openRequest = signal<ChangeRequestDto | null>(null);
  readonly canRaise = signal(false);
  /** Bumped so the Change requests panel reads its list again. */
  readonly changeRequestsReload = signal(0);
  readonly canAddMember = computed(() => this.navigationAccess.hasPermission('committees:add_member'));
  readonly canRemoveMember = computed(() =>
    this.navigationAccess.hasPermission('committees:remove_member'),
  );
  readonly canChangeMemberRole = computed(() =>
    this.navigationAccess.hasPermission('committees:change_member_role'),
  );
  // POST /tasks gates on Create tasks. The button now genuinely works — the
  // form has a real assignee picker as of ACC-76 — so showing it is correct
  // where it was not before.
  // ACC-244 — Create tasks on committees (the record is visible: this is its page).
  readonly canCreateTasks = computed(() => this.navigationAccess.hasPermission('committees:create_tasks'));

  readonly formVisible = signal(false);
  readonly memberFormVisible = signal(false);
  readonly memberFormDirty = signal(false);
  readonly editingMember = signal<CommitteeMemberDto | null>(null);

  ngOnInit(): void {
    this.lookupService.getValues('committee_type').subscribe({ next: (v) => this.committeeTypes.set(v) });
    this.lookupService.getValues('committee_member_role').subscribe({ next: (v) => this.memberRoles.set(v) });
    this.userService.listAllUsers().subscribe({ next: (v) => this.users.set(v) });
    this.orgUnitService.getFlat().subscribe({ next: (v) => this.orgUnits.set(v) });

    this.loadCommitteeList();
    this.loadCommittee();
    this.loadMembers();
    this.loadMembershipEvents();
    this.loadCurrentStage();
    this.loadOpenRequest();
    this.watchSoughtTask();
  }

  displayName(committee: CommitteeDto): string {
    return this.languageService.bilingual(committee.nameEn, committee.nameAr);
  }

  typeLabel(typeValueId: string): string {
    const value = this.committeeTypes().find((v) => v.id === typeValueId);
    if (!value) return typeValueId;
    return this.languageService.bilingual(value.labelEn, value.labelAr);
  }

  memberRoleLabel(roleValueId: string): string {
    const value = this.memberRoles().find((v) => v.id === roleValueId);
    if (!value) return roleValueId;
    return this.languageService.bilingual(value.labelEn, value.labelAr);
  }

  userName(userId: string): string {
    return this.users().find((u) => u.id === userId)?.name ?? userId;
  }

  // "6 members · Monthly" — both facts now come from listCommittees() itself
  // (ACC-76), so a sub-committee row costs no query of its own.

  // Tenant-editable stage name, by language, never `| translate`.
  //
  // ACC-160 — the `?? ''` this replaced hid a blank: in an Arabic session a
  // stage with no Arabic name yielded '', and the compiler could not see it.
  // currentStageNameEn is null only when there is no workflow instance at all.

  // This committee's own live stage, from the same list the page already has.
  readonly currentStageName = computed(() => {
    const self = this.allCommittees().find((c) => c.id === this.committeeId);
    if (!self) return '';
    const en = self.currentStageNameEn;
    return en ? this.languageService.bilingual(en, self.currentStageNameAr) : '';
  });

  // JOINED reads as gain, LEFT as loss, ROLE_CHANGED as neither — semantic
  // status tokens, never brand colours (CLAUDE.md, Brand Design Tokens).
  membershipEventColor(action: string): string {
    if (action === 'JOINED') return 'var(--am-status-approved)';
    if (action === 'LEFT') return 'var(--am-status-rejected)';
    return 'var(--am-blue-primary)';
  }

  // approvedBy is a userId and nullable — not every event needs approval.
  // Resolved against the users this page already loaded, so no extra request.
  approvedByName(approvedBy: string | null): string {
    if (!approvedBy) return '';
    const name = this.users().find((u) => u.id === approvedBy)?.name;
    if (!name) return '';
    this.translate.currentLang();
    return this.translate.instant('committee.approvedBy', { name });
  }

  parentCommitteeName(committee: CommitteeDto): string {
    if (!committee.parentCommitteeId) return '—';
    const parent = this.allCommittees().find((c) => c.id === committee.parentCommitteeId);
    return parent ? this.displayName(parent) : '—';
  }

  reportingToName(committee: CommitteeDto): string {
    if (committee.reportingToCommitteeId) {
      const target = this.allCommittees().find((c) => c.id === committee.reportingToCommitteeId);
      return target ? this.displayName(target) : '—';
    }
    return '—';
  }

  // ACC-135 — the owning unit. Separate from "reports to", and always present on
  // the record even though the column is nullable until the contract migration.
  owningUnitName(committee: CommitteeDto): string {
    if (!committee.orgUnitId) return '—';
    const unit = this.orgUnits().find((u) => u.id === committee.orgUnitId);
    return unit ? orgUnitDisplayName(unit) : '—';
  }

  onEdit(): void {
    this.formVisible.set(true);
  }

  onCommitteeSaved(): void {
    this.loadCommittee();
    this.loadOpenRequest();
    // The committee's own row in allCommittees() is now stale — its name feeds
    // any sibling's parent lookup, and its stage feeds the header pill.
    this.loadCommitteeList();
  }

  onAddMember(): void {
    this.editingMember.set(null);
    this.memberFormVisible.set(true);
  }

  onChangeMemberRole(member: CommitteeMemberDto): void {
    this.editingMember.set(member);
    this.memberFormVisible.set(true);
  }

  onMemberSaved(): void {
    this.memberFormVisible.set(false);
    this.loadMembers();
    this.loadMembershipEvents();
    this.membersPanel()?.reload();
  }

  // ACC-230 — the Members panel asks with its own row; the dialogs take the
  // member as the page holds it (the full active list, loaded for the quorum
  // line and the Add member form).
  onChangeMemberRoleRow(row: CommitteeMemberRowDto): void {
    this.onChangeMemberRole(this.memberFor(row));
  }

  onRemoveMemberRow(row: CommitteeMemberRowDto): void {
    this.onRemoveMember(this.memberFor(row));
  }

  private memberFor(row: CommitteeMemberRowDto): CommitteeMemberDto {
    return (
      this.members().find((m) => m.id === row.id) ?? {
        id: row.id,
        organizationId: '',
        committeeId: this.committeeId,
        userId: row.userId,
        roleValueId: row.roleValueId,
        joinedAt: row.joinedAt,
        leftAt: null,
        isActive: true,
      }
    );
  }

  onAddTask(): void {
    this.taskFormVisible.set(true);
  }

  // ACC-229 — the panel reads its five again; All tasks too, if it is open.
  onTaskSaved(): void {
    this.taskFormVisible.set(false);
    this.tasksPanel()?.reload();
  }

  // ACC-240 — the question names the person; the consequence is the server's:
  // no date is sent, so the membership ends now (committees.service.ts:397,
  // :401–403), and a LEFT event keeps it in the history (:406–413). A person has
  // one name (User.name, no Arabic form), so there is no bilingual choice here.
  onRemoveMember(member: CommitteeMemberDto): void {
    this.amConfirm.ask({
      tone: 'destructive',
      header: this.translate.instant('committee.confirmRemoveMember', { name: this.userName(member.userId) }),
      message: this.translate.instant('committee.confirmRemoveMemberMessage'),
      acceptLabel: this.translate.instant('common.remove'),
      accept: () => {
        this.stageRefusal.set(null);
        this.committeeService.removeMember(this.committeeId, member.id, {}).subscribe({
          next: () => {
            this.loadMembers();
            this.loadMembershipEvents();
            this.membersPanel()?.reload();
          },
          error: (err: unknown) => {
            // ACC-255 — refused by the committee's stage: said, with its name.
            this.stageRefusal.set(committeeStageRefusal(err));
            if (!this.stageRefusal()) this.error.set(extractErrorMessage(err, 'committee.errorAction'));
          },
        });
      },
    });
  }

  // Feeds four things, three of which can change from this page: the header
  // stage pill, the parent-committee name, the reporting-to name, and the
  // sub-committees panel. Loaded once in ngOnInit was the bug.
  /** ACC-240 — the banner's request and the header's canRaise. */
  loadOpenRequest(): void {
    this.openState.set('loading');
    this.changeRequests.open(this.committeeId).subscribe({
      next: (open) => {
        this.openRequest.set(open.request);
        this.canRaise.set(open.canRaise);
        this.openState.set('ready');
      },
      error: () => {
        this.openRequest.set(null);
        this.canRaise.set(false);
        this.openState.set('error');
      },
    });
  }

  onRequestChange(): void {
    void this.router.navigate(['/committees', this.committeeId, 'change-requests', 'new']);
  }

  private loadCommitteeList(): void {
    this.committeeService.listCommittees().subscribe({ next: (v) => this.allCommittees.set(v) });
  }

  private loadCommittee(): void {
    this.committeeService.getById(this.committeeId).subscribe({
      next: (committee) => this.committee.set(committee),
      error: () => this.error.set('committee.errorLoad'),
    });
  }

  private loadMembers(): void {
    this.membersLoading.set(true);
    this.committeeService.listMembers(this.committeeId).subscribe({
      next: (members) => {
        this.members.set(members);
        this.membersLoading.set(false);
      },
      error: () => {
        this.error.set('committee.errorLoad');
        this.membersLoading.set(false);
      },
    });
  }

  private loadMembershipEvents(): void {
    this.committeeService.listMembershipEvents(this.committeeId).subscribe({
      next: (events) => this.membershipEvents.set(events),
    });
  }

  // Fired by WorkflowTransitionActionsComponent (ACC-22) after a successful
  // transition — the trigger response IS the updated instance, so this
  // refreshes the displayed stage without a manual page reload or a
  // redundant re-fetch of the instance itself.
  onWorkflowTransitioned(instance: WorkflowInstanceDto): void {
    this.setCurrentInstance(instance);
    // ACC-238 — the stage KEY decides Edit and the locked line, and it just
    // changed: read the committee again.
    this.loadCommittee();
    // ACC-240 — and with it whether a change may be requested now.
    this.loadOpenRequest();
    this.changeRequestsReload.update((n) => n + 1);
    // ACC-76 — the SECOND instance of the stale-panel bug Ahmad found on the
    // stage timeline, in a different place. The header's stage pill reads
    // currentStageName(), which derives from allCommittees() — loaded once in
    // ngOnInit and never reloaded. Without this the pill still showed the
    // stage the committee was in BEFORE the transition it just made, while
    // the stepper beside it showed the new one.
    this.loadCommitteeList();
  }

  // Current lifecycle stage is read live from the workflow engine, never a
  // stored field on Committee (ACC-22 Pending Discussion #5).
  private loadCurrentStage(): void {
    this.workflowService.getInstancesByObject('COMMITTEE', this.committeeId).subscribe({
      next: (instances) => {
        const instance = instances[0];
        if (instance) this.setCurrentInstance(instance);
      },
    });
  }

  // ACC-76 — this used to load the whole WorkflowTemplate a SECOND time
  // (WorkflowTransitionActionsComponent already loads it) purely to resolve
  // one stage's name for a "Current Stage: X" label. Both the label and that
  // fetch are gone: WorkflowStageIndicatorComponent shows the current stage
  // in the context of the whole path, from its own endpoint. The page now
  // makes one template request instead of two.
  private setCurrentInstance(instance: WorkflowInstanceDto): void {
    this.currentInstance.set(instance);
  }
}
