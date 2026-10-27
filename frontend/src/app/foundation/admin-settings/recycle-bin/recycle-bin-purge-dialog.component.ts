import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { AmCountPipe, FormatService } from '../../../core/formatting';
import { FilesService } from '../../../shared/files/files.service';
import { IRecycleBinItem, PURGE_MAX_FILES } from './recycle-bin.service';
import { totals } from './recycle-bin-view';

/**
 * ACC-260, PR D — Purge (design L895–906, Confirm 420, danger).
 *
 * The consequence in one sentence, Files and Total size, and the tick "I
 * understand these files will be gone for good". **Purge stays unavailable
 * until it is ticked**: the design's one disabled primary in the product,
 * because the tick IS the confirmation, not form validation (so rule 5.2,
 * "Save is never disabled for an invalid form", does not apply). The tick
 * starts clear on every open.
 *
 * More than 100 files: the API takes 1 to 100 per request, so the dialog says
 * so in place of the tick and sends nothing.
 *
 * The caller sends the one request. A refusal (SharePoint unreachable) is shown
 * here with "Nothing was purged."; the files stay.
 */
@Component({
  selector: 'am-recycle-bin-purge-dialog',
  standalone: true,
  imports: [FormsModule, TranslatePipe, ButtonModule, CheckboxModule, EditDialogComponent, AmCountPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #bodyTpl>
      <div data-testid="purge-body">
        <p class="am-pd__note" data-testid="purge-note">{{ files().length | amCount: 'recycleBin.purgeNote' : { size: size() } }}</p>
        <dl class="am-pd__pairs">
          <div class="min-w-0">
            <dt class="am-pd__k">{{ 'recycleBin.purgeDialog.files' | translate }}</dt>
            <dd class="am-pd__v" data-testid="purge-count">{{ count() }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="am-pd__k">{{ 'recycleBin.purgeDialog.totalSize' | translate }}</dt>
            <dd class="am-pd__v" data-testid="purge-size">{{ size() }}</dd>
          </div>
        </dl>
        @if (tooMany()) {
          <p class="am-pd__error" role="alert" data-testid="purge-too-many">{{ 'recycleBin.purgeDialog.tooMany' | translate: { max: max } }}</p>
        } @else {
          <label class="am-pd__tick">
            <p-checkbox [binary]="true" [ngModel]="ticked()" (ngModelChange)="ticked.set($event)" [disabled]="busy()" inputId="recycle-bin-purge-tick" data-testid="purge-tick" />
            <span>{{ (files().length === 1 ? 'recycleBin.purgeDialog.tickOne' : 'recycleBin.purgeDialog.tick') | translate }}</span>
          </label>
        }
        @if (error()) {
          <div class="am-pd__error" role="alert" data-testid="purge-error">
            <p class="m-0">{{ error() }}</p>
            <p class="m-0">{{ 'recycleBin.purgeDialog.nothingPurged' | translate }}</p>
          </div>
        }
      </div>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button type="button" severity="secondary" [text]="true" [label]="'common.cancel' | translate" [disabled]="busy()" (onClick)="dialog.requestClose()" />
        <p-button
          type="button"
          severity="danger"
          [label]="'recycleBin.purgeDialog.confirm' | translate"
          [loading]="busy()"
          [disabled]="!ticked() || tooMany()"
          (onClick)="send()"
          data-testid="purge-send"
        />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="title()"
      [context]="context()"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [saving]="busy()"
      role="alertdialog"
      size="confirm"
    />
  `,
  styles: [
    `
      .am-pd__note{margin:0;font-size:var(--am-type-body-size);line-height:var(--am-type-body-line);color:var(--am-danger-ink);font-weight:500}
      .am-pd__pairs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--am-space-12);margin:var(--am-space-12) 0 0}
      .am-pd__k{margin:0 0 var(--am-space-2);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-ink-500)}
      .am-pd__v{margin:0;font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);font-weight:500;color:var(--am-ink-900);unicode-bidi:isolate}
      .am-pd__tick{display:flex;align-items:center;gap:var(--am-space-8);margin-block-start:var(--am-space-12);font-size:var(--am-type-body-size);line-height:var(--am-type-body-line);color:var(--am-ink-900);cursor:pointer}
      .am-pd__error{margin:var(--am-space-12) 0 0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-danger-ink)}
    `,
  ],
})
export class RecycleBinPurgeDialogComponent {
  private readonly filesService = inject(FilesService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly visible = input.required<boolean>();
  readonly files = input.required<readonly IRecycleBinItem[]>();
  readonly busy = input(false);
  /** The refusal, in the reader's words; the dialog adds that nothing was purged. */
  readonly error = input<string | null>(null);

  readonly visibleChange = output<boolean>();
  readonly confirm = output<void>();

  readonly max = PURGE_MAX_FILES;
  readonly ticked = signal(false);
  readonly tooMany = computed(() => this.files().length > PURGE_MAX_FILES);
  readonly size = computed(() => this.filesService.size(totals(this.files()).bytes));
  readonly count = computed(() => this.format.number(this.files().length));

  readonly title = computed(() => {
    const files = this.files();
    return files.length === 1
      ? this.translate.instant('recycleBin.purgeDialog.titleOne', { name: files[0]!.name })
      : this.format.count('recycleBin.purgeTitle', files.length);
  });
  readonly context = computed(() =>
    this.files().length === 1
      ? this.translate.instant('recycleBin.purgeDialog.contextOne', { size: this.size() })
      : this.format.count('recycleBin.purgeContext', this.files().length, { size: this.size() }),
  );

  constructor() {
    // Clear on every open: a tick from an earlier purge must not carry over.
    effect(() => {
      if (this.visible()) untracked(() => this.ticked.set(false));
    });
  }

  send(): void {
    if (!this.ticked() || this.tooMany() || this.busy()) return;
    this.confirm.emit();
  }
}
