import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { CommitteeService, CommitteeDto } from '../../services/committee.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { LanguageService } from '../../../../core/services/language.service';
import { CommitteeFormComponent } from '../committee-form/committee-form.component';

@Component({
  selector: 'app-committee-list',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, TagModule, DialogModule, CardComponent, CommitteeFormComponent],
  template: `
    <div class="flex flex-col h-full gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'committee.title' | translate }}</h2>
        <p-button [label]="'committee.addCommittee' | translate" icon="pi pi-plus" (onClick)="onAdd()" />
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() | translate }}</p>
      }

      @if (!loading() && committees().length === 0) {
        <p class="text-center py-8 text-[var(--am-text-secondary)]">
          {{ 'committee.noCommittees' | translate }}
        </p>
      }

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (committee of committees(); track committee.id) {
          <app-card [linkable]="true" (click)="onOpen(committee)">
            <div class="flex flex-col gap-2">
              <div class="flex items-start justify-between">
                <h3 class="font-semibold">{{ displayName(committee) }}</h3>
                @if (!committee.isActive) {
                  <p-tag [value]="'common.inactive' | translate" severity="secondary" />
                }
              </div>
              <p class="text-sm text-[var(--am-text-secondary)]">{{ typeLabel(committee.typeValueId) }}</p>
              <p class="text-sm text-[var(--am-text-secondary)]">
                {{ 'committee.quorumCount' | translate }}: {{ committee.quorumCount }}
              </p>
            </div>
          </app-card>
        }
      </div>
    </div>

    <p-dialog
      [(visible)]="formVisible"
      [header]="'committee.addCommittee' | translate"
      [modal]="true"
      styleClass="w-full max-w-lg"
    >
      @if (formVisible()) {
        <app-committee-form (saved)="onSaved()" (cancelled)="formVisible.set(false)" />
      }
    </p-dialog>
  `,
})
export class CommitteeListComponent implements OnInit {
  private readonly committeeService = inject(CommitteeService);
  private readonly lookupService = inject(LookupService);
  private readonly languageService = inject(LanguageService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly committees = signal<CommitteeDto[]>([]);
  readonly error = signal<string | null>(null);
  readonly committeeTypes = signal<LookupValueDto[]>([]);
  readonly formVisible = signal(false);

  ngOnInit(): void {
    this.lookupService.getValues('committee_type').subscribe({ next: (values) => this.committeeTypes.set(values) });
    this.loadCommittees();
  }

  displayName(committee: CommitteeDto): string {
    return this.languageService.isArabic() ? committee.nameAr : committee.nameEn;
  }

  typeLabel(typeValueId: string): string {
    const value = this.committeeTypes().find((v) => v.id === typeValueId);
    if (!value) return typeValueId;
    return this.languageService.isArabic() ? value.labelAr : value.labelEn;
  }

  onAdd(): void {
    this.formVisible.set(true);
  }

  onOpen(committee: CommitteeDto): void {
    this.router.navigate(['/committees', committee.id]);
  }

  onSaved(): void {
    this.formVisible.set(false);
    this.loadCommittees();
  }

  loadCommittees(): void {
    this.loading.set(true);
    this.error.set(null);
    this.committeeService.listCommittees().subscribe({
      next: (committees) => {
        this.committees.set(committees);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('committee.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
