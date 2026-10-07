// ACC-177 — the platform's own storage settings, read from env at call time
// (never cached at boot, so a missing value is a refusal at the moment it
// matters rather than a crash, and specs can vary it).
//
// AccreditMe's bucket: eu-central-1 (Frankfurt) for now, beside the database;
// both move to the Gulf before the first real customer (Ahmad, 7 Oct). There
// is deliberately NO default region: a value nobody set must refuse, never
// quietly pick somewhere.

export interface IPlatformS3Settings {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** An S3-compatible endpoint (local testing, a Tier 2/3 install). Unset for AWS. */
  endpoint: string | null;
  forcePathStyle: boolean;
}

const DEFAULT_MAX_UPLOAD_MB = 25;

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** AccreditMe's own bucket, or null when any required value is missing. */
export function platformS3Settings(): IPlatformS3Settings | null {
  const region = env('AWS_REGION');
  const bucket = env('AWS_S3_BUCKET');
  const accessKeyId = env('AWS_ACCESS_KEY_ID');
  const secretAccessKey = env('AWS_SECRET_ACCESS_KEY');
  if (!region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    endpoint: env('AWS_S3_ENDPOINT'),
    forcePathStyle: env('AWS_S3_FORCE_PATH_STYLE') === 'true',
  };
}

/** The folder a local-folder organisation's root must sit inside; null = Local is not offered. */
export function localStorageBase(): string | null {
  return env('LOCAL_STORAGE_BASE');
}

/** Tier 2/3 only: a customer's MinIO may sit on a private network, over http. */
export function allowPrivateEndpoints(): boolean {
  return env('STORAGE_ALLOW_PRIVATE_ENDPOINTS') === 'true';
}

/** The per-file upload cap in bytes: 25 MB unless MAX_UPLOAD_MB says otherwise. */
export function maxUploadBytes(): number {
  const configured = Number(env('MAX_UPLOAD_MB'));
  const mb = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_MB;
  return Math.floor(mb * 1024 * 1024);
}
