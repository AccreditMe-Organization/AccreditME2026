import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { EmailProvider, IEmailConfig, IUpdateEmailConfig, TenantService } from '../../../tenant/services/tenant.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { SecretFieldComponent } from '../../../../shared/components/secret-field/secret-field.component';
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

/*
 * ACC-181 — the email provider screen, to "AccreditMe Settings Screens"
 * section 1. Replaces a free-form JSON editor that was filled from a GET
 * returning every secret in clear, and saved the whole object back.
 *
 * SECRETS ARE WRITE-ONLY (am-secret-field): the GET answers 'set' or null, the
 * form never holds a stored secret, and a save sends a secret ONLY when a new
 * value was typed. An omitted secret is kept by the server.
 *
 * NOT ACTIVE YET (D1): nothing sends mail with these settings — email goes out
 * through AccreditMe's own delivery — so the banner says so, the button is
 * "Save for later", and there is no Send test email. ACC-155 removes this.
 */

type FieldKind = 'text' | 'email' | 'port' | 'encryption' | 'secret';

interface FieldDef {
  name: string;
  kind: FieldKind;
  labelKey: string;
  hintKey?: string;
  required: boolean;
  /** Values written left to right in both languages (addresses, keys, hosts). */
  ltr?: boolean;
  pattern?: RegExp;
  patternKey?: string;
}

// Mirrors the backend's DTO patterns (update-email-config.dto.ts).
const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;
const AWS_ACCESS_KEY_ID = /^[A-Z0-9]{16,128}$/;

const f = (name: string, kind: FieldKind, labelKey: string, required: boolean, extra: Partial<FieldDef> = {}): FieldDef => ({
  name,
  kind,
  labelKey: `emailSettings.field.${labelKey}`,
  required,
  ltr: kind !== 'text' || extra.ltr,
  ...extra,
});

/** Each provider's fields, in the drawing's order. */
export const EMAIL_PROVIDER_FIELDS: Readonly<Record<EmailProvider, readonly FieldDef[]>> = {
  resend: [
    f('apiKey', 'secret', 'apiKey', true),
    f('fromAddress', 'email', 'fromAddress', true),
    f('fromName', 'text', 'fromName', false, { hintKey: 'emailSettings.hint.fromName' }),
  ],
  smtp: [
    f('host', 'text', 'host', true, { ltr: true, pattern: HOST, patternKey: 'emailSettings.error.host' }),
    f('port', 'port', 'port', true, { hintKey: 'emailSettings.hint.port' }),
    f('encryption', 'encryption', 'encryption', true),
    f('username', 'text', 'username', false, { ltr: true }),
    f('password', 'secret', 'password', false),
    f('fromAddress', 'email', 'fromAddress', true, { hintKey: 'emailSettings.hint.fromAddressSmtp' }),
    f('fromName', 'text', 'fromName', false, { hintKey: 'emailSettings.hint.fromName' }),
  ],
  office365: [
    f('tenantId', 'text', 'tenantId', true, { ltr: true, pattern: GUID, patternKey: 'emailSettings.error.guid' }),
    f('clientId', 'text', 'clientId', true, { ltr: true, pattern: GUID, patternKey: 'emailSettings.error.guid' }),
    f('clientSecret', 'secret', 'clientSecret', true),
    f('fromAddress', 'email', 'senderMailbox', true),
  ],
  sendgrid: [
    f('apiKey', 'secret', 'apiKey', true),
    f('fromAddress', 'email', 'fromAddressVerified', true),
    f('fromName', 'text', 'fromName', false, { hintKey: 'emailSettings.hint.fromName' }),
  ],
  ses: [
    f('region', 'text', 'region', true, { ltr: true, pattern: AWS_REGION, patternKey: 'emailSettings.error.region' }),
    f('accessKeyId', 'text', 'accessKeyId', true, { ltr: true, pattern: AWS_ACCESS_KEY_ID, patternKey: 'emailSettings.error.accessKeyId' }),
    f('secretAccessKey', 'secret', 'secretAccessKey', true),
    f('fromAddress', 'email', 'senderIdentity', true),
  ],
};

const PROVIDERS: readonly EmailProvider[] = ['resend', 'smtp', 'office365', 'sendgrid', 'ses'];

