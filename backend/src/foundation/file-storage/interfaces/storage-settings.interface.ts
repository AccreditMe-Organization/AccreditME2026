import { StorageProviderKind } from '../storage-resolver.service';

/**
 * GET /tenant/storage — secrets as "set" or null, never their values; and
 * nothing about AccreditMe's own bucket (for AccreditMe cloud, only the
 * provider).
 */
export interface IStorageSettings {
  provider: StorageProviderKind;
  /** What this installation lets a tenant choose (Local only where configured). */
  offeredProviders: StorageProviderKind[];
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
  /** AccreditMe cloud only — deleted files count until purged. */
  usage: { usedBytes: number; maxStorageGb: number };
  maxUploadBytes: number;
}

export type StorageTestStep = 'configure' | 'write' | 'read' | 'verify' | 'delete';

/** POST /tenant/storage/test — which step failed, if any. Nothing is saved. */
export interface IStorageTestResult {
  ok: boolean;
  provider: StorageProviderKind;
  /** The steps that passed, in order. */
  passed: StorageTestStep[];
  failedStep: StorageTestStep | null;
  code: string | null;
  message: string | null;
}
