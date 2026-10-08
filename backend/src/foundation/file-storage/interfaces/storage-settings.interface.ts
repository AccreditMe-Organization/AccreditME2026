import { StorageProviderKind } from '../storage-resolver.service';
import { StorageChoice } from '../storage-config';

/**
 * GET /tenant/storage — secrets as "set" or null, never their values; and
 * nothing about AccreditMe's own bucket (for AccreditMe cloud, only the
 * provider).
 */
export interface IStorageSettings {
  provider: StorageProviderKind;
  /** What this installation lets a tenant choose (Local only where configured). */
  offeredProviders: StorageChoice[];
  /**
   * ACC-185 (Q6) — before confirmation, the option being set up. `provider`
   * stays as stored (AccreditMe cloud by default) until Confirm writes it.
   * Null once confirmed.
   */
  draftProvider: StorageChoice | null;
  /** Uploads are refused until a tenant admin confirms where files go. */
  confirmed: boolean;
  confirmedAt: Date | null;
  confirmedBy: { id: string; name: string } | null;
  /** The last request to AccreditMe to change the location, if any. */
  changeRequestedAt: Date | null;
  changeRequestedBy: { id: string; name: string } | null;
  minio: {
    endpoint: string | null;
    region: string | null;
    bucket: string | null;
    accessKeyId: 'set' | null;
    secretAccessKey: 'set' | null;
  };
  local: { rootPath: string | null };
  /** ACC-185 — the customer's own app and library; the secret only as "set". */
  sharepoint: {
    tenant: string | null;
    clientId: string | null;
    clientSecret: 'set' | null;
    siteUrl: string | null;
    libraryName: string | null;
    siteId: string | null;
    listId: string | null;
    secretExpiresOn: string | null;
  };
  /** AccreditMe cloud only — deleted files count until purged. */
  usage: { usedBytes: number; maxStorageGb: number };
  maxUploadBytes: number;
}

/**
 * `token`, `site` and `library` are SharePoint's own steps (ACC-185), between
 * configure and write: sign in as the customer's app, find the site, find the
 * library.
 */
export type StorageTestStep = 'configure' | 'token' | 'site' | 'library' | 'write' | 'read' | 'verify' | 'delete';

/** POST /tenant/storage/test — which step failed, if any. Nothing is saved. */
export interface IStorageTestResult {
  ok: boolean;
  provider: StorageChoice;
  /** The steps that passed, in order. */
  passed: StorageTestStep[];
  failedStep: StorageTestStep | null;
  code: string | null;
  message: string | null;
  /**
   * SharePoint only: what the test found, once the library step passed — the
   * customer's own tenant, site and library, so shown to them. Null otherwise.
   */
  sharepoint: {
    tenantId: string;
    siteId: string;
    siteName: string | null;
    siteWebUrl: string | null;
    listId: string;
    driveId: string;
    libraryName: string;
    libraryWebUrl: string | null;
    resolvedBy: 'URL_AND_NAME' | 'IDS';
  } | null;
}
