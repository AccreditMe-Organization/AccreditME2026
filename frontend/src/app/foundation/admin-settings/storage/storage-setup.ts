import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { IStorageCandidate, IStorageSettings, IStorageTestResult, StorageKind, StorageTestStep } from './storage-settings.service';

/**
 * ACC-260, PR B — first-time setup and replacing the MinIO keys, as pure
 * functions, so every rule is specified (and mutation-checked) without a page.
 * Design: AccreditMe Storage Settings.dc.html, states 1–10, 15–19 and 23
 * (L613–694); plan: backend/Plans/step-260-storage-settings.md §1.4, §1.5, §3.
 *
 * - A body carries a secret ONLY when the person typed one (rule 2). Omitted,
 *   the server keeps the stored value; it is never sent as null or ''.
 * - Confirm (or Save new key) needs a passing test for EXACTLY the values on
 *   screen. A pass never expires with time; only a changed value makes it stale
 *   (design L1048). AccreditMe cloud needs no test.
 * - A failed step is said in the screen's own words, never the server's
 *   `message`, which can name a host.
 */

/** What a person can choose before confirming. SharePoint since PR C (D1). */
export type SetupKind = 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM' | 'SHAREPOINT';

/** The steps MinIO and a local folder run, in order (backend runTest). */
export const SETUP_STEPS: readonly StorageTestStep[] = ['configure', 'write', 'read', 'verify', 'delete'];

/**
 * ACC-260 PR C — SharePoint's steps as the test box shows them: Check the
 * settings, Sign in to Microsoft, Find the site, Find the library, Write, Read
 * back, Delete. The API's `verify` is shown inside Read back (it compares what
 * was read), so the API's eight steps are seven rows.
 */
export const SHAREPOINT_STEPS: readonly StorageTestStep[] = ['configure', 'token', 'site', 'library', 'write', 'read', 'delete'];

/** The rows the test box shows for a kind of storage. */
export function stepsFor(kind: StorageKind): readonly StorageTestStep[] {
  return kind === 'SHAREPOINT' ? SHAREPOINT_STEPS : SETUP_STEPS;
}

export function isSetupKind(kind: StorageKind | null): kind is SetupKind {
  return kind === 'S3' || kind === 'MINIO' || kind === 'LOCAL_FILESYSTEM' || kind === 'SHAREPOINT';
}

/** Choosable now: what this installation offers (AccreditMe cloud, MinIO and SharePoint always; a local folder where configured). */
export function choosable(s: IStorageSettings, kind: StorageKind): kind is SetupKind {
  return isSetupKind(kind) && s.offeredProviders.includes(kind);
}

/** What is selected on arrival: a draft being set up if it can be chosen, else AccreditMe cloud (L1043). */
export function initialSelection(s: IStorageSettings): SetupKind {
  const draft = s.draftProvider;
  return draft && choosable(s, draft) ? draft : 'S3';
}

// ── request bodies ────────────────────────────────────────────────────────────

