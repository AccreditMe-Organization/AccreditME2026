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

export interface IStorageConfig {
  minio?: Partial<IMinioConfig>;
  local?: Partial<ILocalFolderConfig>;
}

export function readStorageConfig(encrypted: string | null): IStorageConfig {
  if (!encrypted) return {};
  const parsed = JSON.parse(decryptTenantConfig(encrypted, getEncryptionKey())) as unknown;
  if (!parsed || typeof parsed !== 'object') return {};
  const { minio, local } = parsed as IStorageConfig;
  return {
    ...(minio && typeof minio === 'object' ? { minio } : {}),
    ...(local && typeof local === 'object' ? { local } : {}),
  };
}

export function writeStorageConfig(config: IStorageConfig): string {
  return encryptTenantConfig(config as Record<string, unknown>, getEncryptionKey());
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
