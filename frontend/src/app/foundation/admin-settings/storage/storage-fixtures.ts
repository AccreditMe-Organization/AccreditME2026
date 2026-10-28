import { ISharePointFound, IStorageSettings, IStorageTestResult, StorageKind, StorageTestStep } from './storage-settings.service';
import { GIB } from './storage-view';

/**
 * ACC-260 — GET /tenant/storage, one answer per state the page draws. Used by
 * the specs only (nothing in the app imports this file). The browser check
 * answers the same shapes through interception, so no state is reached by
 * writing to a real organisation.
 */

export const TODAY = '2026-10-24';
export const HESSA = { id: 'u-hessa', name: 'Hessa Al-Dosari' };

/** A new organisation: AccreditMe cloud, not confirmed, uploads blocked. */
export function unconfirmed(over: Partial<IStorageSettings> = {}): IStorageSettings {
  return {
    provider: 'S3',
    offeredProviders: ['S3', 'MINIO', 'SHAREPOINT'],
    draftProvider: null,
    confirmed: false,
    confirmedAt: null,
    confirmedBy: null,
    changeRequestedAt: null,
    changeRequestedBy: null,
    minio: { endpoint: null, region: null, bucket: null, accessKeyId: null, secretAccessKey: null },
    local: { rootPath: null },
    sharepoint: {
      tenant: null,
      clientId: null,
      clientSecret: null,
      siteUrl: null,
      libraryName: null,
      siteId: null,
      listId: null,
      secretExpiresOn: null,
      tenantId: null,
      siteName: null,
      siteWebUrl: null,
      libraryWebUrl: null,
      accessLostAt: null,
      accessLostReason: null,
      filesStored: 0,
      disconnectAllowed: false,
    },
    usage: { usedBytes: 0, maxStorageGb: 10 },
    maxUploadBytes: 25 * 1024 * 1024,
    ...over,
  };
}

const confirmedBy = { confirmed: true, confirmedAt: '2026-10-03T09:00:00.000Z', confirmedBy: HESSA } as const;

export function cloud(usedGib = 3.2): IStorageSettings {
  return unconfirmed({ ...confirmedBy, usage: { usedBytes: Math.round(usedGib * GIB), maxStorageGb: 10 } });
}

export function minio(over: Partial<IStorageSettings> = {}): IStorageSettings {
  return unconfirmed({
    ...confirmedBy,
    provider: 'MINIO',
    minio: { endpoint: 'https://minio.alnakheel.local:9000', region: null, bucket: 'accreditme-files', accessKeyId: 'set', secretAccessKey: 'set' },
    ...over,
  });
}

export function local(): IStorageSettings {
  return unconfirmed({ ...confirmedBy, provider: 'LOCAL_FILESYSTEM', offeredProviders: ['S3', 'MINIO', 'LOCAL_FILESYSTEM', 'SHAREPOINT'], local: { rootPath: 'quality/files' } });
}

/**
 * ACC-260 PR C — made-up SharePoint values (CC-157: no real Microsoft tenant,
 * app or secret anywhere). The tenant is a domain under example.test; a site
 * address has to be on sharepoint.com to pass the rules, so its label is made
 * up. Nothing in a spec or the browser check ever reaches Microsoft.
 */
export const SP_TENANT = 'alnakheel.example.test';
export const SP_TENANT_ID = '00000000-0000-4000-8000-0000000000a1';
export const SP_CLIENT_ID = '00000000-0000-4000-8000-0000000000c1';
export const SP_SITE_URL = 'https://example-test.sharepoint.com/sites/quality';
export const SP_LIBRARY = 'Quality Documents';
export const SP_SITE_NAME = 'Quality Department';
/** A typed client secret (rule 2: it must never be shown or echoed). */
export const TYPED_SP_SECRET = 'Sp~Made-Up-Secret-Value-0001';

export function sharepoint(sp: Partial<IStorageSettings['sharepoint']> = {}): IStorageSettings {
  const base = unconfirmed();
  return unconfirmed({
    ...confirmedBy,
    provider: 'SHAREPOINT',
    sharepoint: {
      ...base.sharepoint,
      tenant: SP_TENANT,
      clientId: SP_CLIENT_ID,
      clientSecret: 'set',
      siteUrl: SP_SITE_URL,
      libraryName: SP_LIBRARY,
      secretExpiresOn: '2027-06-30',
      tenantId: SP_TENANT_ID,
      siteName: SP_SITE_NAME,
      siteWebUrl: SP_SITE_URL,
      libraryWebUrl: `${SP_SITE_URL}/Quality%20Documents`,
      filesStored: 3,
      ...sp,
    },
  });
}

