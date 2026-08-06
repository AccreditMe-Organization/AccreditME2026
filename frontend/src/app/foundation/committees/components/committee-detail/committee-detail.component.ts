import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { ConfirmationService } from 'primeng/api';
import { CardComponent } from '../../../../shared/components/card/card.component';
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
import { WorkflowTemplateService } from '../../../workflow/services/workflow-template.service';
import { WorkflowTransitionActionsComponent } from '../../../workflow/components/workflow-transition-actions/workflow-transition-actions.component';
import { LanguageService } from '../../../../core/services/language.service';
import { CommitteeFormComponent } from '../committee-form/committee-form.component';
import { CommitteeMemberFormComponent } from '../committee-member-form/committee-member-form.component';

@Component({
  selector: 'app-committee-detail',
  standalone: true,
  imports: [
    TranslatePipe,
    DatePipe,
    ButtonModule,
    TableModule,
    TagModule,
    DialogModule,
    MessageModule,
    CardComponent,
    CommitteeFormComponent,
    CommitteeMemberFormComponent,
    WorkflowTransitionActionsComponent,
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
            @if (currentStageLabel()) {
              <p class="text-sm text-[var(--am-text-secondary)] mt-1">
                {{ 'committee.currentStage' | translate }}: {{ currentStageLabel() }}
              </p>
            }
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

    <p-dialog
      [(visible)]="formVisible"
      [header]="'committee.editCommittee' | translate"
      [modal]="true"
      styleClass="w-full max-w-lg"
    >
      @if (formVisible() && committee()) {
        <app-committee-form
          [committee]="committee()"
          (saved)="onCommitteeSaved()"
          (cancelled)="formVisible.set(false)"
        />
      }
    </p-dialog>

    <p-dialog
      [(visible)]="memberFormVisible"
      [header]="(editingMember() ? 'committee.editMemberRole' : 'committee.addMember') | translate"
      [modal]="true"
      styleClass="w-full max-w-lg"
    >
      @if (memberFormVisible()) {
        <app-committee-member-form
          [committeeId]="committeeId"
          [member]="editingMember()"
          (saved)="onMemberSaved()"
          (cancelled)="memberFormVisible.set(false)"
        />
      }
    </p-dialog>
  `,
})
export class CommitteeDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly committeeService = inject(CommitteeService);
  private readonly lookupService = inject(LookupService);
  private readonly userService = inject(UserService);
  private readonly roleService = inject(RoleService);
  private readonly workflowService = inject(WorkflowService);
  private readonly workflowTemplateService = inject(WorkflowTemplateService);
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
  readonly currentStageLabel = signal<string | null>(null);
  readonly currentInstance = signal<WorkflowInstanceDto | null>(null);

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
          error: (err: { error?: { message?: string } }) =>
            this.error.set(err?.error?.message ?? 'committee.errorAction'),
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
  // stored field on Committee (ACC-22 Pending Discussion #5). Plain-text
  // display only — WorkflowStage has no persisted, stable key/slug to bind
  // a colored badge to (see step-22-committee-management.md's revised
  // Pending Discussion #8).
  private loadCurrentStage(): void {
    this.workflowService.getInstancesByObject('COMMITTEE', this.committeeId).subscribe({
      next: (instances) => {
        const instance = instances[0];
        if (instance) this.setCurrentInstance(instance);
      },
    });
  }

  private setCurrentInstance(instance: WorkflowInstanceDto): void {
    this.currentInstance.set(instance);
    if (!instance.currentStageId) {
      this.currentStageLabel.set(null);
      return;
    }
    this.workflowTemplateService.getTemplate(instance.workflowTemplateId).subscribe({
      next: (template) => {
        const stage = template.stages?.find((s) => s.id === instance.currentStageId);
        this.currentStageLabel.set(stage ? (this.languageService.isArabic() ? stage.nameAr : stage.nameEn) : null);
      },
    });
  }
}
