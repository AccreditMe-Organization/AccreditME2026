import {
  decryptTenantConfig,
  encryptTenantConfig,
  getEncryptionKey,
} from '../../common/utils/tenant-config-crypto';

// ACC-177 — the shape of Organization.storageConfig, decrypted.
//
// Both blocks are kept whichever provider is selected, so switching an
// organisation from MinIO to S3 and back leaves the MinIO settings (and so the
// files stored there) intact — each stored file reads from its own location.

export interface IMinioConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ILocalFolderConfig {
  /** Relative to LOCAL_STORAGE_BASE. */
  rootPath: string;
}

/**
 * ACC-185 — the customer's own SharePoint app and library. The client secret
 * lives here, encrypted with everything else, and is WRITE-ONLY: GET answers
 * "set". The site and library are entered either as a URL and a name, or as
 * the two ids from the customer guide's PowerShell output (Ahmad, Q2).
 */
export interface ISharePointConfig {
  /** A GUID, or a domain such as contoso.onmicrosoft.com. */
  tenant: string;
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  libraryName: string;
  siteId: string;
  listId: string;
  /** YYYY-MM-DD, optional — for the 30-day reminder. */
  secretExpiresOn: string;
  /**
   * What a passing test found, recorded by Confirm. From then on it IS the
   * location: every upload, download and purge uses these ids without looking
   * the site up again, and a replaced secret must reach exactly this tenant,
   * site and library.
   */
  resolved: ISharePointResolved;
}

export interface ISharePointResolved {
  tenantId: string;
  siteId: string;
  siteName: string | null;
  siteWebUrl: string | null;
  listId: string;
  driveId: string;
  libraryName: string;
  libraryWebUrl: string | null;
  resolvedAt: string;
}

/** The options a tenant can choose — the same four the database enum holds. */
export type StorageChoice = 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM' | 'SHAREPOINT';

export interface IStorageConfig {
  minio?: Partial<IMinioConfig>;
  local?: Partial<ILocalFolderConfig>;
  sharepoint?: Partial<ISharePointConfig>;
  /**
   * ACC-185 (Q6) — the option a tenant admin is setting up, before
   * confirmation. Only Confirm writes Organization.storageProvider, for every
   * option; until then this is how a screen knows which one was chosen.
   */
  draftProvider?: StorageChoice;
}

const CHOICES: readonly StorageChoice[] = ['S3', 'MINIO', 'LOCAL_FILESYSTEM', 'SHAREPOINT'];

export function readStorageConfig(encrypted: string | null): IStorageConfig {
  if (!encrypted) return {};
  const parsed = JSON.parse(decryptTenantConfig(encrypted, getEncryptionKey())) as unknown;
  if (!parsed || typeof parsed !== 'object') return {};
  const { minio, local, sharepoint, draftProvider } = parsed as IStorageConfig;
  return {
    ...(minio && typeof minio === 'object' ? { minio } : {}),
    ...(local && typeof local === 'object' ? { local } : {}),
    ...(sharepoint && typeof sharepoint === 'object' ? { sharepoint } : {}),
    ...(draftProvider && CHOICES.includes(draftProvider) ? { draftProvider } : {}),
  };
}

/**
 * The encrypted column value, or NULL when there is nothing to keep — an
 * organisation on AccreditMe cloud with no other settings stores no config at
 * all, exactly as before it confirmed (found in ACC-177's live run: confirming
 * AccreditMe cloud wrote an encrypted "{}"). A draft of AccreditMe cloud is
 * the default, so on its own it is nothing to keep either.
 */
export function writeStorageConfig(config: IStorageConfig): string | null {
  const draftProvider = config.draftProvider && config.draftProvider !== 'S3' ? config.draftProvider : undefined;
  const kept: IStorageConfig = {
    ...(config.minio ? { minio: config.minio } : {}),
    ...(config.local ? { local: config.local } : {}),
    ...(config.sharepoint ? { sharepoint: config.sharepoint } : {}),
    ...(draftProvider ? { draftProvider } : {}),
  };
  if (Object.keys(kept).length === 0) return null;
  return encryptTenantConfig(kept as Record<string, unknown>, getEncryptionKey());
}

/**
 * The SharePoint settings a connection needs: the app's three values, and
 * either the site URL and library name or the site and library ids. Null when
 * anything required is missing.
 */
export function completeSharePoint(config: IStorageConfig): Required<Pick<ISharePointConfig, 'tenant' | 'clientId' | 'clientSecret'>> &
  Partial<Pick<ISharePointConfig, 'siteUrl' | 'libraryName' | 'siteId' | 'listId'>> | null {
  const s = config.sharepoint;
  if (!s?.tenant || !s.clientId || !s.clientSecret) return null;
  const byIds = Boolean(s.siteId && s.listId);
  const byName = Boolean(s.siteUrl && s.libraryName);
  if (!byIds && !byName) return null;
  return {
    tenant: s.tenant,
    clientId: s.clientId,
    clientSecret: s.clientSecret,
    ...(s.siteUrl ? { siteUrl: s.siteUrl } : {}),
    ...(s.libraryName ? { libraryName: s.libraryName } : {}),
    ...(s.siteId ? { siteId: s.siteId } : {}),
    ...(s.listId ? { listId: s.listId } : {}),
  };
}

/** A MinIO block with every field set, or null. */
export function completeMinio(config: IStorageConfig): IMinioConfig | null {
  const m = config.minio;
  if (!m?.endpoint || !m.region || !m.bucket || !m.accessKeyId || !m.secretAccessKey) return null;
  return {
    endpoint: m.endpoint,
    region: m.region,
    bucket: m.bucket,
    accessKeyId: m.accessKeyId,
    secretAccessKey: m.secretAccessKey,
  };
}
