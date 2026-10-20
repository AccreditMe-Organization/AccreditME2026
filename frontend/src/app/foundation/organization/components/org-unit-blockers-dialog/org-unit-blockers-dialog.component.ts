import { Component, computed, inject, input, model } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../../core/formatting';
import { PluralKey } from '../../../../core/formatting/plural-key';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { OrgUnitDependenciesRefusalDto } from '../../services/org-unit.service';

type BlockerCode = OrgUnitDependenciesRefusalDto['blockers'][number]['code'];

const BLOCKER_KEYS: Record<BlockerCode, { sentence: PluralKey; link: string }> = {
  ACTIVE_CHILDREN: { sentence: 'organization.blockerChildren', link: 'organization.blockers.showInTree' },
  ACTIVE_USERS: { sentence: 'organization.blockerUsers', link: 'organization.blockers.showInUsers' },
  ACTIVE_COMMITTEES: { sentence: 'organization.blockerCommittees', link: 'organization.blockers.showInCommittees' },
};

/**
 * ACC-120 slice 11 (PR C) — Deactivate, refused (OS L131-148): the same
 * question, now listing what is in the way, said from PR B's coded refusal
 * (`ORG_UNIT_HAS_DEPENDENCIES`), never its English message.
 *
 * Each blocker is a 44px row: its count, its sentence, and where to fix it.
 * The "where" is plain text until those destinations take a filter (the
 * drawing's links: Users filtered to the unit, the tree at its sub-units).
 * At five blockers the body is about 296px, inside the 420 cap.
 */
@Component({
  selector: 'am-org-unit-blockers-dialog',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, EditDialogComponent],
  template: `
    <ng-template #body>
      <p class="am-ob__sub">{{ 'organization.blockers.sub' | translate }}</p>
      <ul class="am-ob__list" data-testid="blockers">
        @for (b of rows(); track $index) {
          <li class="am-ob__row" data-testid="blocker">
            <span class="am-ob__count" dir="ltr">{{ b.count }}</span>
            <span class="am-ob__text">{{ b.sentence }}</span>
            <span class="am-ob__where">{{ b.where }}</span>
          </li>
        }
      </ul>
    </ng-template>
    <ng-template #footer>
      <div class="flex justify-end">
        <p-button
          [label]="'organization.blockers.close' | translate"
          severity="secondary"
          [outlined]="true"
          (onClick)="visible.set(false)"
          data-testid="blockers-close"
        />
      </div>
    </ng-template>
    <app-edit-dialog [(visible)]="visible" [header]="header()" [content]="body" [footer]="footer" />
  `,
  styles: [
    `
      .am-ob__sub {
        margin: 0 0 var(--am-space-8);
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-700);
      }
      .am-ob__list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .am-ob__row {
        display: flex;
        align-items: center;
        gap: var(--am-space-12);
        min-block-size: 44px;
        border-block-end: 1px solid var(--am-border);
      }
      .am-ob__count {
        flex: none;
        inline-size: 28px;
        text-align: center;
        font-size: var(--am-type-heading-size);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .am-ob__text {
        flex: 1 1 auto;
        min-inline-size: 0;
        font-size: var(--am-type-value-size);
      }
      .am-ob__where {
        flex: none;
        font-size: var(--am-type-meta-size);
        font-weight: 600;
        color: var(--am-ink-500);
      }
    `,
  ],
})
export class OrgUnitBlockersDialogComponent {
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly visible = model(false);
  /** The unit, already in the reader's language. */
  readonly unitName = input('');
  readonly blockers = input<OrgUnitDependenciesRefusalDto['blockers']>([]);

  readonly header = computed(() => this.translate.instant('organization.blockers.header', { unit: this.unitName() }));

  readonly rows = computed(() =>
    this.blockers().map((b) => ({
      count: b.count,
      sentence: this.format.count(BLOCKER_KEYS[b.code].sentence, b.count),
      where: this.translate.instant(BLOCKER_KEYS[b.code].link),
    })),
  );
}
