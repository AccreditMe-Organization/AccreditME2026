import { Readable } from 'stream';
import { ReadableStream as WebReadableStream } from 'stream/web';
import { IPutResult, StorageProvider } from '../storage.provider';
import { GraphClient } from './graph-client';

// ACC-185 — files in ONE SharePoint document library, through Microsoft Graph,
// as the customer's own app (app-only token). Built only by
// StorageResolverService; it never reads config or env itself.
//
// - Upload is Graph's simple upload, which "only supports files up to 250 MB"
//   — our cap is 25 MB, so there is no upload session.
// - put() returns the item id, which the StoredFile keeps, so a file renamed or
//   moved inside SharePoint is still found. Without one (the connection test's
//   probe) the file is addressed by its path.
// - No signedDownloadUrl: downloads stream through the API behind the existing
//   15-minute token, so the saved file name is ours (Graph's downloadUrl cannot
//   set it) and the entitlement stays AccreditMe's.
// - delete() moves the item to the customer's SharePoint RECYCLE BIN, not
//   oblivion: "Deleting items using this method moves the items to the recycle
//   bin instead of permanently deleting the item."

/** Every AccreditMe file sits under this folder in the customer's library. */
export const SHAREPOINT_ROOT_FOLDER = 'AccreditMe';

export interface SharePointProviderOptions {
  graph: GraphClient;
  /** A fresh app-only token — the identity layer caches it. */
  token: () => Promise<string>;
  driveId: string;
}

export class SharePointStorageProvider implements StorageProvider {
  constructor(private readonly options: SharePointProviderOptions) {}

  async put(key: string, body: Buffer, mimeType: string): Promise<IPutResult> {
    const item = await this.options.graph.json<{ id?: string }>({
      method: 'PUT',
      path: `${this.byPath(key)}:/content?@microsoft.graph.conflictBehavior=fail`,
      token: await this.options.token(),
      purpose: 'write',
      body,
      contentType: mimeType,
    });
    return { externalId: typeof item.id === 'string' ? item.id : null };
  }

  async getStream(key: string, externalId?: string | null): Promise<Readable> {
    // Graph answers 302 to a short-lived pre-authenticated URL; fetch follows it.
    const response = await this.options.graph.send({
      method: 'GET',
      path: `${this.address(key, externalId)}${externalId ? '' : ':'}/content`,
      token: await this.options.token(),
      purpose: 'read',
    });
    if (!response.body) return Readable.from([]);
    return Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
  }

  async delete(key: string, externalId?: string | null): Promise<void> {
    await this.options.graph.send({
      method: 'DELETE',
      path: this.address(key, externalId),
      token: await this.options.token(),
      purpose: 'delete',
    });
  }

  private address(key: string, externalId?: string | null): string {
    return externalId
      ? `/drives/${encodeURIComponent(this.options.driveId)}/items/${encodeURIComponent(externalId)}`
      : this.byPath(key);
  }

  /**
   * /drives/{id}/root:/AccreditMe/{module}/{record}/{random}-{name} — the
   * key's leading {organizationId}/ is dropped, because the library is the
   * customer's own; the rest of the server-built key is kept.
   */
  private byPath(key: string): string {
    return `/drives/${encodeURIComponent(this.options.driveId)}/root:/${sharePointPath(key)
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }
}

/** The path inside the library for a storage key. */
export function sharePointPath(key: string): string {
  const segments = key.split('/');
  return [SHAREPOINT_ROOT_FOLDER, ...segments.slice(1)].join('/');
}
