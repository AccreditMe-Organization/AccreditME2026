import { DOWNLOAD_TTL_SECONDS, issueDownloadToken, readDownloadToken } from './download-token';

describe('download token (ACC-177)', () => {
  const original = process.env['ENCRYPTION_KEY'];
  beforeAll(() => {
    process.env['ENCRYPTION_KEY'] = 'a'.repeat(64);
  });
  afterAll(() => {
    process.env['ENCRYPTION_KEY'] = original;
  });

  it('names one file in one organisation, for fifteen minutes', () => {
    const now = new Date('2026-10-07T10:00:00Z');
    const { token, expiresAt } = issueDownloadToken('file-1', 'org-a', now);

    expect(expiresAt.toISOString()).toBe('2026-10-07T10:15:00.000Z');
    expect(DOWNLOAD_TTL_SECONDS).toBe(900);
    expect(readDownloadToken(token, new Date('2026-10-07T10:14:59Z'))).toEqual({ fileId: 'file-1', organizationId: 'org-a' });
    expect(readDownloadToken(token, new Date('2026-10-07T10:15:00Z'))).toBeNull();
  });

  it('refuses a token whose body was changed — another file, another organisation', () => {
    const { token } = issueDownloadToken('file-1', 'org-a');
    const [, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ f: 'file-1', o: 'org-b', e: 9_999_999_999 })).toString('base64url');
    expect(readDownloadToken(`${forged}.${signature}`)).toBeNull();
  });

  it.each(['', 'abc', 'a.b.c', `${Buffer.from('{}').toString('base64url')}.sig`])('refuses %p', (token) => {
    expect(readDownloadToken(token)).toBeNull();
  });

  it('a token signed under another key is refused', () => {
    const { token } = issueDownloadToken('file-1', 'org-a');
    process.env['ENCRYPTION_KEY'] = 'b'.repeat(64);
    try {
      expect(readDownloadToken(token)).toBeNull();
    } finally {
      process.env['ENCRYPTION_KEY'] = 'a'.repeat(64);
    }
  });
});
