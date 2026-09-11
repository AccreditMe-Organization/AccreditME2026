import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageModule } from 'primeng/message';
import { ConfirmationService } from 'primeng/api';
import { RecordPanelComponent } from '../../../../shared/components/record-panel/record-panel.component';
import { TaskFormComponent } from '../../../tasks/components/task-form/task-form.component';
import { TaskService, ITaskWithAssigneesDto } from '../../../tasks/services/task.service';
import { WorkflowStageIndicatorComponent } from '../../../workflow/components/workflow-stage-indicator/workflow-stage-indicator.component';
import {
  CommitteeService,
  CommitteeDto,
  CommitteeListItemDto,
  CommitteeMemberDto,
  CommitteeMembershipEventDto,
} from '../../services/committee.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { UserService, IUserDto } from '../../../user/services/user.service';
import { RoleService, RoleDto } from '../../../roles/services/role.service';
import { WorkflowService, WorkflowInstanceDto } from '../../../workflow/services/workflow.service';
import { WorkflowTransitionActionsComponent } from '../../../workflow/components/workflow-transition-actions/workflow-transition-actions.component';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AuthService } from '../../../../core/services/auth.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
import { CommitteeFormComponent } from '../committee-form/committee-form.component';
import { CommitteeMemberFormComponent } from '../committee-member-form/committee-member-form.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';

