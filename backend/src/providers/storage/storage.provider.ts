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

/**
 * ACC-185 — what a provider may report about a file it stored. SharePoint
 * returns the Graph item id, which the StoredFile keeps; S3, MinIO and a local
 * folder address files by key alone and return nothing.
 */
export interface IPutResult {
  externalId: string | null;
}

export interface StorageProvider {
  put(key: string, body: Buffer, mimeType: string): Promise<void | IPutResult>;
  /** `externalId` is what put() reported, where the provider uses one. */
  getStream(key: string, externalId?: string | null): Promise<Readable>;
  delete(key: string, externalId?: string | null): Promise<void>;
  /**
   * A pre-signed download URL (S3 and MinIO). A local folder has none: its
   * files are streamed through the API behind a short-lived token instead.
   * Direct storage paths are never exposed to clients.
   */
  signedDownloadUrl?(key: string, ttlSeconds: number, options: SignedDownloadOptions): Promise<string>;
}
