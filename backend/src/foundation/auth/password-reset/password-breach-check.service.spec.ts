import { createHash } from 'crypto';
import { HttpException } from '@nestjs/common';
import { PWNED_RANGE_URL, PasswordBreachCheckService } from './password-breach-check.service';

/**
 * ACC-188 — the breach check that runs before a reset token is spent. The
 * network is replaced; the request it makes is asserted to be the k-anonymity
 * one (five characters of the SHA-1, padded), never the password.
 */
describe('PasswordBreachCheckService', () => {
  const password = 'correct horse battery staple';
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  let fetchMock: jest.SpyInstance;
  const service = new PasswordBreachCheckService();

  afterEach(() => fetchMock.mockRestore());

  const respond = (body: string, status = 200) => {
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(body, { status }));
  };

  const codeOf = async (promise: Promise<unknown>): Promise<[number, string]> => {
    try {
      await promise;
    } catch (err) {
      if (err instanceof HttpException) {
        return [err.getStatus(), (err.getResponse() as { code: string }).code];
      }
      throw err;
    }
    throw new Error('expected a refusal');
  };

  it('sends only the first five characters of the SHA-1, with padding', async () => {
    respond('0000000000000000000000000000000000A:0\n');
    await service.assertNotBreached(password);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PWNED_RANGE_URL}${sha1.slice(0, 5)}`);
    expect((init.headers as Record<string, string>)['Add-Padding']).toBe('true');
    expect(url).not.toContain(password);
    expect(url).not.toContain(sha1.slice(5));
  });

  it('passes a password that is not in the range', async () => {
    respond('0000000000000000000000000000000000A:12\r\n0000000000000000000000000000000000B:0');
    await expect(service.assertNotBreached(password)).resolves.toBeUndefined();
  });

  it('refuses a breached password with PASSWORD_COMPROMISED (400)', async () => {
    respond(`0000000000000000000000000000000000A:1\r\n${sha1.slice(5).toLowerCase()}:42\r\n`);
    expect(await codeOf(service.assertNotBreached(password))).toEqual([400, 'PASSWORD_COMPROMISED']);
  });

  it('answers PASSWORD_CHECK_UNAVAILABLE (503) when the service errors', async () => {
    respond('nope', 503);
    expect(await codeOf(service.assertNotBreached(password))).toEqual([503, 'PASSWORD_CHECK_UNAVAILABLE']);
  });

  it('answers PASSWORD_CHECK_UNAVAILABLE (503) when the service cannot be reached', async () => {
    fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    expect(await codeOf(service.assertNotBreached(password))).toEqual([503, 'PASSWORD_CHECK_UNAVAILABLE']);
  });
});
