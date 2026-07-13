// StorageProvider interface — all storage implementations must satisfy this contract.
//
// Security requirement: getSignedUrl MUST use pre-signed URLs only.
// Never return a direct S3/MinIO/filesystem path to the client.
// Use @aws-sdk/s3-request-presigner for S3 and MinIO implementations.
// LocalFilesystemProvider streams files through the NestJS API (no signed URLs).

export interface StorageProvider {
  upload(file: Buffer, path: string, mimeType: string): Promise<string>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  getSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