export interface MinioValues {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface LocalValues {
  rootPath: string;
}

/** SharePoint's six fields (D1), as typed. The expiry is '' or YYYY-MM-DD. */
export interface SharePointValues {
  tenant: string;
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  libraryName: string;
  secretExpiresOn: string;
}

export const EMPTY_SHAREPOINT: SharePointValues = { tenant: '', clientId: '', clientSecret: '', siteUrl: '', libraryName: '', secretExpiresOn: '' };

/** A typed secret, or nothing: never '' and never null (an empty value keeps the stored one). */
function typed(value: string): string | undefined {
  return value.trim() ? value : undefined;
}

/**
 * The body for Test and Confirm, from the values on screen. Keys are always
 * built in the same order, so two bodies compare by their JSON.
 */
export function setupCandidate(kind: SetupKind, minio: MinioValues, local: LocalValues, sharepoint: SharePointValues = EMPTY_SHAREPOINT): IStorageCandidate {
  switch (kind) {
    case 'SHAREPOINT': {
      const body: NonNullable<IStorageCandidate['sharepoint']> = {
        tenant: sharepoint.tenant.trim(),
        clientId: sharepoint.clientId.trim(),
      };
      const clientSecret = typed(sharepoint.clientSecret);
      if (clientSecret !== undefined) body.clientSecret = clientSecret;
      body.siteUrl = sharepoint.siteUrl.trim();
      body.libraryName = sharepoint.libraryName.trim();
      // The expiry date is not here: it is a reminder, not something the test
      // checks, so changing it never makes a pass stale. withExpiry() adds it
      // to what Confirm and Save send.
      return { provider: 'SHAREPOINT', sharepoint: body };
    }
    case 'S3':
      return { provider: 'S3' };
    case 'MINIO': {
      const body: NonNullable<IStorageCandidate['minio']> = { endpoint: minio.endpoint.trim(), bucket: minio.bucket.trim() };
      const region = minio.region.trim();
      if (region) body.region = region;
      const accessKeyId = typed(minio.accessKeyId);
      if (accessKeyId !== undefined) body.accessKeyId = accessKeyId;
      const secretAccessKey = typed(minio.secretAccessKey);
      if (secretAccessKey !== undefined) body.secretAccessKey = secretAccessKey;
      return { provider: 'MINIO', minio: body };
    }
    case 'LOCAL_FILESYSTEM':
      return { provider: 'LOCAL_FILESYSTEM', local: { rootPath: local.rootPath.trim() } };
  }
}

/**
 * The body for replacing the MinIO keys once confirmed: the two keys and
 * nothing else. The server keeps the stored endpoint, region and bucket, and
 * refuses any other change (STORAGE_CHANGE_BY_PLATFORM).
 */
export function keysCandidate(accessKeyId: string, secretAccessKey: string): IStorageCandidate {
  const minio: NonNullable<IStorageCandidate['minio']> = {};
  const a = typed(accessKeyId);
  if (a !== undefined) minio.accessKeyId = a;
  const sec = typed(secretAccessKey);
  if (sec !== undefined) minio.secretAccessKey = sec;
  return { provider: 'MINIO', minio };
}

/**
 * ACC-260 PR C — a SharePoint body with the secret's expiry date (D3), when one
 * was picked. Anything else is returned as it is.
 */
export function withExpiry(candidate: IStorageCandidate, secretExpiresOn: string): IStorageCandidate {
  if (candidate.provider !== 'SHAREPOINT' || !secretExpiresOn) return candidate;
  return { ...candidate, sharepoint: { ...candidate.sharepoint, secretExpiresOn } };
}

/**
 * ACC-260 PR C — after Confirm on SharePoint: a new client secret (Replace
 * secret), or a new client ID with its secret (Change client ID — a secret
 * belongs to one app). Never the tenant, site or library: those are AccreditMe's
 * to change. The expiry date is added by withExpiry().
 */
export function sharePointCredentialsCandidate(clientId: string | null, clientSecret: string): IStorageCandidate {
  const sharepoint: NonNullable<IStorageCandidate['sharepoint']> = {};
  if (clientId !== null) sharepoint.clientId = clientId.trim();
  const secret = typed(clientSecret);
  if (secret !== undefined) sharepoint.clientSecret = secret;
  return { provider: 'SHAREPOINT', sharepoint };
}

/** A new expiry date alone: no test (the server's EXPIRY_FIELDS). */
export function expiryCandidate(secretExpiresOn: string): IStorageCandidate {
  return { provider: 'SHAREPOINT', sharepoint: { secretExpiresOn } };
}

/** The stored settings, as they are: what a Test of the confirmed location sends (D5). */
export function storedSharePointCandidate(): IStorageCandidate {
  return { provider: 'SHAREPOINT' };
}

export function sameCandidate(a: IStorageCandidate | null, b: IStorageCandidate | null): boolean {
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
}

// ── the connection test ───────────────────────────────────────────────────────

/** One run of the test, kept for this visit only (nothing measures health between visits, D4). */
export type TestState =
  | { status: 'idle' }
  | { status: 'running'; candidate: IStorageCandidate }
  | { status: 'done'; candidate: IStorageCandidate; result: IStorageTestResult; at: string }
  /**
   * The request itself failed (network, 5xx): no step result to show.
   * `timedOut`: a gateway gave up waiting (408 / 504) — a SharePoint step may
   * wait out Microsoft's throttling for up to a minute.
   */
  | { status: 'error'; candidate: IStorageCandidate; timedOut?: boolean };

export type StepState = 'done' | 'fail' | 'skip' | 'wait';

export interface StepView {
  step: StorageTestStep;
  state: StepState;
  /** For the failed step: what went wrong and what to check, as a translation key. */
  detailKey: string | null;
}

export type TestTone = 'idle' | 'run' | 'pass' | 'fail' | 'stale';

export interface TestView {
  tone: TestTone;
  headKey: string;
  /** The time of a pass, for "tested 09:12". */
  at: string | null;
  steps: StepView[] | null;
  noteKey: string | null;
  buttonKey: string;
  /** SharePoint, on a pass: "site › library" as the test found them (D1). */
  found: string | null;
}

/** Refusals that say exactly what is wrong; their words are the shared ones (files.refusal.*). */
const SPOKEN_CODES = new Set(['STORAGE_SETTINGS_INCOMPLETE', 'STORAGE_ENDPOINT_NOT_ALLOWED', 'STORAGE_PROVIDER_NOT_ALLOWED', 'STORAGE_NOT_CONFIGURED']);

/** ACC-260 PR C — SharePoint's own refusal codes (backend sharePointRefusal), each with its sentence. */
export const SHAREPOINT_CODES: readonly string[] = [
  'SHAREPOINT_TENANT_NOT_FOUND',
  'SHAREPOINT_CLIENT_NOT_FOUND',
  'SHAREPOINT_SECRET_INVALID',
  'SHAREPOINT_APP_DISABLED',
  'SHAREPOINT_SITE_URL_INVALID',
  'SHAREPOINT_SITE_NOT_FOUND',
  'SHAREPOINT_LIBRARY_NOT_FOUND',
  'SHAREPOINT_NO_WRITE_ACCESS',
];

/**
 * The sentence for a failed step. A refusal that names the problem keeps its
 * shared words; anything else gets the step's own sentence for this kind of
 * storage. MinIO and local failures all arrive as STORAGE_UNAVAILABLE, so the
 * STEP is what tells the person where to look.
 *
 * SharePoint (PR C): each SHAREPOINT_* code says what to fix in Microsoft.
 * STORAGE_UNAVAILABLE means Microsoft or the network failed, or a step ran
 * out of time — except at verify and delete, which have their own sentence.
 */
export function stepFailureKey(kind: StorageKind, step: StorageTestStep, code: string | null): string {
  if (code && SPOKEN_CODES.has(code)) return `files.refusal.${code}`;
  if (kind === 'SHAREPOINT') {
    if (code && SHAREPOINT_CODES.includes(code)) return `storage.test.fail.SHAREPOINT.${code}`;
    if (step === 'verify' || step === 'delete') return `storage.test.fail.SHAREPOINT.${step}`;
    return 'storage.test.fail.SHAREPOINT.STORAGE_UNAVAILABLE';
  }
  if ((kind === 'MINIO' || kind === 'LOCAL_FILESYSTEM') && SETUP_STEPS.includes(step)) return `storage.test.fail.${kind}.${step}`;
  return 'storage.test.fail.generic';
}

export function passedFor(state: TestState, candidate: IStorageCandidate | null): boolean {
  return state.status === 'done' && state.result.ok && sameCandidate(state.candidate, candidate);
}

/** "Quality Department › Quality Documents": what a passing SharePoint test reached. */
export function foundText(result: IStorageTestResult): string | null {
  const sp = result.sharepoint;
  if (!sp) return null;
  return [sp.siteName ?? sp.siteWebUrl, sp.libraryName].filter(Boolean).join(' › ') || null;
}

/** The API step a row stands for: SharePoint's Read back covers read AND verify. */
function rowPassed(kind: StorageKind, row: StorageTestStep, passed: readonly StorageTestStep[]): boolean {
  if (kind === 'SHAREPOINT' && row === 'read') return passed.includes('read') && passed.includes('verify');
  return passed.includes(row);
}

function rowOf(kind: StorageKind, step: StorageTestStep): StorageTestStep {
  return kind === 'SHAREPOINT' && step === 'verify' ? 'read' : step;
}

const FAIL_HEADS: ReadonlySet<StorageTestStep> = new Set(['configure', 'token', 'site', 'library', 'write', 'read', 'verify', 'delete']);

export function testView(kind: StorageKind, state: TestState, candidate: IStorageCandidate | null): TestView {
  const rows = stepsFor(kind);
  switch (state.status) {
    case 'idle':
      return { tone: 'idle', headKey: 'storage.test.idle', at: null, steps: null, noteKey: idleNoteKey(kind), buttonKey: 'storage.test.run', found: null };
    case 'running':
      // The API answers once, at the end, so no step is shown as further along than another.
      return {
        tone: 'run',
        headKey: 'storage.test.running',
        at: null,
        steps: rows.map((step) => ({ step, state: 'wait' as const, detailKey: null })),
        noteKey: kind === 'SHAREPOINT' ? 'storage.test.runningNoteSharePoint' : null,
        buttonKey: 'storage.test.runningButton',
        found: null,
      };
    case 'error':
      if (!sameCandidate(state.candidate, candidate)) return staleView();
      return {
        tone: 'fail',
        headKey: state.timedOut ? 'storage.test.timedOut' : 'storage.test.couldNotRun',
        at: null,
        steps: null,
        noteKey: null,
        buttonKey: 'storage.test.again',
        found: null,
      };
    case 'done': {
      if (!sameCandidate(state.candidate, candidate)) return staleView();
      const r = state.result;
      if (r.ok) {
        return {
          tone: 'pass',
          headKey: 'storage.test.passed',
          at: state.at,
          steps: rows.map((step) => ({ step, state: 'done' as const, detailKey: null })),
          noteKey: null,
          buttonKey: 'storage.test.again',
          found: kind === 'SHAREPOINT' ? foundText(r) : null,
        };
      }
      const failed = r.failedStep ?? 'configure';
      const failedRow = rowOf(kind, failed);
      const steps = rows.map((step): StepView => {
        if (step === failedRow) return { step, state: 'fail', detailKey: stepFailureKey(kind, failed, r.code) };
        if (rowPassed(kind, step, r.passed)) return { step, state: 'done', detailKey: null };
        return { step, state: 'skip', detailKey: null };
      });
      const headKey = FAIL_HEADS.has(failed) && stepsFor(kind).includes(failedRow) ? `storage.test.failHead.${failed}` : 'storage.test.failHead.generic';
      return { tone: 'fail', headKey, at: null, steps, noteKey: null, buttonKey: 'storage.test.again', found: null };
    }
  }
}

function idleNoteKey(kind: StorageKind): string {
  return kind === 'SHAREPOINT' ? 'storage.test.idleNoteSharePoint' : 'storage.test.idleNote';
}

function staleView(): TestView {
  return { tone: 'stale', headKey: 'storage.test.stale', at: null, steps: null, noteKey: 'storage.test.staleNote', buttonKey: 'storage.test.again', found: null };
}

// ── the save bar's reason, and whether Confirm is open ────────────────────────

export interface SaveBarView {
  reasonKey: string;
  canSave: boolean;
}

/** First-time setup: the reason beside "Confirm …" (L1043–1050). */
export function confirmBar(kind: SetupKind, state: TestState, candidate: IStorageCandidate): SaveBarView {
  if (kind === 'S3') return { reasonKey: 'storage.save.blocked', canSave: true };
  return testBar(state, candidate, 'storage.save.tested');
}

/** Replacing the MinIO keys: the reason beside "Save new key" (L1054). */
export function keysBar(state: TestState, candidate: IStorageCandidate): SaveBarView {
  return testBar(state, candidate, 'storage.save.keysTested');
}

/** ACC-260 PR C — replacing SharePoint's secret or client ID: tested first, like MinIO's keys. */
export function sharePointCredentialsBar(state: TestState, candidate: IStorageCandidate): SaveBarView {
  return testBar(state, candidate, 'storage.save.spTested');
}

function testBar(state: TestState, candidate: IStorageCandidate, passKey: string): SaveBarView {
  if (passedFor(state, candidate)) return { reasonKey: passKey, canSave: true };
  switch (state.status) {
    case 'idle':
      return { reasonKey: 'storage.save.testFirst', canSave: false };
    case 'running':
      return { reasonKey: 'storage.save.waiting', canSave: false };
    default:
      return sameCandidate(state.candidate, candidate)
        ? { reasonKey: 'storage.save.fixAndTest', canSave: false }
        : { reasonKey: 'storage.save.stale', canSave: false };
  }
}

/**
 * The Location pair in the confirm dialog: the endpoint or folder, LTR;
 * AccreditMe cloud by name only (rule 1). SharePoint (PR C): the "site ›
 * library" the passing test reached, which is what Confirm records — or, before
 * a pass, the library as typed.
 */
export function confirmLocation(kind: SetupKind, candidate: IStorageCandidate, test: TestState = { status: 'idle' }): { key: string } | { text: string } {
  switch (kind) {
    case 'S3':
      return { key: 'storage.kind.S3.name' };
    case 'MINIO':
      return { text: candidate.minio?.endpoint ?? '' };
    case 'LOCAL_FILESYSTEM':
      return { text: candidate.local?.rootPath ?? '' };
    case 'SHAREPOINT': {
      const found = test.status === 'done' && passedFor(test, candidate) ? foundText(test.result) : null;
      return { text: found ?? candidate.sharepoint?.libraryName ?? '' };
    }
  }
}

// ── validators, the server's DTO rules (update-storage-settings.dto.ts) ───────

/** An http(s) address with a host. The scheme IS the HTTPS choice (G9). */
export const endpointUrl: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = String(control.value ?? '').trim();
  if (!v) return null;
  try {
    const url = new URL(v);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !/\s/.test(v) ? null : { endpoint: true };
  } catch {
    return { endpoint: true };
  }
};

