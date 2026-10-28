import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { map } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { FormatService } from '../../../core/formatting';
import { AuthService } from '../../../core/services/auth.service';
import { FieldComponent } from '../../../shared/components/field/field.component';
import { SecretFieldComponent } from '../../../shared/components/secret-field/secret-field.component';
import { FilesService } from '../../../shared/files/files.service';
import { IStorageSettings, StorageKind, StorageSettingsService } from './storage-settings.service';
import { FieldView, SharePointHealth, ValuePart, currentFields, currentKind, optionsView, sharePointHealth } from './storage-view';
import { StorageSharePointManageComponent } from './storage-sharepoint-manage.component';
import { StorageExpiryFieldComponent, noonOf } from './storage-expiry-field.component';
import { isTimeout, refusalCode, storageRefusalText } from './storage-refusal-text';
import {
  ACCESS_KEY_MIN,
  BUCKET_PATTERN,
  GUID_PATTERN,
  KEY_MAX,
  LIBRARY_MAX,
  REGION_PATTERN,
  ROOT_PATH_PATTERN,
  SECRET_KEY_MIN,
  SITE_URL_MAX,
  SP_SECRET_MAX,
  SP_SECRET_MIN,
  SetupKind,
  TENANT_MAX,
  TENANT_PATTERN,
  TestState,
  calendarDay,
  choosable,
  confirmBar,
  confirmLocation,
  endpointUrl,
  initialSelection,
  keysBar,
  keysCandidate,
  notBlank,
  setupCandidate,
  sharePointSiteUrl,
  testView,
  withExpiry,
} from './storage-setup';
import { StorageTestBoxComponent } from './storage-test-box.component';
import { StorageConfirmDialogComponent } from './storage-confirm-dialog.component';

/**
 * Drawn as live controls rather than locked boxes: MinIO's keys (replaced
 * together, never shown back, rule 2, design L1054), and SharePoint's client
 * ID, secret and expiry date (PR C, StorageSharePointManageComponent).
 */
const KEY_FIELDS = new Set(['accessKey', 'secretKey', 'spClientId', 'spClientSecret', 'spSecretExpires']);

type TestsByKind = Record<SetupKind, TestState>;
const IDLE: TestState = { status: 'idle' };
const NO_TESTS: TestsByKind = { S3: IDLE, MINIO: IDLE, LOCAL_FILESYSTEM: IDLE, SHAREPOINT: IDLE };

/**
 * ACC-260 — the "Where files are kept" card (design L70–140).
 *
 * PR A: the four options, and the confirmed location open with its details,
 * read-only. Where files are is locked (🔒); AccreditMe cloud shows only that
 * AccreditMe manages it (rule 1).
 *
 * PR B, before confirming: a real choice. AccreditMe cloud and MinIO always, a
 * local folder where this installation offers it, and (PR C) SharePoint.
 * - AccreditMe cloud: "Nothing to set up", then Confirm. No test.
 * - MinIO and a local folder: their fields, then Test, then Confirm, which
 *   opens only after a pass for EXACTLY the values on screen.
 * - Confirm opens the 420 dialog and sends POST /tenant/storage/confirm.
 *
 * PR B, once confirmed on MinIO: Replace on either key opens both; Test, then
 * "Save new key" sends PATCH /tenant/storage with the two keys only.
 *
 * PR C, SharePoint (Ahmad's D1, D12): the API's six fields in MinIO's layout,
 * the test with SharePoint's steps, and the "site › library" it found before
 * Confirm. Once confirmed: StorageSharePointManageComponent.
 *
 * A secret is sent only when typed, and the form is emptied after a save
 * (rule 2). Every write ends in `saved`, and the page reloads GET.
 */
