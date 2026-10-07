import { createReadStream } from 'fs';
import { mkdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import { dirname, resolve, sep } from 'path';
import { Readable } from 'stream';
import { StorageProvider } from './storage.provider';

// Server-built keys only (stored-file-keys.ts): segments of [A-Za-z0-9._-],
// never "." or "..".
const SAFE_KEY = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export class StorageKeyRefusedError extends Error {
  constructor() {
    super('The storage key is not a safe relative path');
    this.name = 'StorageKeyRefusedError';
  }
}

/**
 * A folder on the server, or a NAS mount (Tier 3). Files are streamed through
 * the API; there are no signed URLs.
 *
 * PATH TRAVERSAL IS IMPOSSIBLE TWICE OVER: a key must match SAFE_KEY with no
 * dot segment, AND the resolved path must sit inside the root. The root itself
 * was confined under LOCAL_STORAGE_BASE by the resolver before this was built.
 */
export class LocalFilesystemStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  // The MIME type is not stored on disk; the StoredFile row carries it.
  async put(key: string, body: Buffer, _mimeType: string): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    // Written beside the target, then renamed: a reader never sees half a file.
    const temp = `${target}.${randomBytes(6).toString('hex')}.part`;
    await writeFile(temp, body, { flag: 'wx' });
    await rename(temp, target);
  }

  async getStream(key: string): Promise<Readable> {
    const target = this.pathFor(key);
    await stat(target); // throws ENOENT before a stream is handed out
    return createReadStream(target);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key) || key.split('/').some((s) => s === '.' || s === '..')) {
      throw new StorageKeyRefusedError();
    }
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root + sep)) throw new StorageKeyRefusedError();
    return target;
  }
}
