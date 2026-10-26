import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { EditDialogComponent } from '../../../shared/components/edit-dialog/edit-dialog.component';
import { FieldComponent } from '../../../shared/components/field/field.component';
import { FilesService } from '../../../shared/files/files.service';
import { StorageSettingsService } from './storage-settings.service';
import { CONTACT_EMAIL_MAX, CONTACT_NAME_MAX, REQUEST_NOTE_MAX, contactEmail, contactPhone, notBlank } from './storage-setup';

/**
 * ACC-260, PR B — "Request a change of storage" (design L861–872, Form 560).
 * The only way to move an organisation's files once confirmed: it asks
 * AccreditMe's platform team, who are told in-app and by email (POST
 * /tenant/storage/change-request). The note is optional and goes to them
 * only; it is not stored on the organisation.
 *
 * PR B2 — who AccreditMe should talk to about the move, often the customer's
 * infrastructure or security team rather than the admin asking: a contact
 * name, email and phone, all required. Name and email start as the signed-in
 * admin's; the phone starts empty (no profile holds one). A field says what is
 * wrong once it has been left; Send is never disabled (CLAUDE.md, ACC-238,
 * rule 5.2) — pressed on an invalid form it shows every error and sends
 * nothing. The "Requested by" and "Sent to" pairs were dropped to keep the body
 * under the 420 cap: the requester is always the signed-in admin, and the
 * platform admins' notice still names them ("Asked by …").
 */
@Component({
  selector: 'am-storage-request-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, TextareaModule, EditDialogComponent, FieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #bodyTpl>
      <form [formGroup]="contact" (ngSubmit)="send()" data-testid="request-body">
        <p class="am-rd__note">{{ 'storage.request.note' | translate }}</p>
        <div class="am-rd__contact" data-testid="request-contact">
          <am-field
            [label]="'storage.request.contactName' | translate"
            [control]="contact.controls.name"
            inputId="storage-request-contact-name"
            [forceShowErrors]="showErrors()"
            [errorMessages]="{ required: 'storage.request.contactNameRequired', maxlength: 'validation.maxLength' }"
          >
            <input
              pInputText
              id="storage-request-contact-name"
              class="w-full"
              formControlName="name"
              autocomplete="name"
              [attr.maxlength]="nameMax"
              (blur)="left(contact.controls.name)"
            />
          </am-field>
          <div class="am-rd__two">
            <am-field
              [label]="'storage.request.contactEmail' | translate"
              [control]="contact.controls.email"
              inputId="storage-request-contact-email"
              [forceShowErrors]="showErrors()"
              [errorMessages]="{ required: 'storage.request.contactEmailRequired', email: 'storage.request.contactEmailInvalid', maxlength: 'validation.maxLength' }"
            >
              <input
                pInputText
                type="email"
                dir="ltr"
                id="storage-request-contact-email"
                class="w-full"
                formControlName="email"
                autocomplete="email"
                spellcheck="false"
                [attr.maxlength]="emailMax"
                (blur)="left(contact.controls.email)"
              />
            </am-field>
            <am-field
              [label]="'storage.request.contactPhone' | translate"
              [control]="contact.controls.phone"
              inputId="storage-request-contact-phone"
              [forceShowErrors]="showErrors()"
              [errorMessages]="{ required: 'storage.request.contactPhoneRequired', phone: 'storage.request.contactPhoneInvalid' }"
            >
              <input
                pInputText
                type="tel"
                dir="ltr"
                id="storage-request-contact-phone"
                class="w-full"
                formControlName="phone"
                autocomplete="tel"
                placeholder="+965 2222 3333"
                (blur)="left(contact.controls.phone)"
              />
            </am-field>
          </div>
          <p class="am-rd__hint" data-testid="request-contact-hint">{{ 'storage.request.contactHint' | translate }}</p>
        </div>
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
        <p-button
          type="button"
          [label]="'storage.request.send' | translate"
          [loading]="busy()"
          (onClick)="send()"
          data-testid="request-send"
        />
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
      .am-rd__field{margin-block-start:var(--am-space-12)}
      .am-rd__contact{display:flex;flex-direction:column;gap:var(--am-space-8);margin-block-start:var(--am-space-12)}
      .am-rd__two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:var(--am-space-12)}
      .am-rd__hint{margin:0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-700)}
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
  /** The signed-in admin's email: the contact email starts as it. */
  readonly byEmail = input('');

  readonly visibleChange = output<boolean>();
  /** Sent: the page reloads, and its strip shows the request line instead of the button. */
  readonly sent = output<void>();

  readonly max = REQUEST_NOTE_MAX;
  readonly nameMax = CONTACT_NAME_MAX;
  readonly emailMax = CONTACT_EMAIL_MAX;
  readonly contact = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [notBlank, Validators.maxLength(CONTACT_NAME_MAX)] }),
    email: new FormControl('', { nonNullable: true, validators: [notBlank, contactEmail, Validators.maxLength(CONTACT_EMAIL_MAX)] }),
    phone: new FormControl('', { nonNullable: true, validators: [notBlank, contactPhone] }),
  });
  /** Set by a press of Send on an invalid form: every field then says what is wrong. */
  readonly showErrors = signal(false);
  readonly message = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(REQUEST_NOTE_MAX)] });
  private readonly value = toSignal(this.message.valueChanges, { initialValue: '' });
  readonly length = computed(() => this.value().length);
  private readonly contactValue = toSignal(this.contact.valueChanges, { initialValue: this.contact.getRawValue() });
  readonly dirty = computed(() => this.value().trim().length > 0 || (this.contactValue().phone ?? '').trim().length > 0);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // Each opening starts empty.
    effect(() => {
      if (!this.visible()) return;
      untracked(() => {
        this.message.reset('');
        this.contact.reset({ name: this.by(), email: this.byEmail(), phone: '' });
        this.showErrors.set(false);
        this.error.set(null);
      });
    });
  }

  /** A field that has been left says what is wrong with it, typed in or not. */
  left(control: FormControl<string>): void {
    control.markAsDirty();
  }

  send(): void {
    if (this.busy()) return;
    if (this.contact.invalid || this.message.invalid) {
      this.contact.markAllAsTouched();
      this.showErrors.set(true);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    const { name, email, phone } = this.contact.getRawValue();
    this.storage.requestChange({ contactName: name, contactEmail: email, contactPhone: phone }, this.message.value).subscribe({
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