@Component({
  selector: 'app-committee-detail',
  standalone: true,
  imports: [
    TranslatePipe,
    DatePipe,
    ButtonModule,
    TagModule,
    MessageModule,
    TooltipModule,
    RecordPanelComponent,
    RouterLink,
    TaskFormComponent,
    WorkflowStageIndicatorComponent,
    CommitteeFormComponent,
    CommitteeMemberFormComponent,
    WorkflowTransitionActionsComponent,
    EditDialogComponent,
  ],
  template: `
    @if (error()) {
      <p-message severity="error" [text]="error()! | translate" />
    }

    @if (committee(); as c) {
      <!-- ACC-76 — built against frontend/design-reference/committee-record.
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
                   from reordering the line. -->
              <div
                dir="rtl"
                style="unicode-bidi: isolate"
                class="text-base text-[var(--am-text-secondary)] mt-1 text-start"
              >
                {{ c.nameAr }}
              </div>
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
                  (transitioned)="onWorkflowTransitioned($event)"
                />
              }
              @if (canEdit()) {
                <p-button
                  [label]="'common.edit' | translate"
                  icon="pi pi-pencil"
                  size="small"
                  [outlined]="true"
                  (onClick)="onEdit()"
                />
              }
            </div>
          </div>

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
        @if (currentInstance(); as instance) {
          <section class="grid gap-3" style="grid-template-columns: repeat(auto-fit, minmax(340px, 1fr))">
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
        <section class="grid gap-3" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))">

          <app-record-panel
            [heading]="'committee.members' | translate"
            [count]="members().length"
            [isEmpty]="!membersLoading() && members().length === 0"
            [emptyTitle]="'committee.noMembers' | translate"
            [loading]="membersLoading()"
          >
            @if (canAddMember()) {
              <button
                panelActions
                type="button"
                class="text-[12.5px] text-[var(--am-blue-primary)] hover:underline"
                (click)="onAddMember()"
              >
                {{ 'committee.addMember' | translate }}
              </button>
            }
            @for (member of members(); track member.id) {
              <div
                class="grid grid-cols-[28px_1fr_auto] gap-2.5 items-center px-4 py-2 border-b border-[var(--am-border)]"
              >
                <span
                  class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold"
                  style="background: color-mix(in srgb, var(--am-blue-primary) 12%, transparent);
                         color: var(--am-blue-primary)"
                >
                  {{ initials(userName(member.userId)) }}
                </span>
                <span class="min-w-0">
                  <span class="block text-[13px] font-medium truncate">{{ userName(member.userId) }}</span>
                  <span class="block text-[11.5px] text-[var(--am-text-secondary)] truncate">
                    {{ memberRoleLabel(member.roleValueId) }}
                  </span>
                </span>
                <span class="flex items-center gap-1 shrink-0">
                  @if (canChangeMemberRole()) {
                    <p-button icon="pi pi-pencil" [text]="true" size="small" (onClick)="onChangeMemberRole(member)" />
                  }
                  @if (canRemoveMember()) {
                    <p-button
                      icon="pi pi-times"
                      [text]="true"
                      size="small"
                      severity="danger"
                      (onClick)="onRemoveMember(member)"
                    />
                  }
                </span>
              </div>
            }
          </app-record-panel>

          <!-- Gated on tasks:view, which is what GET /tasks requires — a user
               without it would get a 403 and an empty panel reading as "no
               tasks" when the truth is "not yours to see".

               ACC-76 — rendered HERE rather than by embedding
               TaskListComponent. That component is a full routed page: it
               brings its own p-table, its own type scale and its own column
               widths, so embedded it sat at a different height from its four
               siblings, in a larger font, scrolling horizontally while they
               did not. A summary panel needs four facts — title, assignee, due
               date, overdue — not a table's full column set. -->
          @if (canViewTasks()) {
            <app-record-panel
              [heading]="'committee.tasks' | translate"
              [count]="tasks().length"
              [badge]="overdueBadge()"
              [error]="tasksError()"
              [loading]="tasksLoading()"
              [isEmpty]="!tasksLoading() && tasks().length === 0"
              [emptyTitle]="'task.noTasks' | translate"
            >
              @if (canCreateTasks()) {
                <button
                  panelActions
                  type="button"
                  class="text-[12.5px] text-[var(--am-blue-primary)] hover:underline"
                  (click)="onAddTask()"
                >
                  {{ 'task.newTask' | translate }}
                </button>
              }
              @for (task of tasks(); track task.id) {
                <div
                  class="grid grid-cols-[1fr_auto] gap-2.5 items-center px-4 py-2 border-b border-[var(--am-border)]"
                >
                  <span class="min-w-0">
                    <span class="block text-[13px] font-medium truncate">{{ task.title }}</span>
                    <!-- Status shares the second line rather than taking a chip
                         or a fourth column: at the 320px panel floor in a
                         five-across row there is no width for either. It has to
                         be here, though — dueSummary() deliberately drops the
                         overdue colour for a COMPLETED task, so without status
                         a finished task is indistinguishable from one merely
                         not yet due. -->
                    <span class="block text-[11.5px] text-[var(--am-text-secondary)] truncate">
                      {{ assigneeSummary(task) }} ·
                      {{ 'task.status.' + task.status.toLowerCase() | translate }}
                    </span>
                  </span>
                  <span class="flex items-center gap-2 shrink-0">
                    <!-- Overdue is the one thing worth colouring in a summary:
                         it is the only state that demands action today. -->
                    <span
                      dir="ltr"
                      style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
                      class="text-[11.5px] font-medium whitespace-nowrap"
                      [style.color]="isOverdue(task) ? 'var(--am-severity-critical)' : 'var(--am-text-secondary)'"
                    >
                      {{ dueSummary(task) }}
                    </span>
                    <!-- Shown on rows the caller is actually assigned to, and
                         on no others. NOT permission-gated: completing a task
                         is self-scoped, so POST /tasks/:id/complete carries no
                         @Permissions — the service 404s a non-assignee. Gating
                         this on a permission would hide it from exactly the
                         people entitled to use it (tasks:complete is not
                         seeded to BASE_USER, whom the engine assigns to). -->
                    @if (canComplete(task)) {
                      <p-button
                        icon="pi pi-check"
                        [text]="true"
                        size="small"
                        [pTooltip]="'task.complete' | translate"
                        (onClick)="onCompleteTask(task)"
                      />
                    }
                  </span>
                </div>
              }
            </app-record-panel>
          }

          <app-record-panel
            [heading]="'committee.subCommittees' | translate"
            [count]="subCommittees().length"
            [isEmpty]="subCommittees().length === 0"
            [emptyTitle]="'committee.noSubCommittees' | translate"
          >
            @for (sub of subCommittees(); track sub.id) {
              <div
                class="grid grid-cols-[1fr_auto] gap-2.5 items-center px-4 py-2.5 border-b border-[var(--am-border)]"
              >
                <span class="min-w-0">
                  <a
                    class="block text-[13px] font-medium truncate text-[var(--am-blue-primary)]"
                    [routerLink]="['/committees', sub.id]"
                  >
                    {{ displayName(sub) }}
                  </a>
                  <span class="block text-[11.5px] text-[var(--am-text-secondary)] truncate">
                    {{ subCommitteeMeta(sub) }}
                  </span>
                </span>
                @if (subCommitteeStage(sub); as stage) {
                  <span
                    class="text-[11px] font-semibold whitespace-nowrap rounded px-1.5 py-0.5"
                    style="background: var(--am-surface); color: var(--am-text-secondary)"
                  >
                    {{ stage }}
                  </span>
                }
              </div>
            }
          </app-record-panel>

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
                  {{ event.effectiveDate | date: 'dd MMM y' }}
                </span>
              </div>
            }
          </app-record-panel>
        </section>
      </div>
    }

    <ng-template #committeeFormTpl>
      @if (committee(); as c) {
        <app-committee-form
          [committee]="c"
          (saved)="onCommitteeSaved()"
          (cancelled)="formVisible.set(false)"
        />
      }
    </ng-template>
    <app-edit-dialog
      [(visible)]="formVisible"
      [header]="'committee.editCommittee' | translate"
      [content]="committeeFormTpl"
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
          (cancelled)="taskFormVisible.set(false)"
        />
      }
    </ng-template>
    <app-edit-dialog
      [(visible)]="taskFormVisible"
      [header]="'task.newTask' | translate"
      [content]="taskFormTpl"
    />

    <ng-template #memberFormTpl>
      <app-committee-member-form
        [committeeId]="committeeId"
        [member]="editingMember()"
        [activeMembers]="members()"
        (saved)="onMemberSaved()"
        (cancelled)="memberFormVisible.set(false)"
      />
    </ng-template>
    <app-edit-dialog
      [(visible)]="memberFormVisible"
      [header]="(editingMember() ? 'committee.editMemberRole' : 'committee.addMember') | translate"
      [content]="memberFormTpl"
    />
  `,
})
export class CommitteeDetailComponent implements OnInit {
  @ViewChild('committeeFormTpl', { read: TemplateRef, static: true }) committeeFormTpl!: TemplateRef<unknown>;
  @ViewChild('memberFormTpl', { read: TemplateRef, static: true }) memberFormTpl!: TemplateRef<unknown>;

