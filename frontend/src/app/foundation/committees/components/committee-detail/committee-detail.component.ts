import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { ConfirmationService } from 'primeng/api';
import { TabsModule } from 'primeng/tabs';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { RecordPanelComponent } from '../../../../shared/components/record-panel/record-panel.component';
import { TaskListComponent } from '../../../tasks/components/task-list/task-list.component';
import { WorkflowStageIndicatorComponent } from '../../../workflow/components/workflow-stage-indicator/workflow-stage-indicator.component';
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
    TabsModule,
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
      <!-- ACC-76 — BAND + TWO-COLUMN WORKSPACE.
           The page was a single full-width stack of ten blocks, four of them
           unbounded lists — roughly two and a half screens at 1440x900. A
           record you can only read by scrolling defeats the point of a record
           page, so the layout is now fixed-height on a normal screen, with
           each column scrolling inside itself rather than the page scrolling.

           BAND (always visible): identity, actions, and the stage SEQUENCE.
           The sequence earns permanent space because it answers the question
           every reader has first — where is this committee in its lifecycle.

           MAIN (2/3): tabs. Every section name and count is visible at once in
           the strip, which states the full set of relationships more directly
           than scrolling past four panels did — "Documents 0" is legible
           immediately rather than three screens down.

           RAIL (1/3): the facts, the purpose, and the two histories.

           Below 1280px (xl) the rail drops beneath the main pane and the page
           scrolls normally; below 768px the tab strip scrolls horizontally
           (p-tabs does that natively) and the band wraps. -->
      <div class="flex flex-col gap-4 xl:h-full xl:min-h-0">
        <div class="flex flex-col gap-3 shrink-0">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div class="min-w-0">
              <h2 class="text-xl font-semibold">{{ displayName(c) }}</h2>
              <p class="text-sm text-[var(--am-text-secondary)]">{{ typeLabel(c.typeValueId) }}</p>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              @if (!c.isActive) {
                <p-tag [value]="'common.inactive' | translate" severity="secondary" />
              }
              @if (currentInstance(); as instance) {
                <app-workflow-transition-actions
                  [instance]="instance"
                  (transitioned)="onWorkflowTransitioned($event)"
                />
              }
              <p-button [label]="'common.edit' | translate" icon="pi pi-pencil" [text]="true" (onClick)="onEdit()" />
            </div>
          </div>

          <!-- Scrolls horizontally rather than wrapping: at narrow widths a
               wrapped sequence becomes a tall block that pushes content
               off-screen, which is the problem this layout exists to fix. -->
          @if (currentInstance(); as instance) {
            <div class="overflow-x-auto">
              <app-workflow-stage-indicator [instance]="instance" [show]="'sequence'" />
            </div>
          }
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 xl:flex-1 xl:min-h-0">
          <div class="xl:col-span-2 xl:min-h-0 flex flex-col">
            <app-card>
              <p-tabs value="tasks" scrollable>
                <p-tablist>
                  <p-tab value="tasks">
                    {{ 'committee.tasks' | translate }}
                    <span class="text-xs text-[var(--am-text-secondary)] ms-1">{{ taskList.taskCount() }}</span>
                  </p-tab>
                  <p-tab value="members">
                    {{ 'committee.members' | translate }}
                    <span class="text-xs text-[var(--am-text-secondary)] ms-1">{{ members().length }}</span>
                  </p-tab>
                  <p-tab value="subCommittees">
                    {{ 'committee.subCommittees' | translate }}
                    <span class="text-xs text-[var(--am-text-secondary)] ms-1">{{ subCommittees().length }}</span>
                  </p-tab>
                  <p-tab value="meetings">
                    {{ 'committee.meetings' | translate }}
                    <span class="text-xs text-[var(--am-text-secondary)] ms-1">0</span>
                  </p-tab>
                  <p-tab value="documents">
                    {{ 'committee.documents' | translate }}
                    <span class="text-xs text-[var(--am-text-secondary)] ms-1">0</span>
                  </p-tab>
                </p-tablist>

                <p-tabpanels>
                  <p-tabpanel value="tasks">
                    <div class="xl:max-h-[46vh] overflow-y-auto">
                      @if (taskList.loadError(); as taskError) {
                        <p-message severity="error" [text]="taskError | translate" />
                      }
                      <!-- No create button, deliberately — manual task creation
                           cannot produce an ASSIGNED task (see CLAUDE.md's
                           task-creation note). A button that cannot do its job
                           is worse than no button. -->
                      <app-task-list
                        #taskList
                        [embedded]="true"
                        sourceType="COMMITTEE"
                        [sourceId]="committeeId"
                        [sourceLabel]="displayName(c)"
                      />
                    </div>
                  </p-tabpanel>

                  <p-tabpanel value="members">
                    <div class="flex flex-col gap-3">
                      <div class="flex justify-end">
                        <p-button
                          [label]="'committee.addMember' | translate"
                          icon="pi pi-plus"
                          size="small"
                          (onClick)="onAddMember()"
                        />
                      </div>
                      <div class="xl:max-h-[40vh] overflow-y-auto">
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
                      </div>
                    </div>
                  </p-tabpanel>

                  <p-tabpanel value="subCommittees">
                    <div class="xl:max-h-[46vh] overflow-y-auto">
                      @if (subCommittees().length === 0) {
                        <p class="py-6 text-center text-sm text-[var(--am-text-secondary)]">
                          {{ 'committee.noSubCommittees' | translate }}
                        </p>
                      } @else {
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
                      }
                    </div>
                  </p-tabpanel>

                  <!-- Four of the seven things an accreditation surveyor checks
                       for a committee live here (module-designs.md:880-887):
                       attendance, quorum confirmation, decisions with vote
                       counts, and action items tracked to completion.

                       A REAL section with an empty state, not "coming soon"
                       scaffolding — an empty Meetings tab says the relationship
                       exists and is unpopulated, which is true; placeholder
                       styling would say the page is unfinished, which is a
                       different and worse claim. -->
                  <p-tabpanel value="meetings">
                    <div class="flex flex-col gap-2 py-2">
                      <p class="text-xs text-[var(--am-text-secondary)]">
                        {{ 'committee.meetingsDescription' | translate }}
                      </p>
                      <p class="py-6 text-center text-sm text-[var(--am-text-secondary)]">
                        {{ 'committee.noMeetings' | translate }}
                      </p>
                    </div>
                  </p-tabpanel>

                  <!-- Terms of Reference and reporting evidence — the remaining
                       two surveyor checks. Committee.termsOfReferenceDocumentId
                       is already in the schema, annotated there as unpopulated
                       until Document Management ships. -->
                  <p-tabpanel value="documents">
                    <div class="flex flex-col gap-2 py-2">
                      <p class="text-xs text-[var(--am-text-secondary)]">
                        {{ 'committee.documentsDescription' | translate }}
                      </p>
                      <p class="py-6 text-center text-sm text-[var(--am-text-secondary)]">
                        {{ 'committee.noDocuments' | translate }}
                      </p>
                    </div>
                  </p-tabpanel>
                </p-tabpanels>
              </p-tabs>
            </app-card>
          </div>

          <div class="flex flex-col gap-4 xl:min-h-0 xl:overflow-y-auto">
            <!-- A definition list, not four cards: four short values do not
                 need four bordered boxes, and the rail has less width. -->
            <app-card>
              <dl class="flex flex-col gap-3 text-sm">
                <div class="flex justify-between gap-4">
                  <dt class="text-[var(--am-text-secondary)]">{{ 'committee.quorumCount' | translate }}</dt>
                  <dd class="font-medium">{{ c.quorumCount }}</dd>
                </div>
                <div class="flex justify-between gap-4">
                  <dt class="text-[var(--am-text-secondary)]">{{ 'committee.meetingFrequency' | translate }}</dt>
                  <dd class="font-medium">{{ c.meetingFrequency }}</dd>
                </div>
                <div class="flex justify-between gap-4">
                  <dt class="text-[var(--am-text-secondary)]">{{ 'committee.parentCommittee' | translate }}</dt>
                  <dd class="font-medium text-end">{{ parentCommitteeName(c) }}</dd>
                </div>
                <div class="flex justify-between gap-4">
                  <dt class="text-[var(--am-text-secondary)]">{{ 'committee.reportingTo' | translate }}</dt>
                  <dd class="font-medium text-end">{{ reportingToName(c) }}</dd>
                </div>
              </dl>
            </app-card>

            @if (c.purpose) {
              <app-card>
                <p class="text-sm text-[var(--am-text-secondary)]">{{ 'committee.purpose' | translate }}</p>
                <p class="text-sm mt-1">{{ c.purpose }}</p>
              </app-card>
            }

            @if (currentInstance(); as instance) {
              <app-record-panel [heading]="'committee.lifecycle' | translate">
                <div class="max-h-[32vh] overflow-y-auto">
                  <app-workflow-stage-indicator [instance]="instance" [show]="'history'" />
                </div>
              </app-record-panel>
            }

            <app-record-panel
              [heading]="'committee.membershipHistory' | translate"
              [count]="membershipEvents().length"
              [isEmpty]="membershipEvents().length === 0"
              [emptyMessage]="'committee.noMembershipHistory' | translate"
            >
              <div class="flex flex-col gap-2 max-h-[32vh] overflow-y-auto">
                @for (event of membershipEvents(); track event.id) {
                  <div class="flex items-center justify-between gap-2 p-2 rounded-md border border-[var(--am-border)] text-sm">
                    <span>
                      {{ userName(event.userId) }} —
                      {{ ('committee.action.' + event.action.toLowerCase()) | translate }} —
                      {{ memberRoleLabel(event.roleValueId) }}
                    </span>
                    <span class="text-[var(--am-text-secondary)] whitespace-nowrap">{{ event.effectiveDate | date: 'mediumDate' }}</span>
                  </div>
                }
              </div>
            </app-record-panel>
          </div>
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
