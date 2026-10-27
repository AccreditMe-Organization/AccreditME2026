import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { AmCountPipe, FormatService } from '../../../core/formatting';
import { FilesService } from '../../../shared/files/files.service';
import { IRecycleBinItem } from './recycle-bin.service';
import { totals } from './recycle-bin-view';

/**
 * ACC-260, PR D — Restore (design L885–894, Confirm 420).
 *
 * One file: "Restore 'name'? It goes back to <record>." Several: "Restore 4
 * files?", how many go back, how many are skipped because their record no
 * longer exists, and the Restoring / Skipped pairs. Only rows already known to
 * be gone can be counted as skipped: the list doesn't say, so a file whose
 * record has gone unnoticed is tried and reported with the others.
 *
 * The caller sends the requests, one per file, and reports each outcome.
 */
@Component({
  selector: 'am-recycle-bin-restore-dialog',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, EditDialogComponent, AmCountPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #bodyTpl>
      <div data-testid="restore-body">
        @if (single(); as f) {
          <p class="am-rb__note">{{ 'recycleBin.restoreDialog.bodyOne' | translate: { record: record() } }}</p>
        } @else {
          <p class="am-rb__note">
            {{ restoring().length | amCount: 'recycleBin.restoreNote' }}
            @if (skipped().length > 0) {
              {{ skipped().length | amCount: 'recycleBin.restoreSkipped' }}
            }
          </p>
          <dl class="am-rb__pairs">
            <div class="min-w-0">
              <dt class="am-rb__k">{{ 'recycleBin.restoreDialog.restoring' | translate }}</dt>
              <dd class="am-rb__v" data-testid="restore-restoring">{{ restoring().length | amCount: 'recycleBin.filesSize' : { size: restoringSize() } }}</dd>
            </div>
            @if (skipped().length > 0) {
              <div class="min-w-0">
                <dt class="am-rb__k">{{ 'recycleBin.restoreDialog.skipped' | translate }}</dt>
                <dd class="am-rb__v" data-testid="restore-skipped">{{ skipped().length | amCount: 'recycleBin.filesCount' }}</dd>
              </div>
            }
          </dl>
        }
      </div>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button type="button" severity="secondary" [text]="true" [label]="'common.cancel' | translate" [disabled]="busy()" (onClick)="dialog.requestClose()" />
        <p-button type="button" [label]="confirmLabel()" [loading]="busy()" (onClick)="confirm.emit()" data-testid="restore-send" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="title()"
      [context]="'recycleBin.restoreDialog.context' | translate"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [saving]="busy()"
      size="confirm"
    />
  `,
  styles: [
    `
      .am-rb__note{margin:0;font-size:var(--am-type-body-size);line-height:var(--am-type-body-line);color:var(--am-ink-900)}
      .am-rb__pairs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--am-space-12);margin:var(--am-space-12) 0 0}
      .am-rb__k{margin:0 0 var(--am-space-2);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-ink-500)}
      .am-rb__v{margin:0;font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);font-weight:500;color:var(--am-ink-900);unicode-bidi:isolate}
    `,
  ],
})
export class RecycleBinRestoreDialogComponent {
  private readonly files = inject(FilesService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  /** The files that will be tried. */
  readonly restoring = input.required<readonly IRecycleBinItem[]>();
  /** Selected files already known to be gone: counted, never sent. */
  readonly skipped = input<readonly IRecycleBinItem[]>([]);
  /** "Re-audit wards 4B and 6A", or a record type when there is no name. Already translated. */
  readonly record = input('');
  readonly busy = input(false);

  readonly visibleChange = output<boolean>();
  readonly confirm = output<void>();

  /** One file and nothing skipped: the one-row wording. */
  readonly single = computed(() => (this.restoring().length === 1 && this.skipped().length === 0 ? this.restoring()[0]! : null));
  readonly restoringSize = computed(() => this.files.size(totals(this.restoring()).bytes));
  /** "Restore 'name'?", or "Restore 4 files?" counting the skipped ones too. */
  readonly title = computed(() => {
    const one = this.single();
    return one
      ? this.translate.instant('recycleBin.restoreDialog.titleOne', { name: one.name })
      : this.format.count('recycleBin.restoreTitle', this.restoring().length + this.skipped().length);
  });
  /** "Restore", or "Restore 3 files": only the ones that will be tried. */
  readonly confirmLabel = computed(() =>
    this.single()
      ? this.translate.instant('recycleBin.restoreDialog.confirmOne')
      : this.format.count('recycleBin.restoreConfirm', this.restoring().length),
  );
}
