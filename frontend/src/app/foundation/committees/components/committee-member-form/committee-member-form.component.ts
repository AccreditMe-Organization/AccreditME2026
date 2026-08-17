import { Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import {
  CommitteeService,
  CommitteeMemberDto,
} from '../../services/committee.service';
import { UserService, IUserDto } from '../../../user/services/user.service';
import { OrgUnitService, OrgUnitDto } from '../../../organization/services/org-unit.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { LanguageService } from '../../../../core/services/language.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

@Component({
  selector: 'app-committee-member-form',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, SelectModule, InputTextModule, ButtonModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
      @if (!member()) {
        <div class="flex flex-col gap-1">
          <label for="userId" class="text-sm font-medium">
            {{ 'committee.member' | translate }}
            <span class="text-red-500">*</span>
          </label>
          <p-select
            inputId="userId"
            formControlName="userId"
            [options]="pickableUsers()"
            optionLabel="name"
            optionValue="id"
            [filter]="true"
            filterBy="name,email"
            [placeholder]="'committee.selectMember' | translate"
          >
            <ng-template #item let-pickableUser>
              <div class="flex flex-col">
                <span>{{ pickableUser.name }}</span>
                <span class="text-xs text-[var(--am-text-secondary)]">{{ orgUnitName(pickableUser.primaryOrgUnitId) }}</span>
              </div>
            </ng-template>
          </p-select>
        </div>
      }

      <div class="flex flex-col gap-1">
        <label for="roleValueId" class="text-sm font-medium">
          {{ 'committee.memberRole' | translate }}
          <span class="text-red-500">*</span>
        </label>
        <p-select
          inputId="roleValueId"
          formControlName="roleValueId"
          [options]="memberRoles()"
          [optionLabel]="roleLabelField()"
          optionValue="id"
          [placeholder]="'committee.selectMemberRole' | translate"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="reason" class="text-sm font-medium">{{ 'committee.reason' | translate }}</label>
        <input pInputText id="reason" formControlName="reason" />
      </div>

      @if (saveError()) {
        <p class="text-red-500 text-sm">{{ saveError() | translate }}</p>
      }

      <div class="flex justify-end gap-2 pt-2">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="cancelled.emit()"
          [disabled]="saving()"
        />
        <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" />
      </div>
    </form>
  `,
})
export class CommitteeMemberFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly committeeService = inject(CommitteeService);
  private readonly userService = inject(UserService);
  private readonly orgUnitService = inject(OrgUnitService);
  private readonly lookupService = inject(LookupService);
  private readonly languageService = inject(LanguageService);

  readonly committeeId = input.required<string>();
  readonly member = input<CommitteeMemberDto | null>(null);
  readonly activeMembers = input<CommitteeMemberDto[]>([]);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly users = signal<IUserDto[]>([]);
  readonly orgUnits = signal<OrgUnitDto[]>([]);
  readonly memberRoles = signal<LookupValueDto[]>([]);

  readonly pickableUsers = computed(() => {
    const activeUserIds = new Set(this.activeMembers().map((m) => m.userId));
    return this.users().filter((u) => !activeUserIds.has(u.id));
  });

  readonly form = this.fb.group({
    userId: [null as string | null, [Validators.required]],
    roleValueId: [null as string | null, [Validators.required]],
    reason: [''],
  });

  roleLabelField(): 'labelAr' | 'labelEn' {
    return this.languageService.isArabic() ? 'labelAr' : 'labelEn';
  }

  constructor() {
    effect(() => {
      const current = this.member();
      if (current) {
        this.form.patchValue({ roleValueId: current.roleValueId });
      }
    });
  }

  ngOnInit(): void {
    this.userService.listUsers({ status: 'ACTIVE' }).subscribe({ next: (users) => this.users.set(users) });
    this.orgUnitService.getFlat().subscribe({ next: (units) => this.orgUnits.set(units) });
    this.lookupService.getValues('committee_member_role').subscribe({
      next: (values) => this.memberRoles.set(values),
    });
  }

  orgUnitName(orgUnitId: string | null): string {
    if (!orgUnitId) return '—';
    return this.orgUnits().find((u) => u.id === orgUnitId)?.nameEn ?? orgUnitId;
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);

    const value = this.form.getRawValue();
    const current = this.member();

    const request = current
      ? this.committeeService.changeMemberRole(this.committeeId(), current.id, {
          roleValueId: value.roleValueId!,
          reason: value.reason || undefined,
        })
      : this.committeeService.addMember(this.committeeId(), {
          userId: value.userId!,
          roleValueId: value.roleValueId!,
          reason: value.reason || undefined,
        });

    request.subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.saveError.set(extractErrorMessage(err, 'Save failed'));
        this.saving.set(false);
      },
    });
  }
}
