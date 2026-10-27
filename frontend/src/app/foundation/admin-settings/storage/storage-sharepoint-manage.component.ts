import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { map } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService } from '../../../core/formatting';
import { AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';
import { FieldComponent } from '../../../shared/components/field/field.component';
import { SecretFieldComponent } from '../../../shared/components/secret-field/secret-field.component';
import { FilesService } from '../../../shared/files/files.service';
import { IStorageSettings, StorageSettingsService } from './storage-settings.service';
import {
  GUID_PATTERN,
  SP_SECRET_MAX,
  SP_SECRET_MIN,
  TestState,
  calendarDay,
  expiryCandidate,
  sharePointCredentialsBar,
  sharePointCredentialsCandidate,
  storedSharePointCandidate,
  testView,
  withExpiry,
} from './storage-setup';
import { isTimeout, refusalCode, storageRefusalText } from './storage-refusal-text';
import { StorageTestBoxComponent } from './storage-test-box.component';
import { StorageExpiryFieldComponent, noonOf } from './storage-expiry-field.component';

/** What is being changed: nothing, the secret, the app (client ID and its secret), or the expiry date. */
export type SharePointEdit = 'view' | 'secret' | 'client' | 'expiry';

const IDLE: TestState = { status: 'idle' };

/**
 * ACC-260 PR C — a CONFIRMED SharePoint location's credentials, its on-demand
 * test, and Disconnect. The tenant, site and library are the parent's locked
 * fields; the withdrawn banner and the 30-day expiry line are the parent's too.
 *
 * - Replace secret, or Change client ID (which needs that app's secret): both
 *   tested before saving, against the stored tenant, site and library. The
 *   server also refuses credentials that reach another library
 *   (STORAGE_CHANGE_BY_PLATFORM), said in its own sentence.
 * - The expiry date alone: no test (D3).
 * - Test connection: the STORED settings. A pass while access is withdrawn ends
 *   the withdrawal on the server (D5), so the page reads GET again.
 * - Disconnect (D2): SharePoint only, confirmed through the one confirm helper,
 *   refused while files are stored there — with the count, before the click
 *   (disconnectAllowed) and after it (409 STORAGE_LOCKED_BY_FILES).
 *
 * A secret is sent only when typed, and never kept after a save (rule 2).
 */
@Component({
  selector: 'am-storage-sharepoint-manage',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, ButtonModule, InputTextModule, FieldComponent, SecretFieldComponent, StorageTestBoxComponent, StorageExpiryFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3" data-testid="sp-manage" [attr.data-edit]="edit()">
      <div class="am-spm__grid">
        <div class="min-w-0" data-field="spClientId">
          @if (edit() === 'client') {
            <am-field
              [label]="'storage.field.spClientId' | translate"
              [control]="form.controls.clientId"
              inputId="storage-sp-new-client"
              [hint]="'storage.sp.newClientHint' | translate"
              [forceShowErrors]="showErrors()"
              [errorMessages]="clientIdErrors"
            >
              <input pInputText id="storage-sp-new-client" dir="ltr" class="w-full" [formControl]="form.controls.clientId" autocomplete="off" spellcheck="false" data-testid="sp-new-client" />
            </am-field>
          } @else {
            <div class="text-meta font-medium text-ink-700 mb-1">{{ 'storage.field.spClientId' | translate }}</div>
            <div class="am-spm__box"><span class="am-spm__value" dir="ltr" data-testid="sp-client-id">{{ settings().sharepoint.clientId ?? ('storage.field.none' | translate) }}</span></div>
            @if (edit() === 'view') {
              <p-button type="button" size="small" [text]="true" [label]="'storage.sp.changeClient' | translate" (onClick)="start('client')" data-testid="sp-change-client" />
            }
          }
        </div>
        <div class="min-w-0" data-field="spClientSecret">
          <am-secret-field
            [label]="'storage.field.spClientSecret' | translate"
            inputId="storage-sp-new-secret"
            [control]="form.controls.clientSecret"
            [isSet]="settings().sharepoint.clientSecret === 'set' && !typingSecret()"
            [hint]="(typingSecret() ? 'storage.sp.newSecretHint' : '') | translate"
            [errorMessages]="secretErrors"
            [forceShowErrors]="showErrors()"
            (replaceClicked)="start('secret')"
          />
        </div>
        <div class="min-w-0" data-field="spSecretExpires">
          @if (edit() === 'view') {
            <div class="text-meta font-medium text-ink-700 mb-1">{{ 'storage.field.spSecretExpires' | translate }}</div>
            <div class="am-spm__box"><span class="am-spm__value" data-testid="sp-expiry">{{ expiryText() }}</span></div>
            <p-button type="button" size="small" [text]="true" [label]="'storage.sp.changeExpiry' | translate" (onClick)="start('expiry')" data-testid="sp-change-expiry" />
          } @else {
            <am-storage-expiry-field
              [control]="form.controls.secretExpiresOn"
              [label]="(edit() === 'expiry' ? 'storage.field.spSecretExpires' : 'storage.sp.newExpiryOptional') | translate"
              inputId="storage-sp-new-expiry"
              [hint]="'storage.sp.expiryHint' | translate"
              [forceShowErrors]="showErrors()"
            />
          }
        </div>
      </div>

      @if (edit() === 'secret' || edit() === 'client') {
        <am-storage-test-box [view]="credTestView()" passHeadKey="storage.test.spCredentialsPassed" (run)="runCredentialsTest()" />
      } @else if (edit() === 'view') {
        <am-storage-test-box [view]="storedTestView()" (run)="runStoredTest()" />
      }

      @if (edit() !== 'view') {
        <div class="am-spm__bar" data-testid="sp-save-bar">
          <span class="text-meta text-ink-700" data-testid="sp-save-why">{{ saveWhyKey() | translate }}</span>
          <span class="flex flex-wrap items-center gap-2">
            <p-button type="button" severity="secondary" [text]="true" [label]="'common.cancel' | translate" [disabled]="busy()" (onClick)="cancel()" data-testid="sp-cancel" />
            <p-button
              type="button"
              [label]="saveKey() | translate"
              [disabled]="edit() !== 'expiry' && !credBar().canSave"
              [loading]="busy()"
              (onClick)="save()"
              data-testid="sp-save"
            />
          </span>
          @if (saveError()) {
            <p class="m-0 basis-full text-meta font-medium text-danger" role="alert" data-testid="sp-save-error">{{ saveError() }}</p>
          }
        </div>
      }

      @if (edit() === 'view') {
        <div class="am-spm__leave" data-testid="sp-disconnect-row">
          <span class="min-w-0 flex-[1_1_240px] text-meta text-ink-700" data-testid="sp-disconnect-why">{{ disconnectWhy() }}</span>
          <p-button
            type="button"
            severity="danger"
            [outlined]="true"
            size="small"
            [label]="'storage.sp.disconnectOpen' | translate"
            [disabled]="!settings().sharepoint.disconnectAllowed || disconnecting()"
            [loading]="disconnecting()"
            (onClick)="askDisconnect()"
            data-testid="sp-disconnect"
          />
          @if (disconnectError()) {
            <p class="m-0 basis-full text-meta font-medium text-danger" role="alert" data-testid="sp-disconnect-error">{{ disconnectError() }}</p>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .am-spm__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:var(--am-space-12)}
      .am-spm__box{display:flex;align-items:center;min-block-size:var(--am-form-control-height);box-sizing:border-box;padding:0 var(--am-space-8);border-radius:var(--am-radius-control);border:1px solid var(--am-border);background:var(--am-surface)}
      .am-spm__value{min-inline-size:0;font-size:var(--am-type-value-size);font-weight:500;color:var(--am-ink-900);overflow-wrap:anywhere;unicode-bidi:isolate}
      .am-spm__bar,.am-spm__leave{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--am-space-8)}
      .am-spm__bar{padding-block-start:var(--am-space-8)}
      .am-spm__leave{padding-block-start:var(--am-space-12);border-block-start:1px solid var(--am-border)}
    `,
  ],
})
export class StorageSharePointManageComponent {
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly storage = inject(StorageSettingsService);
  private readonly files = inject(FilesService);
  private readonly confirm = inject(AmConfirmService);
  private readonly fb = inject(FormBuilder);

  readonly settings = input.required<IStorageSettings>();
  /** A write was saved, or a test ended a withdrawal: the page reads GET again. */
  readonly saved = output<void>();

  readonly clientIdErrors = { required: 'storage.sp.clientIdRequired', pattern: 'storage.sp.clientIdInvalid' };
  readonly secretErrors = { required: 'storage.sp.secretRequired', minlength: 'storage.sp.secretShort', maxlength: 'validation.maxLength' };

  readonly edit = signal<SharePointEdit>('view');
  readonly typingSecret = computed(() => this.edit() === 'secret' || this.edit() === 'client');
  readonly showErrors = signal(false);
  readonly busy = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly disconnecting = signal(false);
  readonly disconnectError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    clientId: ['', [Validators.required, Validators.pattern(GUID_PATTERN)]],
    clientSecret: ['', [Validators.required, Validators.minLength(SP_SECRET_MIN), Validators.maxLength(SP_SECRET_MAX)]],
    secretExpiresOn: ['', [calendarDay]],
  });
  private readonly value = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue())), { initialValue: this.form.getRawValue() });

  // ── credentials ───────────────────────────────────────────────────────────

  readonly credTest = signal<TestState>(IDLE);
  readonly credCandidate = computed(() =>
    sharePointCredentialsCandidate(this.edit() === 'client' ? this.value().clientId : null, this.value().clientSecret),
  );
  readonly credTestView = computed(() => testView('SHAREPOINT', this.credTest(), this.credCandidate()));
  readonly credBar = computed(() => sharePointCredentialsBar(this.credTest(), this.credCandidate()));

  // ── the stored settings' test (D5) ───────────────────────────────────────

  readonly storedTest = signal<TestState>(IDLE);
  private readonly stored = storedSharePointCandidate();
  readonly storedTestView = computed(() => testView('SHAREPOINT', this.storedTest(), this.stored));

  readonly expiryText = computed(() => {
    const on = this.settings().sharepoint.secretExpiresOn;
    return on ? this.format.date(noonOf(on)) : this.translate.instant('storage.field.notRecorded');
  });

  saveWhyKey(): string {
    return this.edit() === 'expiry' ? 'storage.sp.expiryNoTest' : this.credBar().reasonKey;
  }

  saveKey(): string {
    return { secret: 'storage.sp.saveSecret', client: 'storage.sp.saveClient', expiry: 'storage.sp.saveExpiry', view: '' }[this.edit()];
  }

  start(edit: Exclude<SharePointEdit, 'view'>): void {
    const sp = this.settings().sharepoint;
    this.form.reset();
    // Changing the app starts from the one in use; a new expiry date from the stored one.
    if (edit === 'client') this.form.controls.clientId.setValue(sp.clientId ?? '');
    if (edit === 'expiry') this.form.controls.secretExpiresOn.setValue(sp.secretExpiresOn ?? '');
    this.credTest.set(IDLE);
    this.saveError.set(null);
    this.showErrors.set(false);
    this.edit.set(edit);
  }

  cancel(): void {
    this.edit.set('view');
    this.form.reset();
    this.credTest.set(IDLE);
    this.saveError.set(null);
    this.showErrors.set(false);
  }

  /** The fields this change uses are valid; otherwise every error shows, and nothing is sent. */
  private ready(): boolean {
    const c = this.form.controls;
    const used = this.edit() === 'expiry' ? [c.secretExpiresOn] : this.edit() === 'client' ? [c.clientId, c.clientSecret, c.secretExpiresOn] : [c.clientSecret, c.secretExpiresOn];
    if (used.every((ctl) => ctl.valid)) return true;
    used.forEach((ctl) => ctl.markAsTouched());
    this.showErrors.set(true);
    return false;
  }

  runCredentialsTest(): void {
    if (!this.ready()) return;
    const candidate = this.credCandidate();
    this.credTest.set({ status: 'running', candidate });
    this.storage.test(candidate).subscribe({
      next: (result) => this.credTest.set({ status: 'done', candidate, result, at: new Date().toISOString() }),
      error: (err: unknown) => this.credTest.set({ status: 'error', candidate, timedOut: isTimeout(err) }),
    });
  }

  runStoredTest(): void {
    const candidate = this.stored;
    const wasWithdrawn = this.settings().sharepoint.accessLostAt !== null;
    this.storedTest.set({ status: 'running', candidate });
    this.storage.test(candidate).subscribe({
      next: (result) => {
        this.storedTest.set({ status: 'done', candidate, result, at: new Date().toISOString() });
        // D5: the server has ended the withdrawal; read it back.
        if (result.ok && wasWithdrawn) this.saved.emit();
      },
      error: (err: unknown) => this.storedTest.set({ status: 'error', candidate, timedOut: isTimeout(err) }),
    });
  }

  save(): void {
    if (this.busy()) return;
    if (this.edit() === 'expiry') {
      const on = this.form.controls.secretExpiresOn;
      if (!on.value) on.setErrors({ ...on.errors, date: true });
      if (!this.ready()) return;
      this.send(expiryCandidate(on.value));
      return;
    }
    if (!this.credBar().canSave) return;
    if (!this.ready()) return;
    this.send(withExpiry(this.credCandidate(), this.form.controls.secretExpiresOn.value));
  }

  private send(body: ReturnType<typeof expiryCandidate>): void {
    this.busy.set(true);
    this.saveError.set(null);
    this.storage.replaceKeys(body).subscribe({
      next: () => {
        this.busy.set(false);
        this.cancel();
        this.storedTest.set(IDLE);
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.saveError.set(
          refusalCode(err) === 'STORAGE_CHANGE_BY_PLATFORM'
            ? this.translate.instant('storage.sp.changeByPlatform', { library: this.settings().sharepoint.libraryName ?? '' })
            : storageRefusalText(err, 'SHAREPOINT', 'storage.sp.saveFailed', this.files, this.translate),
        );
      },
    });
  }

  // ── Disconnect (D2) ───────────────────────────────────────────────────────

  disconnectWhy(): string {
    const sp = this.settings().sharepoint;
    return sp.disconnectAllowed
      ? this.translate.instant('storage.sp.disconnectAllowed')
      : this.format.count('storage.spDisconnectLocked', sp.filesStored);
  }

  askDisconnect(): void {
    if (!this.settings().sharepoint.disconnectAllowed || this.disconnecting()) return;
    this.confirm.ask({
      tone: 'destructive',
      header: this.translate.instant('storage.sp.disconnectHeader'),
      message: this.translate.instant('storage.sp.disconnectMessage'),
      acceptLabel: this.translate.instant('storage.sp.disconnect'),
      accept: () => this.disconnect(),
    });
  }

  private disconnect(): void {
    this.disconnecting.set(true);
    this.disconnectError.set(null);
    this.storage.disconnect().subscribe({
      next: () => {
        this.disconnecting.set(false);
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.disconnecting.set(false);
        const body = (err as { error?: { filesStored?: unknown } })?.error;
        if (refusalCode(err) === 'STORAGE_LOCKED_BY_FILES') {
          const n = typeof body?.filesStored === 'number' ? body.filesStored : this.settings().sharepoint.filesStored;
          this.disconnectError.set(this.format.count('storage.spLockedByFiles', n));
          // A file arrived since the page was read: read it again, so the button says so too.
          this.saved.emit();
          return;
        }
        this.disconnectError.set(storageRefusalText(err, 'SHAREPOINT', 'storage.sp.disconnectFailed', this.files, this.translate));
      },
    });
  }
}
