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

/** What a person can choose before confirming. SharePoint is set up in PR C. */
export type SetupKind = 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM';

/** The steps MinIO and a local folder run, in order (backend runTest). */
export const SETUP_STEPS: readonly StorageTestStep[] = ['configure', 'write', 'read', 'verify', 'delete'];

export function isSetupKind(kind: StorageKind | null): kind is SetupKind {
  return kind === 'S3' || kind === 'MINIO' || kind === 'LOCAL_FILESYSTEM';
}

/** Choosable now: AccreditMe cloud and MinIO always, a local folder where offered. */
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

/** A typed secret, or nothing: never '' and never null (an empty value keeps the stored one). */
function typed(value: string): string | undefined {
  return value.trim() ? value : undefined;
}

/**
 * The body for Test and Confirm, from the values on screen. Keys are always
 * built in the same order, so two bodies compare by their JSON.
 */
export function setupCandidate(kind: SetupKind, minio: MinioValues, local: LocalValues): IStorageCandidate {
  switch (kind) {
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

export function sameCandidate(a: IStorageCandidate | null, b: IStorageCandidate | null): boolean {
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
}

// ── the connection test ───────────────────────────────────────────────────────

/** One run of the test, kept for this visit only (nothing measures health between visits, D4). */
export type TestState =
  | { status: 'idle' }
  | { status: 'running'; candidate: IStorageCandidate }
  | { status: 'done'; candidate: IStorageCandidate; result: IStorageTestResult; at: string }
  /** The request itself failed (network, 5xx): no step result to show. */
  | { status: 'error'; candidate: IStorageCandidate };

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
}

/** Refusals that say exactly what is wrong; their words are the shared ones (files.refusal.*). */
const SPOKEN_CODES = new Set(['STORAGE_SETTINGS_INCOMPLETE', 'STORAGE_ENDPOINT_NOT_ALLOWED', 'STORAGE_PROVIDER_NOT_ALLOWED', 'STORAGE_NOT_CONFIGURED']);

/**
 * The sentence for a failed step. A refusal that names the problem keeps its
 * shared words; anything else gets the step's own sentence for this kind of
 * storage. MinIO and local failures all arrive as STORAGE_UNAVAILABLE, so the
 * STEP is what tells the person where to look.
 */
export function stepFailureKey(kind: StorageKind, step: StorageTestStep, code: string | null): string {
  if (code && SPOKEN_CODES.has(code)) return `files.refusal.${code}`;
  if ((kind === 'MINIO' || kind === 'LOCAL_FILESYSTEM') && SETUP_STEPS.includes(step)) return `storage.test.fail.${kind}.${step}`;
  return 'storage.test.fail.generic';
}

export function passedFor(state: TestState, candidate: IStorageCandidate | null): boolean {
  return state.status === 'done' && state.result.ok && sameCandidate(state.candidate, candidate);
}

export function testView(kind: StorageKind, state: TestState, candidate: IStorageCandidate | null): TestView {
  switch (state.status) {
    case 'idle':
      return { tone: 'idle', headKey: 'storage.test.idle', at: null, steps: null, noteKey: 'storage.test.idleNote', buttonKey: 'storage.test.run' };
    case 'running':
      // The API answers once, at the end, so no step is shown as further along than another.
      return {
        tone: 'run',
        headKey: 'storage.test.running',
        at: null,
        steps: SETUP_STEPS.map((step) => ({ step, state: 'wait' as const, detailKey: null })),
        noteKey: null,
        buttonKey: 'storage.test.runningButton',
      };
    case 'error':
      if (!sameCandidate(state.candidate, candidate)) return staleView();
      return { tone: 'fail', headKey: 'storage.test.couldNotRun', at: null, steps: null, noteKey: null, buttonKey: 'storage.test.again' };
    case 'done': {
      if (!sameCandidate(state.candidate, candidate)) return staleView();
      const r = state.result;
      if (r.ok) {
        return {
          tone: 'pass',
          headKey: 'storage.test.passed',
          at: state.at,
          steps: SETUP_STEPS.map((step) => ({ step, state: 'done' as const, detailKey: null })),
          noteKey: null,
          buttonKey: 'storage.test.again',
        };
      }
      const failed = r.failedStep ?? 'configure';
      const steps = SETUP_STEPS.map((step): StepView => {
        if (r.passed.includes(step)) return { step, state: 'done', detailKey: null };
        if (step === failed) return { step, state: 'fail', detailKey: stepFailureKey(kind, step, r.code) };
        return { step, state: 'skip', detailKey: null };
      });
      const headKey = SETUP_STEPS.includes(failed) ? `storage.test.failHead.${failed}` : 'storage.test.failHead.generic';
      return { tone: 'fail', headKey, at: null, steps, noteKey: null, buttonKey: 'storage.test.again' };
    }
  }
}

function staleView(): TestView {
  return { tone: 'stale', headKey: 'storage.test.stale', at: null, steps: null, noteKey: 'storage.test.staleNote', buttonKey: 'storage.test.again' };
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

/** The Location pair in the confirm dialog: the endpoint or folder, LTR; AccreditMe cloud by name only (rule 1). */
export function confirmLocation(kind: SetupKind, candidate: IStorageCandidate): { key: string } | { text: string } {
  switch (kind) {
    case 'S3':
      return { key: 'storage.kind.S3.name' };
    case 'MINIO':
      return { text: candidate.minio?.endpoint ?? '' };
    case 'LOCAL_FILESYSTEM':
      return { text: candidate.local?.rootPath ?? '' };
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
