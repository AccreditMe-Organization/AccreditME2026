import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalFilesystemStorageProvider, StorageKeyRefusedError } from './local-filesystem-storage.provider';

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

describe('LocalFilesystemStorageProvider (ACC-177)', () => {
  let base: string;
  let root: string;
  let provider: LocalFilesystemStorageProvider;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'acc177-'));
    root = join(base, 'org-root');
    provider = new LocalFilesystemStorageProvider(root);
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('writes, reads back and deletes a file under its key', async () => {
    await provider.put('org1/tasks/t1/abc-a.txt', Buffer.from('hello'), 'text/plain');
    expect(await readFile(join(root, 'org1', 'tasks', 't1', 'abc-a.txt'), 'utf8')).toBe('hello');
    expect(await readStream(await provider.getStream('org1/tasks/t1/abc-a.txt'))).toBe('hello');

    await provider.delete('org1/tasks/t1/abc-a.txt');
    await expect(stat(join(root, 'org1', 'tasks', 't1', 'abc-a.txt'))).rejects.toThrow();
    await expect(provider.delete('org1/tasks/t1/abc-a.txt')).resolves.toBeUndefined();
  });

  it('a missing file fails before a stream is handed out', async () => {
    await expect(provider.getStream('org1/none.txt')).rejects.toThrow();
  });

  it.each(['../outside.txt', 'org1/../../outside.txt', '/etc/passwd', 'org1/./x.txt', 'C:\\x.txt', 'org1//x.txt', '', 'org1/x y.txt'])(
    'refuses the key %p — no path outside the root is ever touched',
    async (key) => {
      await writeFile(join(base, 'outside.txt'), 'secret');
      await expect(provider.put(key, Buffer.from('x'), 'text/plain')).rejects.toBeInstanceOf(StorageKeyRefusedError);
      await expect(provider.getStream(key)).rejects.toBeInstanceOf(StorageKeyRefusedError);
      await expect(provider.delete(key)).rejects.toBeInstanceOf(StorageKeyRefusedError);
      expect(await readFile(join(base, 'outside.txt'), 'utf8')).toBe('secret');
    },
  );
});
