import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { SetupKind } from './storage-setup';

/**
 * ACC-260, PR B — "Confirm AccreditMe cloud?" (design L851–860, Confirm 420):
 * the consequence in one sentence, then Location and Confirmed by. For MinIO
 * and a local folder the Location pair shows the endpoint or folder, LTR;
 * AccreditMe cloud is named only (rule 1).
 *
 * The caller sends the request; this dialog shows it running and, if it is
 * refused, says why and that nothing changed — the values stay on the page.
 */
@Component({
  selector: 'am-storage-confirm-dialog',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, EditDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #bodyTpl>
      <div data-testid="confirm-body">
        <p class="am-cd__note">{{ 'storage.confirm.body' | translate }}</p>
        <dl class="am-cd__pairs">
          <div class="min-w-0">
            <dt class="am-cd__k">{{ 'storage.confirm.location' | translate }}</dt>
            <dd class="am-cd__v" [attr.dir]="isText() ? 'ltr' : null" data-testid="confirm-location">{{ locationText() }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="am-cd__k">{{ 'storage.confirm.by' | translate }}</dt>
            <dd class="am-cd__v" data-testid="confirm-by">{{ by() }}</dd>
          </div>
        </dl>
        @if (error()) {
          <div class="am-cd__error" role="alert" data-testid="confirm-error">
            <p class="m-0">{{ error() }}</p>
            <p class="m-0">{{ 'storage.confirm.nothingChanged' | translate }}</p>
          </div>
        }
      </div>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button type="button" severity="secondary" [text]="true" [label]="'common.cancel' | translate" [disabled]="busy()" (onClick)="dialog.requestClose()" />
        <p-button type="button" [label]="'storage.confirm.confirm' | translate" [loading]="busy()" (onClick)="confirm.emit()" data-testid="confirm-send" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'storage.confirm.title.' + kind() | translate"
      [context]="'storage.confirm.context' | translate"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [saving]="busy()"
      size="confirm"
    />
  `,
  styles: [
    `
      .am-cd__note{margin:0;font-size:var(--am-type-body-size);line-height:var(--am-type-body-line);color:var(--am-ink-900)}
      .am-cd__pairs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--am-space-12);margin:var(--am-space-12) 0 0}
      .am-cd__k{margin:0 0 var(--am-space-2);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-ink-500)}
      .am-cd__v{margin:0;font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);font-weight:500;color:var(--am-ink-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;unicode-bidi:isolate}
      .am-cd__error{margin-block-start:var(--am-space-12);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-danger-ink)}
    `,
  ],
})
export class StorageConfirmDialogComponent {
  readonly visible = input.required<boolean>();
  readonly kind = input.required<SetupKind>();
  /** The Location pair: a translated name (AccreditMe cloud), or the tenant's own endpoint or folder. */
  readonly location = input.required<{ key: string } | { text: string }>();
  /** Already translated, for the key case. */
  readonly locationName = input('');
  readonly by = input('');
  readonly busy = input(false);
  /** The refusal, in the reader's words; the dialog adds that nothing changed. */
  readonly error = input<string | null>(null);

  readonly visibleChange = output<boolean>();
  readonly confirm = output<void>();

  protected isText(): boolean {
    return 'text' in this.location();
  }

  protected locationText(): string {
    const l = this.location();
    return 'text' in l ? l.text : this.locationName();
  }
}