export const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
export const REGION_PATTERN = /^[a-z0-9-]{2,32}$/;
/** Relative to the installation's storage folder; no "." or ".." segments. */
export const ROOT_PATH_PATTERN = /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
export const ACCESS_KEY_MIN = 3;
export const SECRET_KEY_MIN = 8;
export const KEY_MAX = 256;
export const REQUEST_NOTE_MAX = 1000;

// ── SharePoint (ACC-260 PR C): the server's SharePointSettingsDto rules ───────

/** Microsoft's GUID shape: the Application (client) ID, a Directory (tenant) ID. */
export const GUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** A tenant ID, or a domain: Microsoft's token endpoint takes either. */
export const TENANT_PATTERN = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)$/;
export const TENANT_MAX = 255;
export const SP_SECRET_MIN = 8;
export const SP_SECRET_MAX = 512;
export const SITE_URL_MAX = 500;
export const LIBRARY_MAX = 255;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The site address, as the server's parseSiteUrl() accepts it: https, no port
 * or sign-in in it, a host on sharepoint.com, and either no path (the root
 * site) or /sites/{name} or /teams/{name}, with anything after that ignored.
 */
export const sharePointSiteUrl: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = String(control.value ?? '').trim();
  if (!v) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return { siteUrl: true };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^[a-z0-9-]+(-my)?\.sharepoint\.com$/.test(host)) return { siteUrl: true };
  let segments: string[];
  try {
    segments = decodeURIComponent(url.pathname).split('/').filter(Boolean);
  } catch {
    return { siteUrl: true };
  }
  if (segments.length === 0) return null;
  const kind = segments[0]!.toLowerCase();
  return (kind === 'sites' || kind === 'teams') && segments[1] ? null : { siteUrl: true };
};

