import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PasswordRefusalException } from '../password-refusal';

/** The k-anonymity range API Better Auth's haveIBeenPwned plugin uses. */
export const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const CHECK_TIMEOUT_MS = 5_000;

/**
 * The breached-password check, run BEFORE a reset token is spent — ACC-188.
 *
 * Better Auth's resetPassword consumes the token and only then hashes the
 * password, which is where its haveIBeenPwned plugin checks it
 * (better-auth.contract.ts). A breached password, or the check being
 * unreachable, would therefore cost the person their link. This makes the same
 * request first, so either refusal leaves the link usable. Better Auth's own
 * check still runs afterwards.
 *
 * Only the first five characters of the password's SHA-1 leave the server,
 * with padding, exactly as the plugin sends them.
 */
@Injectable()
export class PasswordBreachCheckService {
  async assertNotBreached(password: string): Promise<void> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    let body: string;
    try {
      const response = await fetch(`${PWNED_RANGE_URL}${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'AccreditMe Password Checker' },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      body = await response.text();
    } catch {
      throw new PasswordRefusalException('PASSWORD_CHECK_UNAVAILABLE');
    }

    const found = body
      .split('\n')
      .some((line) => line.split(':')[0]?.trim().toUpperCase() === suffix);
    if (found) throw new PasswordRefusalException('PASSWORD_COMPROMISED');
  }
}