  private readonly route = inject(ActivatedRoute);
  private readonly committeeService = inject(CommitteeService);
  private readonly lookupService = inject(LookupService);
  private readonly userService = inject(UserService);
  private readonly roleService = inject(RoleService);
  private readonly taskService = inject(TaskService);
  private readonly workflowService = inject(WorkflowService);
  private readonly languageService = inject(LanguageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly authService = inject(AuthService);
  private readonly translate = inject(TranslateService);

  readonly committeeId = this.route.snapshot.paramMap.get('id')!;

  readonly committee = signal<CommitteeDto | null>(null);
  readonly members = signal<CommitteeMemberDto[]>([]);
  readonly membershipEvents = signal<CommitteeMembershipEventDto[]>([]);
  readonly membersLoading = signal(false);
  readonly error = signal<string | null>(null);

  readonly allCommittees = signal<CommitteeListItemDto[]>([]);
  readonly committeeTypes = signal<LookupValueDto[]>([]);
  readonly memberRoles = signal<LookupValueDto[]>([]);
  readonly users = signal<IUserDto[]>([]);
  readonly roles = signal<RoleDto[]>([]);
  readonly currentInstance = signal<WorkflowInstanceDto | null>(null);

  // ACC-76 — derived from listCommittees(), which this page already loaded
  // for the parent-name lookup. No new request — and since ACC-76 that list
  // carries each committee's member count and live stage, so the rows can say
  // what a sub-committee IS without a query per row.
  readonly subCommittees = computed(() =>
    this.allCommittees().filter((c) => c.parentCommitteeId === this.committeeId),
  );

  readonly stageHistoryCount = signal<number | null>(null);

  // ACC-76 — the Tasks panel owns its data directly rather than delegating to
  // TaskListComponent, so it can reload after a create. The embedded list had
  // no way to be told a task had been added.
  readonly tasks = signal<ITaskWithAssigneesDto[]>([]);
  readonly tasksLoading = signal(false);
  readonly tasksError = signal<string | null>(null);
  readonly taskFormVisible = signal(false);

  // "5 of 9 members" — the configured quorum against who is actually on the
  // committee. Either number alone is half the picture: a quorum of 5 means
  // something different on a committee of 9 than on one of 5.
  readonly quorumSummary = computed(() =>
    this.translate.instant('committee.quorumOf', {
      quorum: this.committee()?.quorumCount ?? 0,
      total: this.members().length,
    }),
  );

  // Rendered as a chip beside the Tasks count. Null when nothing is overdue —
  // an explicit "0 overdue" is noise on a panel that is already fine.
  readonly overdueBadge = computed(() => {
    const overdue = this.tasks().filter((t) => this.isOverdue(t)).length;
    if (!overdue) return null;
    this.translate.currentLang();
    return this.translate.instant('task.overdueCount', { count: overdue });
  });

  // A task that is finished or cancelled is not overdue however old its due
  // date — the state that matters is "still owed and past due".
  isOverdue(task: ITaskWithAssigneesDto): boolean {
    if (!task.dueAt || task.status === 'COMPLETED' || task.status === 'CANCELLED') return false;
    return new Date(task.dueAt).getTime() < Date.now();
  }

  // "overdue 6d" or a plain date. The elapsed form is used only when overdue
  // because that is when the magnitude changes what a reader does about it.
  dueSummary(task: ITaskWithAssigneesDto): string {
    if (!task.dueAt) return '—';
    this.translate.currentLang();
    if (this.isOverdue(task)) {
      const days = Math.floor((Date.now() - new Date(task.dueAt).getTime()) / 86_400_000);
      return this.translate.instant('task.overdueBy', { days });
    }
    return new Date(task.dueAt).toLocaleDateString(this.languageService.isArabic() ? 'ar' : 'en-GB', {
      day: '2-digit',
      month: 'short',
    });
  }

  // Names come resolved from the backend (ACC-76), so this needs no user
  // lookup. Beyond two, the names stop being readable in a summary row and a
  // count says more.
  assigneeSummary(task: ITaskWithAssigneesDto): string {
    this.translate.currentLang();
    if (task.assignees.length === 0) return this.translate.instant('task.unassigned');
    if (task.assignees.length <= 2) return task.assignees.map((a) => a.userName).join(', ');
    return this.translate.instant('task.assigneeCount', { count: task.assignees.length });
  }

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
  readonly canAddMember = computed(() => this.navigationAccess.hasPermission('committees:add_member'));
  readonly canRemoveMember = computed(() =>
    this.navigationAccess.hasPermission('committees:remove_member'),
  );
  readonly canChangeMemberRole = computed(() =>
    this.navigationAccess.hasPermission('committees:change_member_role'),
  );
  // GET /tasks requires tasks:view. Without it the panel is hidden entirely
  // rather than shown empty — an empty panel would read as "no tasks" when the
  // truth is "not yours to see".
  readonly canViewTasks = computed(() => this.navigationAccess.hasPermission('tasks:view'));
  // POST /tasks gates on tasks:create. The button now genuinely works — the
  // form has a real assignee picker as of ACC-76 — so showing it is correct
  // where it was not before.
  readonly canCreateTasks = computed(() => this.navigationAccess.hasPermission('tasks:create'));

  readonly formVisible = signal(false);
  readonly memberFormVisible = signal(false);
  readonly editingMember = signal<CommitteeMemberDto | null>(null);

  ngOnInit(): void {
    this.lookupService.getValues('committee_type').subscribe({ next: (v) => this.committeeTypes.set(v) });
    this.lookupService.getValues('committee_member_role').subscribe({ next: (v) => this.memberRoles.set(v) });
    this.userService.listUsers().subscribe({ next: (v) => this.users.set(v) });
    this.roleService.listRoles().subscribe({ next: (v) => this.roles.set(v) });

    this.loadCommitteeList();
    this.loadCommittee();
    this.loadMembers();
    this.loadMembershipEvents();
    this.loadCurrentStage();
    if (this.canViewTasks()) this.loadTasks();
  }

  displayName(committee: CommitteeDto): string {
    return this.languageService.isArabic() ? committee.nameAr : committee.nameEn;
  }

  typeLabel(typeValueId: string): string {
    const value = this.committeeTypes().find((v) => v.id === typeValueId);
    if (!value) return typeValueId;
    return this.languageService.isArabic() ? value.labelAr : value.labelEn;
  }

  memberRoleLabel(roleValueId: string): string {
    const value = this.memberRoles().find((v) => v.id === roleValueId);
    if (!value) return roleValueId;
    return this.languageService.isArabic() ? value.labelAr : value.labelEn;
  }

  userName(userId: string): string {
    return this.users().find((u) => u.id === userId)?.name ?? userId;
  }

  // Two letters from the name, for the member avatar. Takes the first letter
  // of the first and last word so "Dr. Fahad Al-Anazi" reads DA rather than DF
  // — an honorific is not an initial.
  initials(name: string): string {
    const words = name.replace(/^(Dr\.?|Prof\.?|Mr\.?|Ms\.?|Mrs\.?)\s+/i, '').trim().split(/\s+/);
    const first = words[0]?.[0] ?? '';
    const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase();
  }

  // "6 members · Monthly" — both facts now come from listCommittees() itself
  // (ACC-76), so a sub-committee row costs no query of its own.
  subCommitteeMeta(sub: CommitteeListItemDto): string {
    this.translate.currentLang();
    const members = this.translate.instant('committee.memberCount', { count: sub.memberCount });
    const frequency = this.translate.instant(`committee.frequency.${sub.meetingFrequency.toLowerCase()}`);
    return `${members} · ${frequency}`;
  }

  // Tenant-editable stage name: isArabic() selection, never `| translate`.
  subCommitteeStage(sub: CommitteeListItemDto): string {
    return (
      (this.languageService.isArabic() ? sub.currentStageNameAr : sub.currentStageNameEn) ?? ''
    );
  }

  // This committee's own live stage, from the same list the page already has.
  readonly currentStageName = computed(() => {
    const self = this.allCommittees().find((c) => c.id === this.committeeId);
    if (!self) return '';
    return (
      (this.languageService.isArabic() ? self.currentStageNameAr : self.currentStageNameEn) ?? ''
    );
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
    if (committee.reportingToRoleId) {
      const role = this.roles().find((r) => r.id === committee.reportingToRoleId);
      return role ? (this.languageService.isArabic() ? role.nameAr : role.nameEn) : '—';
    }
    return '—';
  }

  onEdit(): void {
    this.formVisible.set(true);
  }

  onCommitteeSaved(): void {
    this.formVisible.set(false);
    this.loadCommittee();
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
  }

  onAddTask(): void {
    this.taskFormVisible.set(true);
  }

  // Assignee-ness ALONE, no permission check — POST /tasks/:id/complete is
  // ungated as of ACC-76 because it is self-scoped, and TaskService.complete()
  // 404s anyone who is not a currently-active assignee. A permission check
  // here would hide the button from the people entitled to use it, since
  // tasks:complete is not seeded to BASE_USER and the engine assigns to
  // BASE_USER tenant-wide.
  //
  // `assignees` carries ACTIVE assignees only (removedAt: null), so someone
  // whose assignment was completed by a colleague or reassigned away is
  // correctly excluded without a second check.
  canComplete(task: ITaskWithAssigneesDto): boolean {
    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return false;
    const me = this.authService.currentUser()?.id;
    return !!me && task.assignees.some((a) => a.userId === me);
  }

  onCompleteTask(task: ITaskWithAssigneesDto): void {
    // Confirmed first: ANY-assignee-completes semantics mean this finishes the
    // task for every other assignee too, not just for the caller.
    this.confirmationService.confirm({
      message: this.translate.instant('task.confirmComplete', { title: task.title }),
      header: this.translate.instant('common.confirm'),
      icon: 'pi pi-check-circle',
      accept: () => {
        this.taskService.complete(task.id).subscribe({
          next: () => this.loadTasks(),
          error: (err: unknown) => this.tasksError.set(extractErrorMessage(err, 'task.errorAction')),
        });
      },
    });
  }

  // The reload Ahmad's live pass found missing. Every panel that can be
  // changed from this page reloads the data it changed — Members and
  // Membership history already did (onMemberSaved above), Tasks could not,
  // because the embedded TaskListComponent had no way to be told.
  onTaskSaved(): void {
    this.taskFormVisible.set(false);
    this.loadTasks();
  }

  private loadTasks(): void {
    this.tasksLoading.set(true);
    this.taskService.getForSource('COMMITTEE', this.committeeId).subscribe({
      next: (tasks) => {
        this.tasks.set(tasks);
        this.tasksLoading.set(false);
      },
      error: () => {
        this.tasksError.set('task.errorLoad');
        this.tasksLoading.set(false);
      },
    });
  }

  onRemoveMember(member: CommitteeMemberDto): void {
    this.confirmationService.confirm({
      message: `${this.languageService.isArabic() ? 'إزالة' : 'Remove'} ${this.userName(member.userId)}?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.committeeService.removeMember(this.committeeId, member.id, {}).subscribe({
          next: () => {
            this.loadMembers();
            this.loadMembershipEvents();
          },
          error: (err: unknown) =>
            this.error.set(extractErrorMessage(err, 'committee.errorAction')),
        });
      },
    });
  }

  // Feeds four things, three of which can change from this page: the header
  // stage pill, the parent-committee name, the reporting-to name, and the
  // sub-committees panel. Loaded once in ngOnInit was the bug.
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