/** '' (no date), or a real calendar day as YYYY-MM-DD (the server refuses 2026-02-31). */
export const calendarDay: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = String(control.value ?? '');
  if (!v) return null;
  if (!DAY_PATTERN.test(v)) return { date: true };
  const at = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === v ? null : { date: true };
};

// ── Request a change: who to contact (ACC-260, PR B2) ─────────────────────────
// The server's StorageChangeRequestDto rules, so a refusal never surprises.

export const CONTACT_NAME_MAX = 120;
export const CONTACT_EMAIL_MAX = 254;
/** "+" and a country code, then digits with optional spaces or dashes. */
export const CONTACT_PHONE_PATTERN = /^\+\d[\d -]*\d$/;
export const CONTACT_PHONE_MIN = 8;
export const CONTACT_PHONE_MAX = 20;
/** A local part, an @, and a domain with a dot: what the server's IsEmail accepts in practice. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Required, and more than spaces. */
export const notBlank: ValidatorFn = (control: AbstractControl): ValidationErrors | null =>
  String(control.value ?? '').trim() ? null : { required: true };

/** An email address, judged on the trimmed value (the server trims too). */
export const contactEmail: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = String(control.value ?? '').trim();
  return !v || EMAIL_PATTERN.test(v) ? null : { email: true };
};

/** "+965 2222 3333": the pattern and 8–20 characters, judged on the trimmed value. */
export const contactPhone: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const v = String(control.value ?? '').trim();
  if (!v) return null;
  return CONTACT_PHONE_PATTERN.test(v) && v.length >= CONTACT_PHONE_MIN && v.length <= CONTACT_PHONE_MAX ? null : { phone: true };
};