/** SMTP's port follows its encryption, until someone edits the port. */
export const PORT_FOR_ENCRYPTION: Readonly<Record<string, string>> = { STARTTLS: '587', SSL_TLS: '465', NONE: '25' };

const notBlank: ValidatorFn = (c: AbstractControl): ValidationErrors | null =>
  typeof c.value === 'string' && c.value.trim() === '' ? { required: true } : null;

const portRange: ValidatorFn = (c: AbstractControl): ValidationErrors | null => {
  const v = String(c.value ?? '').trim();
  if (v === '') return null;
  const n = Number(v);
  return /^\d+$/.test(v) && n >= 1 && n <= 65535 ? null : { port: true };
};

/** The bidi-isolated address, so it reads left to right inside an Arabic sentence. */
const isolate = (text: string) => `\u2068${text}\u2069`;

@Component({
  selector: 'app-email-provider-settings',
  standalone: true,
  imports: [
    PageHeaderComponent,
    ReactiveFormsModule,
    TranslatePipe,
    InputTextModule,
    ButtonModule,
    MessageModule,
    FieldComponent,
    SecretFieldComponent,
    // Routed page under <main>: OverlaySelect, not p-select (CLAUDE.md).
    OverlaySelectComponent,
  ],
  template: `
    <div class="flex flex-col gap-4 max-w-2xl">
      <app-page-header [title]="'adminSettings.emailProvider' | translate" />

      <!-- D1 — the "not active yet" treatment, at the top of the section. -->
      <div
        class="flex items-start gap-2 rounded border border-dashed border-[var(--am-text-secondary)] p-3"
        data-email-not-active
      >
        <span
          class="shrink-0 rounded border border-[var(--am-text-secondary)] bg-[var(--am-surface)] px-[6px] text-[11px] font-bold"
          >{{ 'common.notActiveYet' | translate }}</span
        >
        <span class="text-sm">{{ 'emailSettings.notActiveBody' | translate }}</span>
      </div>

      @if (error(); as e) {
        <p-message severity="error" [text]="e" />
      }
      @if (notice(); as n) {
        <p-message severity="success" [text]="n | translate" />
      }

      @if (loaded()) {
        @if (!showForm()) {
          <!-- The resting state is a sentence about what actually happens. No
               form sits on a pre-selected value. -->
          <section class="flex flex-col gap-3" data-email-resting>
            <h2 class="text-base font-semibold">{{ 'emailSettings.howTitle' | translate }}</h2>
            <div class="flex items-start gap-3 rounded-md border border-[var(--am-border)] p-3">
              <i class="pi pi-envelope mt-1" aria-hidden="true"></i>
              <span class="flex flex-col gap-1">
                <span class="font-medium">{{ 'emailSettings.defaultTitle' | translate }}</span>
                <span class="text-sm" data-email-default-sentence>
                  @if (stored()?.defaultSender; as sender) {
                    {{ 'emailSettings.defaultBody' | translate: { address: isolate(sender) } }}
                  } @else {
                    {{ 'emailSettings.defaultBodyNoAddress' | translate }}
                  }
                </span>
              </span>
            </div>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'emailSettings.connectWhy' | translate }}</p>
            <div>
              <p-button type="button" [label]="'emailSettings.connect' | translate" (onClick)="connect()" data-email-connect />
            </div>
          </section>
        } @else {
          <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-4" data-email-form novalidate>
            <am-field
              [label]="'emailSettings.provider' | translate"
              inputId="emailProvider"
              [control]="form.controls.provider"
              [hint]="'emailSettings.providerHint' | translate"
            >
              <app-overlay-select
                formControlName="provider"
                [options]="providerOptions()"
                optionLabel="label"
                optionValue="value"
              />
            </am-field>

            <div class="grid gap-4 md:grid-cols-2" [attr.data-email-fields]="provider()">
              @for (field of fields(); track provider() + '.' + field.name) {
                @switch (field.kind) {
                  @case ('secret') {
                    <div class="md:col-span-2" [attr.data-email-field]="field.name">
                      <am-secret-field
                        [label]="field.labelKey | translate"
                        [inputId]="'email-' + field.name"
                        [control]="control(field.name)"
                        [isSet]="isSecretSet(field.name)"
                        [setAt]="secretSetAt(field.name)"
                        [errorMessages]="errorMessagesFor(field)"
                      />
                    </div>
                  }
                  @case ('encryption') {
                    <div [attr.data-email-field]="field.name">
                      <am-field [label]="field.labelKey | translate" [inputId]="'email-' + field.name" [control]="control(field.name)">
                        <app-overlay-select
                          [formControl]="control(field.name)"
                          [options]="encryptionOptions()"
                          optionLabel="label"
                          optionValue="value"
                        />
                      </am-field>
                    </div>
                  }
                  @default {
                    <div [attr.data-email-field]="field.name">
                      <am-field
                        [label]="field.labelKey | translate"
                        [inputId]="'email-' + field.name"
                        [control]="control(field.name)"
                        [hint]="field.hintKey ? (field.hintKey | translate) : ''"
                        [errorMessages]="errorMessagesFor(field)"
                      >
                        <input
                          pInputText
                          [id]="'email-' + field.name"
                          [formControl]="control(field.name)"
                          [type]="field.kind === 'email' ? 'email' : 'text'"
                          [attr.inputmode]="field.kind === 'port' ? 'numeric' : null"
                          [attr.dir]="field.ltr ? 'ltr' : null"
                          [attr.autocomplete]="field.kind === 'email' ? 'email' : 'off'"
                          class="w-full"
                        />
                      </am-field>
                    </div>
                  }
                }
              }
            </div>

            <div class="flex flex-wrap justify-end gap-2">
              @if (stored()?.provider) {
                <p-button
                  type="button"
                  severity="danger"
                  [outlined]="true"
                  [label]="'emailSettings.disconnect' | translate"
                  [loading]="disconnecting()"
                  (onClick)="disconnect()"
                  data-email-disconnect
                />
              } @else {
                <p-button type="button" [text]="true" [label]="'common.cancel' | translate" (onClick)="cancel()" data-email-cancel />
              }
              <p-button type="submit" [label]="'emailSettings.saveForLater' | translate" [loading]="saving()" data-email-save />
            </div>
          </form>
        }
      } @else {
        <p class="text-sm text-[var(--am-text-secondary)]" data-email-loading>{{ 'common.loading' | translate }}</p>
      }
    </div>
  `,
})
export class EmailProviderSettingsComponent implements OnInit {
  private readonly tenantService = inject(TenantService);
  private readonly translate = inject(TranslateService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isolate = isolate;

  readonly loaded = signal(false);
  readonly saving = signal(false);
  readonly disconnecting = signal(false);
  readonly stored = signal<IEmailConfig | null>(null);
  readonly connecting = signal(false);
  readonly notice = signal<string | null>(null);
  private readonly errorKey = signal<{ key: string; missing?: readonly string[] } | null>(null);

  /** One group per provider, so switching keeps what was typed until a save. */
  readonly form = new FormGroup({
    provider: new FormControl<EmailProvider>('resend', { nonNullable: true }),
    resend: this.groupFor('resend'),
    smtp: this.groupFor('smtp'),
    office365: this.groupFor('office365'),
    sendgrid: this.groupFor('sendgrid'),
    ses: this.groupFor('ses'),
  });

  readonly provider = signal<EmailProvider>('resend');
  readonly fields = computed(() => EMAIL_PROVIDER_FIELDS[this.provider()]);
  readonly showForm = computed(() => this.connecting() || !!this.stored()?.provider);

  /** Labels from the translation files: product names, Latin in both languages. */
  readonly providerOptions = computed(() => {
    this.translate.currentLang();
    return PROVIDERS.map((value) => ({ value, label: this.translate.instant(`emailSettings.providerName.${value}`) }));
  });
  readonly encryptionOptions = computed(() => {
    this.translate.currentLang();
    return Object.keys(PORT_FOR_ENCRYPTION).map((value) => ({
      value,
      label: this.translate.instant(`emailSettings.encryption.${value}`),
    }));
  });

  /** The error, in the current language. Missing fields are named by their labels. */
  readonly error = computed(() => {
    this.translate.currentLang();
    const e = this.errorKey();
    if (!e) return null;
    if (e.missing) {
      const byName = new Map(EMAIL_PROVIDER_FIELDS[this.provider()].map((d) => [d.name, d.labelKey]));
      const names = e.missing.map((n) => this.translate.instant(byName.get(n) ?? n));
      return this.translate.instant(e.key, { fields: names.join(this.translate.instant('emailSettings.listSeparator')) });
    }
    return this.translate.instant(e.key);
  });

  /** Set once the port is edited by hand: from then on encryption leaves it alone. */
  private portEdited = false;

  ngOnInit(): void {
    this.wireSmtp();
    this.form.controls.provider.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      this.provider.set(p);
      this.errorKey.set(null);
    });

