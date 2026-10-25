import { IStorageSettings, IStorageTestResult, StorageKind, StorageTestStep } from './storage-settings.service';
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

export function sharepoint(sp: Partial<IStorageSettings['sharepoint']> = {}): IStorageSettings {
  const base = unconfirmed();
  return unconfirmed({
    ...confirmedBy,
    provider: 'SHAREPOINT',
    sharepoint: {
      ...base.sharepoint,
      tenant: 'alnakheel.onmicrosoft.com',
      clientId: '3f2b6c1e-8a4d-4e2f-9b7a-1c5d6e7f8a9b',
      clientSecret: 'set',
      siteUrl: 'https://alnakheel.sharepoint.com/sites/quality',
      libraryName: 'Quality Documents',
      secretExpiresOn: '2027-06-30',
      tenantId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
      siteName: 'Quality Department',
      siteWebUrl: 'https://alnakheel.sharepoint.com/sites/quality',
      libraryWebUrl: 'https://alnakheel.sharepoint.com/sites/quality/Quality%20Documents',
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

/** A typed MinIO candidate's values (the access key and secret are what rule 2 is about). */
export const TYPED_ACCESS_KEY = 'AKAM-QUALITY-01';
export const TYPED_SECRET = 'sk-Very-Secret-Value-123';