@Component({
  selector: 'am-storage-location',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    TranslatePipe,
    ButtonModule,
    InputTextModule,
    FieldComponent,
    SecretFieldComponent,
    StorageTestBoxComponent,
    StorageConfirmDialogComponent,
    StorageSharePointManageComponent,
    StorageExpiryFieldComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="am-sl rounded-card border border-rule bg-surface-raised" data-testid="storage-location">
      <header class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-2.5 border-b border-rule">
        <h2 class="m-0 text-heading" id="am-sl-title">{{ (confirmed() ? 'storage.location.fixedTitle' : 'storage.location.chooseTitle') | translate }}</h2>
        <span class="text-meta text-ink-500">{{ (confirmed() ? 'storage.location.fixedSub' : 'storage.location.chooseSub') | translate }}</span>
      </header>
      <ul class="m-0 p-0 list-none" [attr.role]="confirmed() ? null : 'radiogroup'" aria-labelledby="am-sl-title">
        @for (o of options(); track o.kind) {
          <li
            class="am-sl__opt"
            [class.am-sl__opt--current]="o.current || isSelected(o.kind)"
            [attr.data-option]="o.kind"
            [attr.aria-current]="o.current ? 'true' : null"
          >
            @if (confirmed()) {
              <div class="flex gap-2.5 items-start">
                <span class="am-sl__dot" [class.am-sl__dot--current]="o.current" [class.am-sl__dot--off]="o.disabled" aria-hidden="true">{{ o.current ? '●' : '' }}</span>
                <ng-container *ngTemplateOutlet="optionText; context: { $implicit: o }" />
              </div>
            } @else {
              <label class="flex gap-2.5 items-start" [class.cursor-pointer]="canChoose(o.kind)">
                <input
                  type="radio"
                  class="am-sl__radio"
                  name="am-storage-kind"
                  [value]="o.kind"
                  [checked]="isSelected(o.kind)"
                  [disabled]="!canChoose(o.kind) || busy()"
                  (change)="choose(o.kind)"
                  [attr.data-testid]="'choose-' + o.kind"
                />
                <ng-container *ngTemplateOutlet="optionText; context: { $implicit: o }" />
              </label>
            }

            @if (o.current) {
              <div class="am-sl__body" data-testid="current-body">
                @if (o.kind === 'S3') {
                  <div class="am-sl__banner" data-testid="cloud-managed">
                    <div class="font-semibold text-body">{{ 'storage.cloud.managedTitle' | translate }}</div>
                    <div class="text-value">{{ 'storage.cloud.managedBody' | translate }}</div>
                  </div>
                }
                @if (health(); as h) {
                  @if (h.state === 'withdrawn') {
                    <div class="am-sl__banner am-sl__banner--danger" role="alert" data-testid="sp-withdrawn">
                      <div class="font-semibold text-body text-danger">{{ 'storage.sp.withdrawnTitle' | translate }}</div>
                      <div class="text-value">{{ withdrawnBody(h) }}</div>
                      <div class="text-value">{{ 'storage.sp.withdrawnSince' | translate: { date: format.date(h.since) } }}</div>
                      <div class="text-value">{{ 'storage.sp.withdrawnTest' | translate }}</div>
                    </div>
                  } @else if (h.state === 'expiring' || h.state === 'expired') {
                    <div class="am-sl__banner am-sl__banner--warn" role="status" data-testid="sp-expiring">
                      <div class="text-value">{{ (h.state === 'expiring' ? 'storage.sp.expiring' : 'storage.sp.expired') | translate: { date: format.date(noon(h.on)) } }}</div>
                    </div>
                  }
                }
                @if (lockedFields().length) {
                  <div class="am-sl__grid" data-testid="current-fields">
                    @for (f of lockedFields(); track f.id) {
                      <div class="min-w-0" [attr.data-field]="f.id">
                        <div class="text-meta font-medium text-ink-700 mb-1">{{ f.labelKey | translate }}</div>
                        <div class="am-sl__box" [class.am-sl__box--locked]="f.locked">
                          <span class="am-sl__value" [attr.dir]="f.ltr ? 'ltr' : null" data-testid="field-value">{{ valueOf(f) }}</span>
                          @if (f.locked) {
                            <span class="flex-none text-ink-500" aria-hidden="true">🔒</span>
                          }
                        </div>
                        @if (f.helpKey) {
                          <div class="text-meta text-ink-500 mt-1" data-testid="field-help">{{ f.helpKey | translate }}</div>
                        }
                      </div>
                    }
                  </div>
                }
                @if (o.kind === 'MINIO') {
                  <div class="am-sl__grid" data-testid="minio-keys">
                    <div class="min-w-0" data-field="accessKey">
                      <am-secret-field
                        [label]="'storage.field.accessKey' | translate"
                        inputId="storage-keys-access"
                        [control]="keysForm.controls.accessKeyId"
                        [isSet]="settings().minio.accessKeyId === 'set' && !replacing()"
                        [hint]="(replacing() ? 'storage.keys.accessHint' : '') | translate"
                        [errorMessages]="keyErrors"
                        [forceShowErrors]="showKeysErrors()"
                        (replaceClicked)="startReplace()"
                      />
                    </div>
                    <div class="min-w-0" data-field="secretKey">
                      <am-secret-field
                        [label]="'storage.field.secretKey' | translate"
                        inputId="storage-keys-secret"
                        [control]="keysForm.controls.secretAccessKey"
                        [isSet]="settings().minio.secretAccessKey === 'set' && !replacing()"
                        [hint]="(replacing() ? 'storage.keys.secretHint' : '') | translate"
                        [errorMessages]="secretErrors"
                        [forceShowErrors]="showKeysErrors()"
                        (replaceClicked)="startReplace()"
                      />
                    </div>
                  </div>
                  @if (replacing()) {
                    <am-storage-test-box [view]="keysTestView()" passHeadKey="storage.test.keysPassed" (run)="runKeysTest()" />
                  }
                }
                @if (o.kind === 'SHAREPOINT') {
                  <am-storage-sharepoint-manage [settings]="settings()" (saved)="saved.emit()" />
                }
              </div>
            } @else if (!confirmed() && isSelected(o.kind)) {
              <div class="am-sl__body" data-testid="setup-body" [attr.data-setup]="o.kind">
                @switch (o.kind) {
                  @case ('S3') {
                    <div class="am-sl__banner" data-testid="cloud-setup">
                      <div class="font-semibold text-body">{{ 'storage.setup.cloudTitle' | translate }}</div>
                      <div class="text-value">{{ 'storage.setup.cloudBody' | translate }}</div>
                    </div>
                  }
                  @case ('MINIO') {
                    <div class="flex flex-col gap-3" data-testid="minio-form">
                      <am-field
                        [label]="'storage.field.endpoint' | translate"
                        [control]="minioForm.controls.endpoint"
                        inputId="storage-minio-endpoint"
                        [hint]="'storage.setup.endpointHint' | translate"
                        [forceShowErrors]="showErrors()"
                        [errorMessages]="{ endpoint: 'storage.setup.endpointInvalid', maxlength: 'validation.maxLength' }"
                      >
                        <input pInputText id="storage-minio-endpoint" dir="ltr" class="w-full" [formControl]="minioForm.controls.endpoint" autocomplete="off" spellcheck="false" placeholder="https://" />
                      </am-field>
                      <div class="am-sl__grid">
                        <am-field
                          [label]="'storage.field.bucket' | translate"
                          [control]="minioForm.controls.bucket"
                          inputId="storage-minio-bucket"
                          [hint]="'storage.setup.bucketHint' | translate"
                          [forceShowErrors]="showErrors()"
                          [errorMessages]="{ pattern: 'storage.setup.bucketInvalid' }"
                        >
                          <input pInputText id="storage-minio-bucket" dir="ltr" class="w-full" [formControl]="minioForm.controls.bucket" autocomplete="off" spellcheck="false" />
                        </am-field>
                        <am-field
                          [label]="'storage.setup.regionOptional' | translate"
                          [control]="minioForm.controls.region"
                          inputId="storage-minio-region"
                          [hint]="'storage.setup.regionHint' | translate"
                          [forceShowErrors]="showErrors()"
                          [errorMessages]="{ pattern: 'storage.setup.regionInvalid' }"
                        >
                          <input pInputText id="storage-minio-region" dir="ltr" class="w-full" [formControl]="minioForm.controls.region" autocomplete="off" spellcheck="false" />
                        </am-field>
                      </div>
                      <div class="am-sl__grid">
                        <am-secret-field
                          [label]="'storage.field.accessKey' | translate"
                          inputId="storage-minio-access"
                          [control]="minioForm.controls.accessKeyId"
                          [isSet]="settings().minio.accessKeyId === 'set'"
                          [errorMessages]="keyErrors"
                          [forceShowErrors]="showErrors()"
                        />
                        <am-secret-field
                          [label]="'storage.field.secretKey' | translate"
                          inputId="storage-minio-secret"
                          [control]="minioForm.controls.secretAccessKey"
                          [isSet]="settings().minio.secretAccessKey === 'set'"
                          [hint]="'storage.setup.secretHint' | translate"
                          [errorMessages]="secretErrors"
                          [forceShowErrors]="showErrors()"
                        />
                      </div>
                    </div>
                    <am-storage-test-box [view]="setupTestView()" (run)="runTest()" />
                  }
                  @case ('LOCAL_FILESYSTEM') {
                    <am-field
                      [label]="'storage.field.folderPath' | translate"
                      [control]="localForm.controls.rootPath"
                      inputId="storage-local-path"
                      [hint]="'storage.setup.folderHint' | translate"
                      [forceShowErrors]="showErrors()"
                      [errorMessages]="{ pattern: 'storage.setup.folderInvalid', maxlength: 'validation.maxLength' }"
                    >
                      <input pInputText id="storage-local-path" dir="ltr" class="w-full" [formControl]="localForm.controls.rootPath" autocomplete="off" spellcheck="false" data-testid="local-path" />
                    </am-field>
                    <am-storage-test-box [view]="setupTestView()" (run)="runTest()" />
                  }
                  @case ('SHAREPOINT') {
                    <!-- D12: "How to prepare SharePoint" links to the customer guide
                         (docs/customer/sharepoint-storage-setup.md) once it is published
                         where a customer can open it. Until then, this sentence. -->
                    <p class="m-0 text-value text-ink-700" data-testid="sp-prepare">{{ 'storage.sp.prepare' | translate }}</p>
                    <div class="flex flex-col gap-3" data-testid="sp-form">
                      <div class="am-sl__grid">
                        <am-field
                          [label]="'storage.field.spTenant' | translate"
                          [control]="spForm.controls.tenant"
                          inputId="storage-sp-tenant"
                          [hint]="'storage.sp.tenantHint' | translate"
                          [forceShowErrors]="showErrors()"
                          [errorMessages]="{ required: 'storage.sp.tenantRequired', pattern: 'storage.sp.tenantInvalid', maxlength: 'validation.maxLength' }"
                        >
                          <input pInputText id="storage-sp-tenant" dir="ltr" class="w-full" [formControl]="spForm.controls.tenant" autocomplete="off" spellcheck="false" />
                        </am-field>
                        <am-field
                          [label]="'storage.field.spClientId' | translate"
                          [control]="spForm.controls.clientId"
                          inputId="storage-sp-client"
                          [hint]="'storage.sp.clientIdHint' | translate"
                          [forceShowErrors]="showErrors()"
                          [errorMessages]="{ required: 'storage.sp.clientIdRequired', pattern: 'storage.sp.clientIdInvalid' }"
                        >
                          <input pInputText id="storage-sp-client" dir="ltr" class="w-full" [formControl]="spForm.controls.clientId" autocomplete="off" spellcheck="false" />
                        </am-field>
                      </div>
                      <div class="am-sl__grid">
                        <am-secret-field
                          [label]="'storage.field.spClientSecret' | translate"
                          inputId="storage-sp-secret"
                          [control]="spForm.controls.clientSecret"
                          [isSet]="settings().sharepoint.clientSecret === 'set'"
                          [hint]="'storage.sp.secretHint' | translate"
                          [errorMessages]="spSecretErrors"
                          [forceShowErrors]="showErrors()"
                        />
                        <am-storage-expiry-field
                          [control]="spForm.controls.secretExpiresOn"
                          [label]="'storage.sp.expiryOptional' | translate"
                          inputId="storage-sp-expiry"
                          [hint]="'storage.sp.expiryHint' | translate"
                          [forceShowErrors]="showErrors()"
                        />
                      </div>
                      <am-field
                        [label]="'storage.field.spSiteUrl' | translate"
                        [control]="spForm.controls.siteUrl"
                        inputId="storage-sp-site"
                        [hint]="'storage.sp.siteUrlHint' | translate"
                        [forceShowErrors]="showErrors()"
                        [errorMessages]="{ required: 'storage.sp.siteUrlRequired', siteUrl: 'storage.sp.siteUrlInvalid', maxlength: 'validation.maxLength' }"
                      >
                        <input pInputText id="storage-sp-site" dir="ltr" class="w-full" [formControl]="spForm.controls.siteUrl" autocomplete="off" spellcheck="false" placeholder="https://" />
                      </am-field>
                      <am-field
                        [label]="'storage.field.spLibrary' | translate"
                        [control]="spForm.controls.libraryName"
                        inputId="storage-sp-library"
                        [hint]="'storage.sp.libraryHint' | translate"
                        [forceShowErrors]="showErrors()"
                        [errorMessages]="{ required: 'storage.sp.libraryRequired', maxlength: 'validation.maxLength' }"
                      >
                        <input pInputText id="storage-sp-library" class="w-full" [formControl]="spForm.controls.libraryName" autocomplete="off" spellcheck="false" />
                      </am-field>
                    </div>
                    <am-storage-test-box [view]="setupTestView()" (run)="runTest()" />
                  }
                }
              </div>
            }
          </li>
        }
      </ul>

      @if (!confirmed()) {
        <div class="am-sl__bar" data-testid="save-bar">
          <span class="text-meta text-ink-700" data-testid="save-why">{{ setupBar().reasonKey | translate }}</span>
          <p-button
            type="button"
            [label]="'storage.save.confirm.' + selected() | translate"
            [disabled]="!setupBar().canSave || busy()"
            (onClick)="openConfirm()"
            data-testid="confirm-open"
          />
        </div>
      } @else if (replacing()) {
        <div class="am-sl__bar" data-testid="save-bar">
          <span class="text-meta text-ink-700" data-testid="save-why">{{ keysSaveBar().reasonKey | translate }}</span>
          <span class="flex flex-wrap items-center gap-2">
            <p-button type="button" severity="secondary" [text]="true" [label]="'common.cancel' | translate" [disabled]="busy()" (onClick)="cancelReplace()" data-testid="keys-cancel" />
            <p-button
              type="button"
              [label]="'storage.keys.save' | translate"
              [disabled]="!keysSaveBar().canSave"
              [loading]="busy()"
              (onClick)="saveKeys()"
              data-testid="keys-save"
            />
          </span>
          @if (keysError()) {
            <p class="m-0 basis-full text-meta font-medium text-danger" role="alert" data-testid="keys-error">{{ keysError() }}</p>
          }
        </div>
      }
    </section>

    <ng-template #optionText let-o>
      <span class="min-w-0 flex-auto">
        <span class="flex flex-wrap items-center gap-2">
          <span class="text-body" [class.font-semibold]="o.current || isSelected(o.kind)" [class.text-ink-500]="o.disabled || (!confirmed() && !canChoose(o.kind))" data-testid="option-title">{{ 'storage.kind.' + o.kind + '.name' | translate }}</span>
          @if (o.current) {
            <span class="text-micro font-semibold text-ink-700 bg-surface border border-rule rounded-control px-1.5" data-testid="option-current">{{ 'storage.location.current' | translate }}</span>
          }
        </span>
        <span class="block text-meta text-ink-500">{{ descKey(o.kind, o.offered) | translate }}</span>
      </span>
    </ng-template>

    @if (!confirmed()) {
      <am-storage-confirm-dialog
        [visible]="confirmOpen()"
        (visibleChange)="onConfirmVisible($event)"
        [kind]="selected()"
        [location]="confirmedLocation()"
        [locationName]="'storage.kind.' + selected() + '.name' | translate"
        [by]="userName()"
        [busy]="busy()"
        [error]="confirmError()"
        (confirm)="confirm()"
      />
    }
  `,
  styles: [
    `
      .am-sl__opt{padding:var(--am-space-12) var(--am-space-16);border-block-end:1px solid var(--am-border)}
      .am-sl__opt:last-child{border-block-end:0}
      .am-sl__opt--current{background:var(--am-surface)}
      .am-sl__dot{flex:none;inline-size:var(--am-space-16);block-size:var(--am-space-16);margin-block-start:var(--am-space-2);box-sizing:border-box;border-radius:var(--am-radius-pill);border:1px solid var(--am-control-border);background:var(--am-surface-raised);font-size:var(--am-type-micro-size);line-height:calc(var(--am-space-16) - 2px);text-align:center;color:var(--am-ink-700)}
      .am-sl__dot--off{background:var(--am-surface);border-color:var(--am-border)}
      .am-sl__dot--current{background:var(--am-surface);border-color:var(--am-ink-500)}
      .am-sl__radio{flex:none;inline-size:var(--am-space-16);block-size:var(--am-space-16);margin:var(--am-space-2) 0 0;accent-color:var(--am-primary-600)}
      .am-sl__radio:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-sl__body{display:flex;flex-direction:column;gap:var(--am-space-12);margin-block-start:var(--am-space-12);margin-inline-start:var(--am-space-24);max-inline-size:720px}
      .am-sl__banner{border-radius:var(--am-radius-card);padding:var(--am-space-8) var(--am-space-12);background:var(--am-surface);border:1px solid var(--am-border);color:var(--am-ink-900)}
      .am-sl__opt--current .am-sl__banner{background:var(--am-surface-raised)}
      .am-sl__banner--danger{background:var(--am-danger-bg);border-color:var(--am-danger-border)}
      .am-sl__banner--warn{background:var(--am-warning-bg);border-color:var(--am-warning-border)}
      .am-sl__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:var(--am-space-12)}
      .am-sl__box{display:flex;align-items:center;gap:var(--am-space-8);min-block-size:var(--am-form-control-height);box-sizing:border-box;padding:0 var(--am-space-8);border-radius:var(--am-radius-control);border:1px solid var(--am-border);background:var(--am-surface)}
      .am-sl__value{flex:1 1 auto;min-inline-size:0;font-size:var(--am-type-value-size);font-weight:500;color:var(--am-ink-900);overflow-wrap:anywhere;unicode-bidi:isolate}
      .am-sl__bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--am-space-8);padding:var(--am-space-8) var(--am-space-16);border-block-start:1px solid var(--am-border);background:var(--am-surface)}
    `,
  ],
})
export class StorageLocationComponent {
  protected readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly storage = inject(StorageSettingsService);
  private readonly files = inject(FilesService);
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  readonly settings = input.required<IStorageSettings>();
  /** Today, YYYY-MM-DD: the expiry warning counts days from it. */
  readonly today = input.required<string>();
  /** A write was saved: the page reads GET again. */
  readonly saved = output<void>();

  readonly confirmed = computed(() => currentKind(this.settings()) !== null);
  readonly options = computed(() => optionsView(this.settings()));
  /** The confirmed location's details; MinIO's two keys are drawn as secrets instead. */
  readonly lockedFields = computed(() => currentFields(this.settings()).filter((f) => !KEY_FIELDS.has(f.id)));
  readonly health = computed<SharePointHealth | null>(() => sharePointHealth(this.settings(), this.today()));
  readonly userName = computed(() => this.auth.currentUser()?.name ?? '');

  readonly keyErrors = { required: 'storage.setup.keyRequired', minlength: 'storage.setup.keyShort', maxlength: 'validation.maxLength' };
  readonly secretErrors = { required: 'storage.setup.secretRequired', minlength: 'storage.setup.secretShort', maxlength: 'validation.maxLength' };
  readonly spSecretErrors = { required: 'storage.sp.secretRequired', minlength: 'storage.sp.secretShort', maxlength: 'validation.maxLength' };

  // ── first-time setup ───────────────────────────────────────────────────────

  readonly selected = signal<SetupKind>('S3');
  readonly showErrors = signal(false);
  readonly busy = signal(false);
  readonly confirmOpen = signal(false);
  readonly confirmError = signal<string | null>(null);
  private reloadOnClose = false;
  private applied = false;
  private readonly tests = signal<TestsByKind>(NO_TESTS);

  readonly minioForm = this.fb.nonNullable.group({
    endpoint: ['', [Validators.required, endpointUrl, Validators.maxLength(500)]],
    bucket: ['', [Validators.required, Validators.pattern(BUCKET_PATTERN)]],
    region: ['', [Validators.pattern(REGION_PATTERN)]],
    accessKeyId: ['', [Validators.minLength(ACCESS_KEY_MIN), Validators.maxLength(KEY_MAX)]],
    secretAccessKey: ['', [Validators.minLength(SECRET_KEY_MIN), Validators.maxLength(KEY_MAX)]],
  });
  readonly localForm = this.fb.nonNullable.group({
    rootPath: ['', [Validators.required, Validators.pattern(ROOT_PATH_PATTERN), Validators.maxLength(255)]],
  });
  /** SharePoint's six fields (D1): the server's SharePointSettingsDto rules. */
  readonly spForm = this.fb.nonNullable.group({
    tenant: ['', [Validators.required, Validators.pattern(TENANT_PATTERN), Validators.maxLength(TENANT_MAX)]],
    clientId: ['', [Validators.required, Validators.pattern(GUID_PATTERN)]],
    clientSecret: ['', [Validators.minLength(SP_SECRET_MIN), Validators.maxLength(SP_SECRET_MAX)]],
    siteUrl: ['', [Validators.required, sharePointSiteUrl, Validators.maxLength(SITE_URL_MAX)]],
    libraryName: ['', [notBlank, Validators.maxLength(LIBRARY_MAX)]],
    secretExpiresOn: ['', [calendarDay]],
  });
  private readonly spValue = toSignal(this.spForm.valueChanges.pipe(map(() => this.spForm.getRawValue())), {
    initialValue: this.spForm.getRawValue(),
  });
  private readonly minioValue = toSignal(this.minioForm.valueChanges.pipe(map(() => this.minioForm.getRawValue())), {
    initialValue: this.minioForm.getRawValue(),
  });
  private readonly localValue = toSignal(this.localForm.valueChanges.pipe(map(() => this.localForm.getRawValue())), {
    initialValue: this.localForm.getRawValue(),
  });

  /** The body Test and Confirm send: exactly the values on screen. */
  readonly candidate = computed(() => setupCandidate(this.selected(), this.minioValue(), this.localValue(), this.spValue()));
  readonly setupTestView = computed(() => testView(this.selected(), this.tests()[this.selected()], this.candidate()));
  readonly setupBar = computed(() => confirmBar(this.selected(), this.tests()[this.selected()], this.candidate()));
  readonly confirmedLocation = computed(() => confirmLocation(this.selected(), this.candidate(), this.tests()[this.selected()]));

  // ── replacing the MinIO keys ───────────────────────────────────────────────

  readonly replacing = signal(false);
  readonly showKeysErrors = signal(false);
  readonly keysTest = signal<TestState>(IDLE);
  readonly keysError = signal<string | null>(null);
  readonly keysForm = this.fb.nonNullable.group({
    accessKeyId: ['', [Validators.required, Validators.minLength(ACCESS_KEY_MIN), Validators.maxLength(KEY_MAX)]],
    secretAccessKey: ['', [Validators.required, Validators.minLength(SECRET_KEY_MIN), Validators.maxLength(KEY_MAX)]],
  });
  private readonly keysValue = toSignal(this.keysForm.valueChanges.pipe(map(() => this.keysForm.getRawValue())), {
    initialValue: this.keysForm.getRawValue(),
  });
  readonly keysCandidate = computed(() => keysCandidate(this.keysValue().accessKeyId, this.keysValue().secretAccessKey));
  readonly keysTestView = computed(() => testView('MINIO', this.keysTest(), this.keysCandidate()));
  readonly keysSaveBar = computed(() => keysBar(this.keysTest(), this.keysCandidate()));

  constructor() {
    // On arrival, before confirming: select the draft being set up (else
    // AccreditMe cloud) and show its stored values. Never a secret: GET has
    // none, only "set", and a stored key makes typing one optional.
    effect(() => {
      const s = this.settings();
      untracked(() => {
        if (this.applied || currentKind(s)) return;
        this.applied = true;
        this.selected.set(initialSelection(s));
        this.minioForm.patchValue({ endpoint: s.minio.endpoint ?? '', bucket: s.minio.bucket ?? '', region: s.minio.region ?? '' });
        this.localForm.patchValue({ rootPath: s.local.rootPath ?? '' });
        const sp = s.sharepoint;
        this.spForm.patchValue({
          tenant: sp.tenant ?? '',
          clientId: sp.clientId ?? '',
          siteUrl: sp.siteUrl ?? '',
          libraryName: sp.libraryName ?? '',
          secretExpiresOn: sp.secretExpiresOn ?? '',
        });
        this.requireUnlessStored(this.minioForm.controls.accessKeyId, s.minio.accessKeyId === 'set');
        this.requireUnlessStored(this.minioForm.controls.secretAccessKey, s.minio.secretAccessKey === 'set');
        this.requireUnlessStored(this.spForm.controls.clientSecret, sp.clientSecret === 'set');
      });
    });
  }

  private requireUnlessStored(control: typeof this.minioForm.controls.accessKeyId, stored: boolean): void {
    if (stored) control.removeValidators(Validators.required);
    else control.addValidators(Validators.required);
    control.updateValueAndValidity({ emitEvent: false });
  }

  isSelected(kind: StorageKind): boolean {
    return !this.confirmed() && this.selected() === kind;
  }

  canChoose(kind: StorageKind): boolean {
    return choosable(this.settings(), kind);
  }

  choose(kind: StorageKind): void {
    if (!choosable(this.settings(), kind)) return;
    this.selected.set(kind);
    this.showErrors.set(false);
  }

  descKey(kind: string, offered: boolean): string {
    return kind === 'LOCAL_FILESYSTEM' && !offered ? 'storage.kind.LOCAL_FILESYSTEM.descNotOffered' : `storage.kind.${kind}.desc`;
  }

  /** "Set", "None · On", a date, or the tenant's own text, joined by " · ". */
  valueOf(f: FieldView): string {
    return f.value.map((p: ValuePart) => ('text' in p ? p.text : 'date' in p ? this.format.date(p.date) : this.translate.instant(p.key))).join(' · ');
  }

  /** A YYYY-MM-DD day as an instant no time zone moves to another day. */
  noon(day: string): string {
    return noonOf(day);
  }

  withdrawnBody(h: Extract<SharePointHealth, { state: 'withdrawn' }>): string {
    return this.translate.instant(`storage.sp.withdrawn.${h.reason ?? 'UNKNOWN'}`, { library: this.settings().sharepoint.libraryName ?? '' });
  }

  // ── Test ───────────────────────────────────────────────────────────────────

  runTest(): void {
    const kind = this.selected();
    if (kind === 'S3') return;
    const form = kind === 'MINIO' ? this.minioForm : kind === 'SHAREPOINT' ? this.spForm : this.localForm;
    if (form.invalid) {
      form.markAllAsTouched();
      this.showErrors.set(true);
      return;
    }
    const candidate = this.candidate();
    this.setTest(kind, { status: 'running', candidate });
    this.storage.test(candidate).subscribe({
      next: (result) => this.setTest(kind, { status: 'done', candidate, result, at: new Date().toISOString() }),
      error: (err: unknown) => this.setTest(kind, { status: 'error', candidate, timedOut: isTimeout(err) }),
    });
  }

  private setTest(kind: SetupKind, state: TestState): void {
    this.tests.update((t) => ({ ...t, [kind]: state }));
  }

  // ── Confirm ────────────────────────────────────────────────────────────────

  openConfirm(): void {
    if (!this.setupBar().canSave) return;
    this.confirmError.set(null);
    this.confirmOpen.set(true);
  }

  onConfirmVisible(open: boolean): void {
    this.confirmOpen.set(open);
    // Someone else confirmed first: the page is out of date, so read it again.
    if (!open && this.reloadOnClose) {
      this.reloadOnClose = false;
      this.saved.emit();
    }
  }

  confirm(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.confirmError.set(null);
    // The expiry date rides along (D3): it is a reminder, not something the test checks.
    this.storage.confirm(withExpiry(this.candidate(), this.spValue().secretExpiresOn)).subscribe({
      next: () => {
        this.busy.set(false);
        this.confirmOpen.set(false);
        this.clearSetup();
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        // The values stay on the page; the dialog says why and that nothing changed.
        this.confirmError.set(storageRefusalText(err, this.selected(), 'storage.confirm.failed', this.files, this.translate));
        if (refusalCode(err) === 'STORAGE_ALREADY_CONFIRMED') this.reloadOnClose = true;
      },
    });
  }

  /** After a confirm: no typed value, secret or otherwise, is kept (rule 2). */
  private clearSetup(): void {
    this.minioForm.reset();
    this.localForm.reset();
    this.spForm.reset();
    this.tests.set(NO_TESTS);
    this.showErrors.set(false);
  }

  // ── Replace the MinIO keys ─────────────────────────────────────────────────

  startReplace(): void {
    this.keysForm.reset();
    this.keysTest.set(IDLE);
    this.keysError.set(null);
    this.showKeysErrors.set(false);
    this.replacing.set(true);
  }

  cancelReplace(): void {
    this.replacing.set(false);
    this.keysForm.reset();
    this.keysTest.set(IDLE);
    this.keysError.set(null);
    this.showKeysErrors.set(false);
  }

  runKeysTest(): void {
    if (this.keysForm.invalid) {
      this.keysForm.markAllAsTouched();
      this.showKeysErrors.set(true);
      return;
    }
    const candidate = this.keysCandidate();
    this.keysTest.set({ status: 'running', candidate });
    this.storage.test(candidate).subscribe({
      next: (result) => this.keysTest.set({ status: 'done', candidate, result, at: new Date().toISOString() }),
      error: (err: unknown) => this.keysTest.set({ status: 'error', candidate, timedOut: isTimeout(err) }),
    });
  }

  saveKeys(): void {
    if (this.busy() || !this.keysSaveBar().canSave) return;
    this.busy.set(true);
    this.keysError.set(null);
    this.storage.replaceKeys(this.keysCandidate()).subscribe({
      next: () => {
        this.busy.set(false);
        this.cancelReplace();
        this.saved.emit();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.keysError.set(storageRefusalText(err, 'MINIO', 'storage.keys.failed', this.files, this.translate));
      },
    });
  }
}
