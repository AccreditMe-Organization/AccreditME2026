import { Component, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FormatService } from '../../../../core/formatting';
import type { PluralKey } from '../../../../core/formatting/plural-key';
import { RoleReferenceBlockerDto, RoleReferenceCategory } from '../../services/role.service';

/** Each category's counted heading ("Given directly to 12 users"); a typed key, so a missing one fails the build. */
const CATEGORY_KEY: Record<RoleReferenceCategory, PluralKey> = {
  USER_GRANTS: 'role.inUse.USER_GRANTS',
  POSITION_GRANTS: 'role.inUse.POSITION_GRANTS',
  POSITIONS: 'role.inUse.POSITIONS',
  STAGE_ESCALATIONS: 'role.inUse.STAGE_ESCALATIONS',
};

/**
 * ACC-154 — "Can't be deactivated yet": what still holds or names a role, from
 * the deactivation pre-flight (or a ROLE_IN_USE refusal's own blockers), as a
 * 420 Confirm with Close only. Nothing here clears anything: the administrator
 * removes each blocker where it lives, then deactivates.
 *
 * One block per category, in the server's order: its count as a counted
 * heading, then the names the server sent (up to ten) and, when there are more,
 * "Showing 10 of 12" — so the count is never read off the names.
 *
 * ## The 420 cap
 *
 * The worst case (four categories, ten names each) does not fit the body, so
 * the list is an inner-scroll frame (edit-dialog.component.ts, "the inner-scroll
 * escape"): plain text only, nothing in it floats. It is a focusable region, so
 * a keyboard reaches what is below the fold. Measured in
 * role-in-use-dialog.layout.spec.ts in both languages.
 */
@Component({
  selector: 'app-role-in-use-dialog',
  standalone: true,
  imports: [EditDialogComponent, ButtonModule, TranslatePipe],
  template: `
    <ng-template #body>
      <p class="am-role-in-use__lead">{{ 'roles.inUse.lead' | translate }}</p>
      <ul
        class="am-role-in-use__list"
        tabindex="0"
        [attr.aria-label]="'roles.inUse.lead' | translate"
        data-role-in-use-list
      >
        @for (blocker of blockers(); track blocker.category) {
          <li class="am-role-in-use__category" [attr.data-role-in-use-category]="blocker.category">
            <span class="am-role-in-use__heading">{{ headingOf(blocker) }}</span>
            <span class="am-role-in-use__names" data-role-in-use-names>{{ namesOf(blocker) }}</span>
            @if (blocker.count > blocker.names.length) {
              <span class="am-role-in-use__shown" data-role-in-use-shown>{{
                'record.showing' | translate: { shown: format.number(blocker.names.length), total: format.number(blocker.count) }
              }}</span>
            }
          </li>
        }
      </ul>
    </ng-template>
    <ng-template #footer>
      <p-button [label]="'common.close' | translate" (onClick)="closed.emit()" data-role-in-use-close />
    </ng-template>
    <app-edit-dialog
      [visible]="visible()"
      (visibleChange)="$event || closed.emit()"
      [header]="'roles.inUse.title' | translate: { name: roleName() }"
      role="alertdialog"
      size="confirm"
      [content]="body"
      [footer]="footer"
    />
  `,
  styles: [
    `
      .am-role-in-use__lead {
        margin: 0;
      }
      .am-role-in-use__list {
        list-style: none;
        margin: var(--am-space-4) 0 0;
        padding: 0;
        max-block-size: 280px;
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      .am-role-in-use__list:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-role-in-use__category {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-2);
        padding-block: var(--am-space-6);
        border-block-end: 1px solid var(--am-border);
      }
      .am-role-in-use__heading {
        font-weight: 600;
      }
      .am-role-in-use__names,
      .am-role-in-use__shown {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-700);
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class RoleInUseDialogComponent {
  private readonly translate = inject(TranslateService);
  protected readonly format = inject(FormatService);

  readonly visible = input(false);
  /** The role's name as the reader reads it (LanguageService.bilingual), for the title. */
  readonly roleName = input('');
  readonly blockers = input<readonly RoleReferenceBlockerDto[]>([]);

  readonly closed = output<void>();

  headingOf(blocker: RoleReferenceBlockerDto): string {
    return this.format.count(CATEGORY_KEY[blocker.category], blocker.count);
  }

  namesOf(blocker: RoleReferenceBlockerDto): string {
    return blocker.names.join(this.translate.instant('common.listSeparator'));
  }
}
