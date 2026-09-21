import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageModule } from 'primeng/message';
import { PlanService, IAiCreditPack } from '../../services/plan.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
// ACC-39 — EditDialogComponent replaces this raw p-dialog + manual @if.
// Unlike every other item in this ticket, this screen is genuinely
// create-only: only openAdd() exists, no edit affordance in the table row
// template at all. This migration has nothing to verify pre-fill-wise —
// there was never a second-open-shows-stale-data risk to begin with. Pure
// architectural consistency with SYSTEM-REFERENCE.md Section 10.5's
// required pattern, not a bug-adjacent fix like the others in this ticket.
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { InputNumberLatinDigits } from '../../../core/formatting/latin-digits';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';

@Component({
  selector: 'app-ai-credit-pack-list',
  standalone: true,
  imports: [PageHeaderComponent, ReactiveFormsModule, TranslatePipe, TableModule, ButtonModule, InputTextModule, InputNumberModule, InputNumberLatinDigits, MessageModule, EditDialogComponent],
  template: `
    <div class="flex flex-col gap-4">
      <app-page-header [title]="'platform.aiCreditPacks' | translate">
        <div pageActions>
          @if (canCreate()) {
            <p-button icon="pi pi-plus" [label]="'platform.addAiCreditPack' | translate" (onClick)="openAdd()" />
          }
        </div>
      </app-page-header>

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }

      <p-table [value]="packs()" [loading]="loading()" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ 'platform.packName' | translate }}</th>
            <th>{{ 'platform.credits' | translate }}</th>
            <th>{{ 'platform.price' | translate }}</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-pack>
          <tr>
            <td>{{ pack.name }}</td>
            <td>{{ pack.credits }}</td>
            <td>{{ pack.price }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="3" class="text-center py-4 text-[var(--am-text-secondary)]">{{ 'platform.noAiCreditPacks' | translate }}</td>
          </tr>
        </ng-template>
      </p-table>

      <ng-template #formTpl>
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <label for="name" class="text-sm font-medium">{{ 'platform.packName' | translate }}</label>
            <input pInputText id="name" formControlName="name" />
          </div>
          <div class="flex flex-col gap-1">
            <label for="credits" class="text-sm font-medium">{{ 'platform.credits' | translate }}</label>
            <p-inputNumber inputId="credits" formControlName="credits" [min]="1" />
          </div>
          <div class="flex flex-col gap-1">
            <label for="price" class="text-sm font-medium">{{ 'platform.price' | translate }}</label>
            <input pInputText id="price" formControlName="price" />
          </div>
          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
          </div>
        </form>
      </ng-template>
      <app-edit-dialog
        [(visible)]="showAddDialog"
        [header]="'platform.addAiCreditPack' | translate"
        [content]="formTpl"
        width="420px"
      />
    </div>
  `,
})
export class AiCreditPackListComponent implements OnInit {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly fb = inject(FormBuilder);
  private readonly planService = inject(PlanService);
  private readonly navigationAccess = inject(NavigationAccessService);

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. Same mechanism as committee-detail.component.ts's canEdit /
  // canAddMember, deliberately rather than a second one.
  // PlatformGuard, not @Permissions(): PlanController is @UseGuards(TenantGuard,
  // PlatformGuard) at class level and its POSTs carry no permission decorator,
  // so isPlatformAdmin() mirrors that guard's own two-part check.
  readonly canCreate = computed(() => this.navigationAccess.isPlatformAdmin());

  readonly packs = signal<IAiCreditPack[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showAddDialog = signal(false);

  readonly form = this.fb.group({
    name: ['', [Validators.required]],
    credits: [100, [Validators.required, Validators.min(1)]],
    price: ['0', [Validators.required]],
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.planService.listAiCreditPacks(true).subscribe({
      next: (packs) => {
        this.packs.set(packs);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('platform.errorLoad');
        this.loading.set(false);
      },
    });
  }

  openAdd(): void {
    this.form.reset({ name: '', credits: 100, price: '0' });
    this.showAddDialog.set(true);
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const value = this.form.getRawValue();

    this.planService.createAiCreditPack({ name: value.name!, credits: value.credits!, price: value.price! }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showAddDialog.set(false);
        this.load();
      },
      error: () => {
        this.saving.set(false);
        this.error.set('platform.errorAction');
      },
    });
  }
}
