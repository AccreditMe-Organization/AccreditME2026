import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../shared/components/field/field.component';
import { FilesService } from '../../../shared/files/files.service';
import { StorageSettingsService } from './storage-settings.service';
import { REQUEST_NOTE_MAX } from './storage-setup';

/**
 * ACC-260, PR B — "Request a change of storage" (design L861–872, Form 560).
 * The only way to move an organisation's files once confirmed: it asks
 * AccreditMe's platform team, who are told in-app (POST
 * /tenant/storage/change-request). The note is optional and goes to them
 * only; it is not stored on the organisation.
 */
@Component({
  selector: 'am-storage-request-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, TextareaModule, EditDialogComponent, FieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #bodyTpl>
      <form (ngSubmit)="send()" data-testid="request-body">
        <p class="am-rd__note">{{ 'storage.request.note' | translate }}</p>
        <dl class="am-rd__pairs">
          <div class="min-w-0">
            <dt class="am-rd__k">{{ 'storage.request.by' | translate }}</dt>
            <dd class="am-rd__v" data-testid="request-by">{{ by() }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="am-rd__k">{{ 'storage.request.to' | translate }}</dt>
            <dd class="am-rd__v">{{ 'storage.request.toValue' | translate }}</dd>
          </div>
        </dl>
        <div class="am-rd__field">
          <am-field
            [label]="'storage.request.message' | translate"
            [control]="message"
            inputId="storage-request-message"
            [counter]="{ value: length(), max: max }"
            [errorMessages]="{ maxlength: 'validation.maxLength' }"
          >
            <textarea
              pTextarea
              id="storage-request-message"
              class="am-rd__area"
              [formControl]="message"
              [attr.maxlength]="max"
              [placeholder]="'storage.request.placeholder' | translate"
              data-testid="request-message"
            ></textarea>
          </am-field>
        </div>
        @if (error()) {
          <p class="am-rd__error" role="alert" data-testid="request-error">{{ error() }}</p>
        }
      </form>
    </ng-template>
    <ng-template #footerTpl>
      <div class="flex justify-end gap-3">
        <p-button type="button" severity="secondary" [text]="true" [label]="'common.cancel' | translate" [disabled]="busy()" (onClick)="dialog.requestClose()" />
        <p-button type="button" [label]="'storage.request.send' | translate" [loading]="busy()" (onClick)="send()" data-testid="request-send" />
      </div>
    </ng-template>
    <app-edit-dialog
      #dialog
      [visible]="visible()"
      (visibleChange)="visibleChange.emit($event)"
      [header]="'storage.request.title' | translate"
      [context]="'storage.request.context' | translate: { name: current() }"
      [content]="bodyTpl"
      [footer]="footerTpl"
      [dirty]="dirty()"
      [saving]="busy()"
      size="form"
    />
  `,
  styles: [
    `
      .am-rd__note{margin:0;font-size:var(--am-type-body-size);line-height:var(--am-type-body-line);font-weight:500;color:var(--am-info-ink)}
      .am-rd__pairs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--am-space-12);margin:var(--am-space-12) 0 0}
      .am-rd__k{margin:0 0 var(--am-space-2);font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-ink-500)}
      .am-rd__v{margin:0;font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);font-weight:500;color:var(--am-ink-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;unicode-bidi:isolate}
      .am-rd__field{margin-block-start:var(--am-space-12)}
      /* Three lines of value text plus its padding: 76 / 82, the drawn heights (L861-872). */
      .am-rd__area{inline-size:100%;resize:none;box-sizing:border-box;block-size:calc(var(--am-type-value-line) * 3 + var(--am-space-16));font-size:var(--am-type-value-size);line-height:var(--am-type-value-line)}
      .am-rd__error{margin:var(--am-space-8) 0 0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);font-weight:500;color:var(--am-danger-ink)}
    `,
  ],
})
export class StorageRequestDialogComponent {
  private readonly storage = inject(StorageSettingsService);
  private readonly files = inject(FilesService);
  private readonly translate = inject(TranslateService);

  readonly visible = input.required<boolean>();
  /** The current location's name, for "Current: …". */
  readonly current = input('');
  /** Who is asking: the signed-in admin. */
  readonly by = input('');

  readonly visibleChange = output<boolean>();
  /** Sent: the page reloads, and its strip shows the request line instead of the button. */
  readonly sent = output<void>();

  readonly max = REQUEST_NOTE_MAX;
  readonly message = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(REQUEST_NOTE_MAX)] });
  private readonly value = toSignal(this.message.valueChanges, { initialValue: '' });
  readonly length = computed(() => this.value().length);
  readonly dirty = computed(() => this.value().trim().length > 0);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // Each opening starts empty.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.message.reset('');
        this.error.set(null);
      });
    });
  }

  send(): void {
    if (this.busy() || this.message.invalid) return;
    this.busy.set(true);
    this.error.set(null);
    this.storage.requestChange(this.message.value).subscribe({
      next: () => {
        this.busy.set(false);
        this.message.reset('');
        this.sent.emit();
        this.visibleChange.emit(false);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(this.files.refusal(err) ?? this.translate.instant('storage.request.failed'));
      },
    });
  }
}
