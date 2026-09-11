import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { ConfirmationService } from 'primeng/api';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { RecordPanelComponent } from '../../../../shared/components/record-panel/record-panel.component';
import { TaskListComponent } from '../../../tasks/components/task-list/task-list.component';
import { WorkflowStageIndicatorComponent } from '../../../workflow/components/workflow-stage-indicator/workflow-stage-indicator.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import {
  CommitteeService,
  CommitteeDto,
  CommitteeMemberDto,
  CommitteeMembershipEventDto,
} from '../../services/committee.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { UserService, IUserDto } from '../../../user/services/user.service';
import { RoleService, RoleDto } from '../../../roles/services/role.service';
import { WorkflowService, WorkflowInstanceDto } from '../../../workflow/services/workflow.service';
import { WorkflowTransitionActionsComponent } from '../../../workflow/components/workflow-transition-actions/workflow-transition-actions.component';
import { LanguageService } from '../../../../core/services/language.service';
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
    TableModule,
    TagModule,
    MessageModule,
    CardComponent,
    RecordPanelComponent,
    RouterLink,
    TaskListComponent,
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
      <div class="flex flex-col gap-6">
        <div class="flex items-start justify-between">
          <div>
            <h2 class="text-xl font-semibold">{{ displayName(c) }}</h2>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ typeLabel(c.typeValueId) }}</p>
            @if (currentInstance(); as instance) {
              <app-workflow-transition-actions
                class="block mt-2"
                [instance]="instance"
                (transitioned)="onWorkflowTransitioned($event)"
              />
            }
          </div>
          <div class="flex gap-2">
            @if (!c.isActive) {
              <p-tag [value]="'common.inactive' | translate" severity="secondary" />
            }
            <p-button [label]="'common.edit' | translate" icon="pi pi-pencil" [text]="true" (onClick)="onEdit()" />
          </div>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <app-card>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'committee.quorumCount' | translate }}</p>
            <p class="text-lg font-semibold">{{ c.quorumCount }}</p>
          </app-card>
          <app-card>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'committee.meetingFrequency' | translate }}</p>
            <p class="text-lg font-semibold">{{ c.meetingFrequency }}</p>
          </app-card>
          <app-card>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'committee.parentCommittee' | translate }}</p>
            <p class="text-lg font-semibold">{{ parentCommitteeName(c) }}</p>
          </app-card>
          <app-card>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'committee.reportingTo' | translate }}</p>
            <p class="text-lg font-semibold">{{ reportingToName(c) }}</p>
          </app-card>
        </div>

        @if (c.purpose) {
          <app-card>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'committee.purpose' | translate }}</p>
            <p>{{ c.purpose }}</p>
          </app-card>
        }

        <!-- ACC-76 — the object-detail pattern. Every panel fetches on its own
             and fails on its own: a 403 on one (a user without tasks:view,
             say) leaves the rest of the page intact.

             The Meetings and Documents panels are REAL sections with empty
             states, not "coming soon" scaffolding. An empty Documents panel
             says something true — Committee.termsOfReferenceDocumentId is in
             the schema today and unpopulated — whereas placeholder styling
             would say the page is unfinished. Same information, different
             message. -->
        @if (currentInstance(); as instance) {
          <app-record-panel [heading]="'committee.lifecycle' | translate">
            <app-workflow-stage-indicator [instanceId]="instance.id" />
          </app-record-panel>
        }

        <app-record-panel
          [heading]="'committee.tasks' | translate"
          [count]="taskList.taskCount()"
          [error]="taskList.loadError()"
        >
          @if (canCreateTasks()) {
            <p-button
              panelActions
              [label]="'task.newTask' | translate"
              icon="pi pi-plus"
              size="small"
              (onClick)="taskList.onAdd()"
            />
          }
          <!-- Source is locked to this committee in the create dialog — see
               task-form. The list renders its own loading and empty states, so
               the panel is given neither. -->
          <app-task-list
            #taskList
            [embedded]="true"
            sourceType="COMMITTEE"
            [sourceId]="committeeId"
            [sourceLabel]="displayName(c)"
          />
        </app-record-panel>

        <app-record-panel
          [heading]="'committee.subCommittees' | translate"
          [count]="subCommittees().length"
          [isEmpty]="subCommittees().length === 0"
          [emptyMessage]="'committee.noSubCommittees' | translate"
        >
          <div class="flex flex-col gap-2">
            @for (sub of subCommittees(); track sub.id) {
              <a
                class="flex items-center justify-between p-2 rounded-md border border-[var(--am-border)] text-sm hover:border-[var(--am-blue-primary)]"
                [routerLink]="['/committees', sub.id]"
              >
                <span>{{ displayName(sub) }}</span>
                <span class="text-[var(--am-text-secondary)]">{{ typeLabel(sub.typeValueId) }}</span>
              </a>
            }
          </div>
        </app-record-panel>

        <!-- Four of the seven things an accreditation surveyor checks for a
             committee live here (module-designs.md:880-887): attendance per
             meeting, quorum confirmation, decisions with vote counts, and
             action items tracked to completion. -->
        <app-record-panel
          [heading]="'committee.meetings' | translate"
          [description]="'committee.meetingsDescription' | translate"
          [isEmpty]="true"
          [emptyMessage]="'committee.noMeetings' | translate"
        />

        <!-- Terms of Reference and reporting evidence — the remaining two
             surveyor checks. Committee.termsOfReferenceDocumentId already
             exists in the schema, annotated there as unpopulated until
             Document Management ships. -->
        <app-record-panel
          [heading]="'committee.documents' | translate"
          [description]="'committee.documentsDescription' | translate"
          [isEmpty]="true"
          [emptyMessage]="'committee.noDocuments' | translate"
        />

        <hr />

        <div class="flex items-center justify-between">
          <h3 class="text-lg font-medium">{{ 'committee.members' | translate }}</h3>
          <p-button
            [label]="'committee.addMember' | translate"
            icon="pi pi-plus"
            size="small"
            (onClick)="onAddMember()"
          />
        </div>

        <p-table [value]="members()" [loading]="membersLoading()" styleClass="w-full">
          <ng-template pTemplate="header">
            <tr>
              <th>{{ 'committee.member' | translate }}</th>
              <th>{{ 'committee.memberRole' | translate }}</th>
              <th>{{ 'committee.joinedAt' | translate }}</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-member>
            <tr>
              <td>{{ userName(member.userId) }}</td>
              <td>{{ memberRoleLabel(member.roleValueId) }}</td>
              <td>{{ member.joinedAt | date: 'mediumDate' }}</td>
              <td>
                <div class="flex gap-1 justify-end">
                  <p-button icon="pi pi-pencil" [text]="true" size="small" (onClick)="onChangeMemberRole(member)" />
                  <p-button
                    icon="pi pi-times"
                    [text]="true"
                    size="small"
                    severity="danger"
                    (onClick)="onRemoveMember(member)"
                  />
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4" class="text-center py-6 text-[var(--am-text-secondary)]">
                {{ 'committee.noMembers' | translate }}
              </td>
            </tr>
          </ng-template>
        </p-table>

        <hr />

        <h3 class="text-lg font-medium">{{ 'committee.membershipHistory' | translate }}</h3>
        @if (membershipEvents().length === 0) {
          <p class="text-sm text-[var(--am-text-secondary)]">{{ 'committee.noMembershipHistory' | translate }}</p>
        }
        <div class="flex flex-col gap-2">
          @for (event of membershipEvents(); track event.id) {
            <div class="flex items-center justify-between p-2 rounded-md border border-[var(--am-border)] text-sm">
              <span>
                {{ userName(event.userId) }} —
                {{ ('committee.action.' + event.action.toLowerCase()) | translate }} —
                {{ memberRoleLabel(event.roleValueId) }}
              </span>
              <span class="text-[var(--am-text-secondary)]">{{ event.effectiveDate | date: 'mediumDate' }}</span>
            </div>
          }
        </div>
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
  private readonly workflowService = inject(WorkflowService);
  private readonly languageService = inject(LanguageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly navigationAccess = inject(NavigationAccessService);

  readonly committeeId = this.route.snapshot.paramMap.get('id')!;

  readonly committee = signal<CommitteeDto | null>(null);
  readonly members = signal<CommitteeMemberDto[]>([]);
  readonly membershipEvents = signal<CommitteeMembershipEventDto[]>([]);
  readonly membersLoading = signal(false);
  readonly error = signal<string | null>(null);

  readonly allCommittees = signal<CommitteeDto[]>([]);
  readonly committeeTypes = signal<LookupValueDto[]>([]);
  readonly memberRoles = signal<LookupValueDto[]>([]);
  readonly users = signal<IUserDto[]>([]);
  readonly roles = signal<RoleDto[]>([]);
  readonly currentInstance = signal<WorkflowInstanceDto | null>(null);

  // ACC-76 — derived from listCommittees(), which this page already loaded
  // for the parent-name lookup. No new request.
  readonly subCommittees = computed(() =>
    this.allCommittees().filter((c) => c.parentCommitteeId === this.committeeId),
  );

  // Panel-level gating, matching ACC-70's route guarding: GET /tasks is
  // gated on tasks:view and POST /tasks on tasks:create, so a user without
  // tasks:create sees the list but not the button. Client-side only — the
  // backend re-checks regardless, same contract as
  // WorkflowTransitionActionsComponent's own filtering.
  readonly canCreateTasks = computed(() =>
    this.navigationAccess.hasPermission('tasks:create'),
  );

  readonly formVisible = signal(false);
  readonly memberFormVisible = signal(false);
  readonly editingMember = signal<CommitteeMemberDto | null>(null);

  ngOnInit(): void {
    this.lookupService.getValues('committee_type').subscribe({ next: (v) => this.committeeTypes.set(v) });
    this.lookupService.getValues('committee_member_role').subscribe({ next: (v) => this.memberRoles.set(v) });
    this.userService.listUsers().subscribe({ next: (v) => this.users.set(v) });
    this.roleService.listRoles().subscribe({ next: (v) => this.roles.set(v) });
    this.committeeService.listCommittees().subscribe({ next: (v) => this.allCommittees.set(v) });

    this.loadCommittee();
    this.loadMembers();
    this.loadMembershipEvents();
    this.loadCurrentStage();
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
