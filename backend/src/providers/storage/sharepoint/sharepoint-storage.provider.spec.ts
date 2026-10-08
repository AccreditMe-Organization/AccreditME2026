import { GraphClient } from './graph-client';
import { SharePointStorageProvider, sharePointPath } from './sharepoint-storage.provider';
import { FAKE_DRIVE_ID, fakeMicrosoft, FakeMicrosoftOptions } from './testing/fake-microsoft';

const KEY = 'org-abc/tasks/task-1/0a1b2c-evidence.pdf';
const providerFor = (options: FakeMicrosoftOptions = {}) => {
  const ms = fakeMicrosoft(options);
  const provider = new SharePointStorageProvider({
    graph: new GraphClient(ms.fetchFn, async () => undefined),
    token: async () => 'tok',
    driveId: FAKE_DRIVE_ID,
  });
  return { ms, provider };
};
const readAll = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
};

describe('SharePointStorageProvider (ACC-185)', () => {
  it('keeps the server-built key under AccreditMe/, dropping the organisation id', () => {
    expect(sharePointPath(KEY)).toBe('AccreditMe/tasks/task-1/0a1b2c-evidence.pdf');
  });

  it('uploads with one simple PUT by path, refusing to overwrite, and reports the item id', async () => {
    const { ms, provider } = providerFor();
    const result = await provider.put(KEY, Buffer.from('%PDF-1.4'), 'application/pdf');

    expect(result).toEqual({ externalId: 'item-1' });
    const call = ms.calls[0]!;
    expect(call.method).toBe('PUT');
    expect(call.url).toBe(
      `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(FAKE_DRIVE_ID)}/root:/AccreditMe/tasks/task-1/0a1b2c-evidence.pdf:/content?@microsoft.graph.conflictBehavior=fail`,
    );
    expect(call.headers['content-type']).toBe('application/pdf');
    expect(call.headers['authorization']).toBe('Bearer tok');
  });

  it('encodes each path segment, so a name cannot escape its folder', async () => {
    const { ms, provider } = providerFor();
    await provider.put('org/tasks/t/a b#c.txt', Buffer.from('x'), 'text/plain');
    expect(ms.calls[0]!.url).toContain('/root:/AccreditMe/tasks/t/a%20b%23c.txt:/content');
  });

  it('reads back by item id when it has one, and by path when it does not', async () => {
    const { ms, provider } = providerFor();
    const { externalId } = (await provider.put(KEY, Buffer.from('hello'), 'text/plain')) as { externalId: string };

    expect((await readAll(await provider.getStream(KEY, externalId))).toString()).toBe('hello');
    expect(ms.calls.at(-1)!.url).toBe(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(FAKE_DRIVE_ID)}/items/${externalId}/content`);

    expect((await readAll(await provider.getStream(KEY))).toString()).toBe('hello');
    expect(ms.calls.at(-1)!.url).toContain('/root:/AccreditMe/tasks/task-1/0a1b2c-evidence.pdf:/content');
  });

  it('deletes by item id, or by path — which moves it to the customer’s recycle bin', async () => {
    const { ms, provider } = providerFor();
    const { externalId } = (await provider.put(KEY, Buffer.from('x'), 'text/plain')) as { externalId: string };
    await provider.delete(KEY, externalId);
    expect(ms.calls.at(-1)).toEqual(expect.objectContaining({ method: 'DELETE', url: expect.stringContaining(`/items/${externalId}`) }));

    await provider.put('org/_probe/p.txt', Buffer.from('x'), 'text/plain');
    await provider.delete('org/_probe/p.txt');
    expect(ms.calls.at(-1)!.url).toMatch(/\/root:\/AccreditMe\/_probe\/p\.txt$/);
  });

  it('has no signed download URL — downloads stream through the API', () => {
    const { provider } = providerFor();
    expect((provider as { signedDownloadUrl?: unknown }).signedDownloadUrl).toBeUndefined();
  });
});
