import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { Readable } from 'stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SignedDownloadOptions, StorageProvider } from './storage.provider';
import { contentDisposition } from './content-disposition';
import { assertEndpointHostAllowed, guardedLookup } from './endpoint-guard';

export interface S3CompatibleOptions {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Unset for AWS S3 itself; a MinIO (or other S3-compatible) URL otherwise. */
  endpoint?: string;
  forcePathStyle: boolean;
  /**
   * ACC-177 — a CUSTOMER's endpoint is guarded against private addresses at
   * connect time (endpoint-guard.ts). AccreditMe's own platform settings are
   * trusted and are not.
   */
  guardPrivateAddresses: boolean;
}

/**
 * One class for AWS S3 and MinIO — they speak the same protocol; MinIO needs
 * path-style addressing and its own endpoint. Built per request by
 * StorageResolverService, never injected, and never reading env itself (the
 * old constructor defaulted the region to me-south-1, a default nobody chose).
 */
export class S3CompatibleStorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3CompatibleOptions) {
    let requestHandler: { httpAgent: HttpAgent; httpsAgent: HttpsAgent; connectionTimeout: number; requestTimeout: number } | undefined;
    if (options.guardPrivateAddresses && options.endpoint) {
      assertEndpointHostAllowed(new URL(options.endpoint).hostname);
      // The guard IS the socket's lookup: the address it approves is the one
      // the connection uses, on every connection.
      requestHandler = {
        httpAgent: new HttpAgent({ lookup: guardedLookup }),
        httpsAgent: new HttpsAgent({ lookup: guardedLookup }),
        connectionTimeout: 5_000,
        requestTimeout: 30_000,
      };
    }
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      ...(requestHandler ? { requestHandler } : {}),
    });
    this.bucket = options.bucket;
  }

  async put(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
        ContentLength: body.length,
      }),
    );
  }

  async getStream(key: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error('The stored object has no body');
    return response.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // The URL carries the download name and type, so the browser saves the file
  // under its original name whatever the key looks like.
  async signedDownloadUrl(key: string, ttlSeconds: number, options: SignedDownloadOptions): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition(options.fileName),
      ResponseContentType: options.mimeType,
    });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }
}