export function requested(): IStorageSettings {
  return minio({ changeRequestedAt: '2026-10-07T08:00:00.000Z', changeRequestedBy: HESSA });
}

// ── PR B: first-time setup and test results ──────────────────────────────────

/** An organisation on an on-premises installation: a local folder can be chosen. */
export function unconfirmedOnPrem(over: Partial<IStorageSettings> = {}): IStorageSettings {
  return unconfirmed({ offeredProviders: ['S3', 'MINIO', 'LOCAL_FILESYSTEM', 'SHAREPOINT'], ...over });
}

/** A confirmed local folder (design state 19). */
export function localConfirmed(): IStorageSettings {
  return local();
}

const ORDER: StorageTestStep[] = ['configure', 'write', 'read', 'verify', 'delete'];

/** POST /tenant/storage/test, passed. */
export function testPassed(provider: StorageKind = 'MINIO'): IStorageTestResult {
  return { ok: true, provider, passed: [...ORDER], failedStep: null, code: null, message: null, sharepoint: null };
}

/**
 * POST /tenant/storage/test, failed at `step`. The message names a host on
 * purpose: the screen must never show it.
 */
export function testFailed(step: StorageTestStep, code = 'STORAGE_UNAVAILABLE', provider: StorageKind = 'MINIO'): IStorageTestResult {
  return {
    ok: false,
    provider,
    passed: ORDER.slice(0, ORDER.indexOf(step)),
    failedStep: step,
    code,
    message: 'Access Denied on host minio-internal.secret.lan:9000',
    sharepoint: null,
  };
}

// ── PR C: SharePoint ─────────────────────────────────────────────────────────

const SP_ORDER: StorageTestStep[] = ['configure', 'token', 'site', 'library', 'write', 'read', 'verify', 'delete'];

/** What a SharePoint test found (backend sharepointView). */
export function spFound(over: Partial<ISharePointFound> = {}): ISharePointFound {
  return {
    tenantId: SP_TENANT_ID,
    siteId: 'example-test.sharepoint.com,00000000-0000-4000-8000-0000000000b1,00000000-0000-4000-8000-0000000000b2',
    siteName: SP_SITE_NAME,
    siteWebUrl: SP_SITE_URL,
    listId: '00000000-0000-4000-8000-0000000000d1',
    driveId: 'b!made-up-drive-id',
    libraryName: SP_LIBRARY,
    libraryWebUrl: `${SP_SITE_URL}/Quality%20Documents`,
    resolvedBy: 'url',
    ...over,
  };
}

/** POST /tenant/storage/test on SharePoint, passed: the site and library it reached. */
export function spTestPassed(found: ISharePointFound = spFound()): IStorageTestResult {
  return { ok: true, provider: 'SHAREPOINT', passed: [...SP_ORDER], failedStep: null, code: null, message: null, sharepoint: found };
}

/**
 * SharePoint, failed at `step` with `code`. The message names Microsoft's
 * own words on purpose: the screen must never show it.
 */
export function spTestFailed(step: StorageTestStep, code: string): IStorageTestResult {
  const at = SP_ORDER.indexOf(step);
  return {
    ok: false,
    provider: 'SHAREPOINT',
    passed: SP_ORDER.slice(0, at),
    failedStep: step,
    code,
    message: 'AADSTS7000215: Invalid client secret provided. Trace ID: made-up',
    // Found once the library step passed, as the API does.
    sharepoint: at > SP_ORDER.indexOf('library') ? spFound() : null,
  };
}

/** An organisation part-way through setting SharePoint up through the API: its draft, the secret stored. */
export function sharepointDraft(): IStorageSettings {
  const base = unconfirmed();
  return unconfirmed({
    draftProvider: 'SHAREPOINT',
    sharepoint: { ...base.sharepoint, tenant: SP_TENANT, clientId: SP_CLIENT_ID, clientSecret: 'set', siteUrl: SP_SITE_URL, libraryName: SP_LIBRARY, disconnectAllowed: true },
  });
}

/** A typed MinIO candidate's values (the access key and secret are what rule 2 is about). */
export const TYPED_ACCESS_KEY = 'AKAM-QUALITY-01';
export const TYPED_SECRET = 'sk-Very-Secret-Value-123';