    this.tenantService.getEmailConfig().subscribe({
      next: (config) => {
        this.applyStored(config);
        this.loaded.set(true);
      },
      error: () => {
        this.errorKey.set({ key: 'adminSettings.errorLoad' });
        this.loaded.set(true);
      },
    });
  }

  control(name: string): FormControl<string> {
    return this.form.controls[this.provider()].controls[name]!;
  }

  isSecretSet(name: string): boolean {
    const s = this.stored();
    return s?.provider === this.provider() && s.settings?.[name] === 'set';
  }

  secretSetAt(name: string): string | null {
    return this.isSecretSet(name) ? (this.stored()?.secretsSetAt[name] ?? null) : null;
  }

  errorMessagesFor(field: FieldDef): Record<string, string> {
    return {
      required: this.translate.instant('emailSettings.error.required'),
      email: this.translate.instant('emailSettings.error.email'),
      port: this.translate.instant('emailSettings.error.port'),
      pair: this.translate.instant('emailSettings.error.pair'),
      ...(field.patternKey ? { pattern: this.translate.instant(field.patternKey) } : {}),
    };
  }

  connect(): void {
    this.notice.set(null);
    this.connecting.set(true);
  }

  cancel(): void {
    this.connecting.set(false);
    this.errorKey.set(null);
  }

  save(): void {
    this.notice.set(null);
    this.errorKey.set(null);
    const provider = this.provider();
    const group = this.form.controls[provider];
    for (const c of Object.values(group.controls)) c.updateValueAndValidity({ emitEvent: false });
    group.markAllAsTouched();
    if (group.invalid) return;

    const block: Record<string, number | string> = {};
    for (const field of EMAIL_PROVIDER_FIELDS[provider]) {
      const value = (group.controls[field.name]!.value ?? '').trim();
      // A secret goes ONLY when a new value was typed. Untouched it is '', and
      // omitting it is what keeps the stored one (the ACC-181 bug was sending
      // whatever the form held).
      if (field.kind === 'secret') {
        if (value !== '') block[field.name] = value;
        continue;
      }
      block[field.name] = field.kind === 'port' && value !== '' ? Number(value) : value;
    }
    const dto: IUpdateEmailConfig = { provider, [provider]: block };

    this.saving.set(true);
    this.tenantService.updateEmailConfig(dto).subscribe({
      next: (config) => {
        this.saving.set(false);
        this.connecting.set(false);
        this.applyStored(config);
        this.notice.set('emailSettings.saved');
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const body = err instanceof HttpErrorResponse ? (err.error as { code?: string; missing?: string[] } | null) : null;
        this.errorKey.set(
          body?.code === 'EMAIL_SETTINGS_INCOMPLETE' && Array.isArray(body.missing)
            ? { key: 'emailSettings.incomplete', missing: body.missing }
            : { key: 'adminSettings.errorSave' },
        );
      },
    });
  }

  disconnect(): void {
    const name = this.translate.instant(`emailSettings.providerName.${this.stored()?.provider ?? this.provider()}`);
    this.confirmation.confirm({
      header: this.translate.instant('emailSettings.disconnectConfirmHeader', { provider: name }),
      message: this.translate.instant('emailSettings.disconnectConfirmMessage'),
      acceptLabel: this.translate.instant('emailSettings.disconnect'),
      rejectLabel: this.translate.instant('common.cancel'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.disconnecting.set(true);
        this.tenantService.disconnectEmailConfig().subscribe({
          next: (config) => {
            this.disconnecting.set(false);
            this.connecting.set(false);
            this.resetForms();
            this.applyStored(config);
            this.notice.set('emailSettings.disconnected');
          },
          error: () => {
            this.disconnecting.set(false);
            this.errorKey.set({ key: 'adminSettings.errorSave' });
          },
        });
      },
    });
  }

  /**
   * Shows what is stored. NEVER copies a secret into the form: the server only
   * says 'set', and the secret field shows that as a state, not a value.
   */
  private applyStored(config: IEmailConfig): void {
    this.stored.set(config);
    if (!config.provider) return;
    const provider = config.provider;
    this.form.controls.provider.setValue(provider, { emitEvent: false });
    this.provider.set(provider);
    const group = this.form.controls[provider];
    for (const field of EMAIL_PROVIDER_FIELDS[provider]) {
      if (field.kind === 'secret') {
        group.controls[field.name]!.setValue('', { emitEvent: false });
        continue;
      }
      const value = config.settings?.[field.name];
      group.controls[field.name]!.setValue(value === null || value === undefined ? '' : String(value), { emitEvent: false });
    }
    for (const c of Object.values(group.controls)) c.updateValueAndValidity({ emitEvent: false });
    if (provider === 'smtp') {
      const enc = String(config.settings?.['encryption'] ?? '');
      const port = String(config.settings?.['port'] ?? '');
      this.portEdited = port !== '' && port !== PORT_FOR_ENCRYPTION[enc];
    }
  }

  private resetForms(): void {
    for (const provider of PROVIDERS) this.form.setControl(provider, this.groupFor(provider));
    this.form.controls.provider.setValue('resend', { emitEvent: false });
    this.provider.set('resend');
    this.portEdited = false;
    this.wireSmtp();
  }

  /**
   * SMTP's live rules, wired to its CURRENT controls (again after Disconnect,
   * which replaces them): port follows encryption until edited, and username
   * and password re-check each other (D5).
   */
  private wireSmtp(): void {
    const smtp = this.form.controls.smtp.controls;
    smtp['encryption']!.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((enc) => {
      if (!this.portEdited && enc && PORT_FOR_ENCRYPTION[enc]) {
        smtp['port']!.setValue(PORT_FOR_ENCRYPTION[enc], { emitEvent: false });
      }
    });
    smtp['port']!.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => (this.portEdited = true));
    smtp['username']!.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() =>
      smtp['password']!.updateValueAndValidity({ emitEvent: false }),
    );
    smtp['password']!.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() =>
      smtp['username']!.updateValueAndValidity({ emitEvent: false }),
    );
  }

  private groupFor(provider: EmailProvider): FormGroup<Record<string, FormControl<string>>> {
    const controls: Record<string, FormControl<string>> = {};
    for (const field of EMAIL_PROVIDER_FIELDS[provider]) {
      const initial = field.kind === 'encryption' ? 'STARTTLS' : field.kind === 'port' ? PORT_FOR_ENCRYPTION['STARTTLS']! : '';
      controls[field.name] = new FormControl<string>(initial, { nonNullable: true, validators: this.validatorsFor(provider, field) });
    }
    return new FormGroup(controls);
  }

  private validatorsFor(provider: EmailProvider, field: FieldDef): ValidatorFn[] {
    const v: ValidatorFn[] = [];
    if (field.kind === 'secret') {
      // Required only while nothing is stored: once set, empty means "keep".
      if (field.required) v.push((c) => (this.isSecretSetFor(provider, field.name) ? null : notBlank(c)));
    } else if (field.required) {
      v.push(Validators.required, notBlank);
    }
    if (field.kind === 'email') v.push(Validators.email);
    if (field.kind === 'port') v.push(portRange);
    if (field.pattern) v.push(Validators.pattern(field.pattern));
    if (provider === 'smtp' && (field.name === 'username' || field.name === 'password')) v.push(this.smtpPair(field.name));
    return v;
  }

  /** D5 — SMTP username and password: both or neither. The empty half errors. */
  private smtpPair(name: 'username' | 'password' | string): ValidatorFn {
    return (c: AbstractControl): ValidationErrors | null => {
      const group = c.parent as FormGroup | null;
      if (!group) return null;
      const username = String(group.get('username')?.value ?? '').trim() !== '';
      const password = String(group.get('password')?.value ?? '').trim() !== '' || this.isSecretSetFor('smtp', 'password');
      if (name === 'password' && username && !password) return { pair: true };
      if (name === 'username' && password && !username) return { pair: true };
      return null;
    };
  }

  private isSecretSetFor(provider: EmailProvider, name: string): boolean {
    const s = this.stored();
    return s?.provider === provider && s.settings?.[name] === 'set';
  }
}
