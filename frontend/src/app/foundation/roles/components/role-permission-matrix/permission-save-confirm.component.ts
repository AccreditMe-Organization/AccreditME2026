import { Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { AmCountPipe } from '../../../../core/formatting';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';

/** Where a save stands, as the confirmation draws it (Users and Roles 3c). */
export type PermissionSaveState = 'idle' | 'saving' | 'failed' | 'forbidden' | 'conflict';

/** One line of the confirmation: "Module · permission sentence". */
export interface PermissionChangeLine {
  key: string;
  text: string;
}

export interface PermissionChangeGroup {
  kind: 'added' | 'removed';
  total: number;
  lines: PermissionChangeLine[];
  /** How many more than the lines shown. */
  more: number;
}

/**
 * ACC-120 slice 5, PR B — the permission matrix's save confirmation, Users and
 * Roles 3b, with the 3c states.
 *
 * ONE column, so nothing mirrors. Under the title, D's consequence: "Applies
 * to N users as soon as it's saved", and "M of them hold this role through a
 * head position" when M > 0. Then "Adding n" and "Removing n", each at most
 * four lines and then "+ n more · each is ringed in the matrix". That is text,
 * not a control, so the body never grows past the 420 cap. Removals have their
 * own heading, and + and − differ by glyph as well as colour, so a revocation
 * is never read as a grant. It never says people LOSE access (D).
 *
 * While saving, the dialog stays open, Cancel and Escape are inert (the shell's
 * `saving`), and the primary keeps its label with a spinner. A failure keeps
 * every change and offers Try again; a 403 drops Try again; a 409 offers
 * "Reload role" instead, because retrying would overwrite someone else's save
 * unseen. A presentational component: the matrix owns the state.
 */
@Component({
  selector: 'app-permission-save-confirm',
  standalone: true,
  imports: [EditDialogComponent, TranslatePipe, AmCountPipe, ButtonModule],
  template: `
    <app-edit-dialog
      [visible]="visible()"
      (visibleChange)="$event ? null : cancelled.emit()"
      [header]="'roles.matrix.confirmTitle' | translate: { name: roleName() }"
      [content]="body"
      [footer]="footer"
      [saving]="state() === 'saving'"
      size="confirm"
    />

    <ng-template #body>
      <div data-pm-confirm>
        <p class="psc-sub" data-pm-applies>{{ activeHolders() | amCount: 'role.applies' }}</p>
        @if (headHolders() > 0) {
          <p class="psc-sub" data-pm-head>{{ headHolders() | amCount: 'role.headPosition' }}</p>
        }

        @if (failed()) {
          <div class="psc-alert" role="alert" data-pm-alert>
            <span class="psc-alert-mark" aria-hidden="true">!</span>
            <span>
              @switch (state()) {
                @case ('failed') {
                  <span class="psc-alert-title">{{ 'roles.matrix.failedTitle' | translate }}</span>
                  <span class="psc-alert-body"
                    >{{ 'roles.matrix.failedBody' | translate }} {{ changeCount() | amCount: 'role.stillHere' }}</span
                  >
                }
                @case ('forbidden') {
                  <span class="psc-alert-title">{{ 'roles.matrix.forbidden' | translate }}</span>
                }
                @default {
                  <span class="psc-alert-title">{{ 'roles.matrix.conflict' | translate: { name: roleName() } }}</span>
                }
              }
            </span>
          </div>
        }

        @for (group of groups(); track group.kind) {
          <div class="psc-group" [attr.data-pm-group]="group.kind">
            <div class="psc-head" [class.psc-remove]="group.kind === 'removed'">
              {{ group.total | amCount: (group.kind === 'added' ? 'role.adding' : 'role.removing') }}
            </div>
            @for (line of group.lines; track line.key) {
              <div class="psc-line">
                <span class="psc-glyph" [class.psc-remove]="group.kind === 'removed'" aria-hidden="true">{{
                  group.kind === 'added' ? '+' : '−'
                }}</span>
                <span class="psc-text">{{ line.text }}</span>
              </div>
            }
            @if (group.more > 0) {
              <div class="psc-more">{{ group.more | amCount: 'role.more' }}</div>
            }
          </div>
        }
      </div>
    </ng-template>

    <ng-template #footer>
      <p-button
        [label]="'common.cancel' | translate"
        severity="secondary"
        [outlined]="true"
        [disabled]="state() === 'saving'"
        (onClick)="cancelled.emit()"
      />
      @if (state() === 'conflict') {
        <p-button [label]="'roles.matrix.reloadRole' | translate" (onClick)="reload.emit()" data-pm-reload />
      } @else if (state() !== 'forbidden') {
        <p-button [label]="primaryLabel()" [loading]="state() === 'saving'" (onClick)="confirmed.emit()" data-pm-save />
      }
    </ng-template>
  `,
  styles: [
    `
      .psc-sub {
        margin: 0;
        font-size: 13px;
        color: var(--am-ink-700);
      }
      .psc-alert {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        margin-block-start: 8px;
        padding: 9px 11px;
        border: 1px solid var(--am-danger-border);
        background: var(--am-danger-bg);
        border-radius: 6px;
      }
      .psc-alert-mark {
        flex: none;
        font-weight: 700;
        color: var(--am-danger-ink);
      }
      .psc-alert-title {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--am-danger-ink);
      }
      .psc-alert-body {
        display: block;
        font-size: 12px;
        color: var(--am-ink-700);
        margin-block-start: 2px;
      }
      .psc-group {
        margin-block-start: 8px;
      }
      .psc-head {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--am-info-ink);
        margin-block-end: 2px;
      }
      :host-context([dir='rtl']) .psc-head {
        letter-spacing: 0;
        font-size: 12px;
      }
      .psc-line {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 32px;
        font-size: 13px;
        color: var(--am-ink-900);
        border-block-end: 1px solid var(--am-row-rule);
      }
      .psc-glyph {
        flex: none;
        width: 14px;
        text-align: center;
        font-weight: 700;
        color: var(--am-success-ink);
      }
      .psc-head.psc-remove,
      .psc-glyph.psc-remove {
        color: var(--am-danger-ink);
      }
      .psc-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .psc-more {
        display: flex;
        align-items: center;
        min-height: 26px;
        font-size: 12px;
        color: var(--am-ink-500);
      }
    `,
  ],
})
export class PermissionSaveConfirmComponent {
  readonly visible = input.required<boolean>();
  /** The role's name as it goes into a sentence — already bidi-isolated by the matrix. */
  readonly roleName = input.required<string>();
  readonly activeHolders = input.required<number>();
  readonly headHolders = input.required<number>();
  readonly groups = input.required<PermissionChangeGroup[]>();
  readonly changeCount = input.required<number>();
  readonly state = input.required<PermissionSaveState>();
  readonly primaryLabel = input.required<string>();

  readonly cancelled = output<void>();
  readonly confirmed = output<void>();
  readonly reload = output<void>();

  readonly failed = computed(() => {
    const s = this.state();
    return s === 'failed' || s === 'forbidden' || s === 'conflict';
  });
}
