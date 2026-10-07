import { StorageProviderKind } from '../storage-resolver.service';

/** GET /tenant/storage — secrets as "set" or null, never their values. */
export interface IStorageSettings {
  provider: StorageProviderKind;
  /** What this installation lets a tenant choose (Local only where configured). */
  offeredProviders: StorageProviderKind[];
  /** Whether AccreditMe's own bucket is set up on this installation. */
  platformStorageReady: boolean;
  minio: {
    endpoint: string | null;
    region: string | null;
    bucket: string | null;
    accessKeyId: 'set' | null;
    secretAccessKey: 'set' | null;
  };
  local: { rootPath: string | null };
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
