import { Readable } from 'stream';

// StorageProvider — the contract every storage implementation satisfies
// (CLAUDE.md "Provider Abstraction").
//
// ACC-177 — providers are no longer injected. Each one is BUILT per request by
// StorageResolverService, for one organisation's location (or one stored
// file's), and nothing else constructs one. That is what lets an organisation
// choose S3, MinIO or a local folder while every file keeps reading from the
// location it was written to.
//
// Keys are always built by the server (stored-file-keys.ts); a provider never
// receives a path from a client.

export interface SignedDownloadOptions {
  /** The name the browser saves the file as — the original, Arabic included. */
  fileName: string;
  mimeType: string;
}

export interface StorageProvider {
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  /**
   * A pre-signed download URL (S3 and MinIO). A local folder has none: its
   * files are streamed through the API behind a short-lived token instead.
   * Direct storage paths are never exposed to clients.
   */
  signedDownloadUrl?(key: string, ttlSeconds: number, options: SignedDownloadOptions): Promise<string>;
}
