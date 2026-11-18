import { Component, Directive, ElementRef, afterEveryRender, computed, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { FormatService } from '../../../../core/formatting';
import type { PluralKey } from '../../../../core/formatting/plural-key';
import { LanguageService } from '../../../../core/services/language.service';
import { RoleReferenceBlockerDto, RoleReferenceCategory, RoleReferenceNameDto } from '../../services/role.service';

/** Each category's counted heading ("Given directly to 12 users"); a typed key, so a missing one fails the build. */
const CATEGORY_KEY: Record<RoleReferenceCategory, PluralKey> = {
  USER_GRANTS: 'role.inUse.USER_GRANTS',
  POSITION_GRANTS: 'role.inUse.POSITION_GRANTS',
  POSITIONS: 'role.inUse.POSITIONS',
  STAGE_ESCALATIONS: 'role.inUse.STAGE_ESCALATIONS',
};

/** How a category's blocker is removed, where that is not obvious from its heading. */
const CATEGORY_HINT: Partial<Record<RoleReferenceCategory, string>> = {
  POSITION_GRANTS: 'roles.inUse.hint.POSITION_GRANTS',
  POSITIONS: 'roles.inUse.hint.POSITIONS',
};

/** A category this screen knows how to say. One it does not (a newer server) is left out, never said as a key. */
export function isKnownRoleReferenceCategory(category: unknown): category is RoleReferenceCategory {
  return typeof category === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_KEY, category);
}

/**
 * Focusable (`tabindex="0"`) only while the element actually scrolls, so a
 * keyboard can reach what is below the fold, and a list that fits is not an
 * extra, empty tab stop. Re-measured after every render, which covers the list
 * filling in, a language switch and the dialog's width changing.
 */
@Directive({ selector: '[amFocusableWhenScrolling]', standalone: true })
export class FocusableWhenScrollingDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterEveryRender(() => {
      const el = this.host.nativeElement;
      const scrolls = el.scrollHeight > el.clientHeight + 1;
      if (scrolls && el.getAttribute('tabindex') !== '0') el.setAttribute('tabindex', '0');
      else if (!scrolls && el.hasAttribute('tabindex')) el.removeAttribute('tabindex');
    });
  }
}

/**
 * ACC-154 — "Can't be deactivated yet": what still holds or names a role, from
 * the deactivation pre-flight (or a ROLE_IN_USE refusal's own blockers), as a
 * 420 Confirm with Close only. Nothing here clears anything: the administrator
 * removes each blocker where it lives, then deactivates.
 *
 * One block per category, in the server's order: its count as a counted
 * heading, then the names the server sent (up to ten) and, when there are more,
 * "Showing 10 of 12" — so the count is never read off the names. The server
 * names a category only for a reader with its view permission (ACC-101's
 * rule); without it the block is the count line alone. Two categories add how
 * they are removed (ending the headship; changing the position's role).
 *
 * Names arrive as data in both languages and are labelled here, in the
 * reader's language (LanguageService.bilingual()); a stage reads
 * "workflow — stage", each half in the reader's language.
 *
 * ## The 420 cap
 *
 * The worst case (four categories, ten names each) does not fit the body, so
 * the list is an inner-scroll frame (edit-dialog.component.ts, "the inner-scroll
 * escape"): plain text only, nothing in it floats. It is a focusable region
 * while it scrolls, so a keyboard reaches what is below the fold. Measured in
 * role-in-use-dialog.layout.spec.ts in both languages.
 */
@Component({
  selector: 'app-role-in-use-dialog',
  standalone: true,
  imports: [EditDialogComponent, ButtonModule, TranslatePipe, FocusableWhenScrollingDirective],
  template: `
    <ng-template #body>
      <p class="am-role-in-use__lead">{{ 'roles.inUse.lead' | translate }}</p>
      <ul
        class="am-role-in-use__list"
        amFocusableWhenScrolling
        [attr.aria-label]="'roles.inUse.lead' | translate"
        data-role-in-use-list
      >
        @for (blocker of shown(); track blocker.category) {
          <li class="am-role-in-use__category" [attr.data-role-in-use-category]="blocker.category">
            <span class="am-role-in-use__heading">{{ headingOf(blocker) }}</span>
            @if (blocker.names.length > 0) {
              <span class="am-role-in-use__names" data-role-in-use-names>{{ namesOf(blocker) }}</span>
              @if (blocker.count > blocker.names.length) {
                <span class="am-role-in-use__meta" data-role-in-use-shown>{{
                  'record.showing' | translate: { shown: format.number(blocker.names.length), total: format.number(blocker.count) }
                }}</span>
              }
            }
            @if (hintOf(blocker); as hint) {
              <span class="am-role-in-use__meta" data-role-in-use-hint>{{ hint | translate }}</span>
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
        max-block-size: var(--am-dialog-scroll-list-max);
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
        border-block-end: var(--am-rule-width) solid var(--am-border);
      }
      .am-role-in-use__heading {
        font-weight: 600;
      }
      .am-role-in-use__names,
      .am-role-in-use__meta {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-700);
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class RoleInUseDialogComponent {
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  protected readonly format = inject(FormatService);

  readonly visible = input(false);
  /** The role's name as the reader reads it (LanguageService.bilingual), for the title. */
  readonly roleName = input('');
  readonly blockers = input<readonly RoleReferenceBlockerDto[]>([]);

  readonly closed = output<void>();

  /** The categories this screen can say; an unknown one is left out. */
  readonly shown = computed(() => this.blockers().filter((b) => isKnownRoleReferenceCategory(b.category)));

  headingOf(blocker: RoleReferenceBlockerDto): string {
    return this.format.count(CATEGORY_KEY[blocker.category], blocker.count);
  }

  namesOf(blocker: RoleReferenceBlockerDto): string {
    return blocker.names.map((n) => this.labelOf(n)).join(this.translate.instant('common.listSeparator'));
  }

  hintOf(blocker: RoleReferenceBlockerDto): string | null {
    return CATEGORY_HINT[blocker.category] ?? null;
  }

  private labelOf(name: RoleReferenceNameDto): string {
    const own = this.language.bilingual(name.nameEn, name.nameAr);
    if (!name.workflow) return own;
    return this.translate.instant('roles.inUse.stageName', {
      workflow: this.language.bilingual(name.workflow.nameEn, name.workflow.nameAr),
      stage: own,
    });
  }
}
