import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { INFRASTRUCTURE_LABELS } from './reserved-labels';

/**
 * Which organisation the address names — ACC-139.
 *
 * Every organisation signs in at its own address: `al-nakheel.accreditme.app`
 * in production, `al-nakheel.localhost:4200` locally. The organisation is the
 * ONE label in front of `environment.baseDomain` (`accreditme.app`, or
 * `localhost` in development), so nobody types it.
 *
 * `null` — and the sign-in screens show a note instead of a form — for any host
 * that does not name one: the bare base domain, two or more labels in front of
 * it, a label that is not a DNS label, and the infrastructure labels the
 * backend never lets a tenant take (`www`, `api`, …). `platform` IS a valid
 * host: it is where a platform administrator signs in.
 *
 * USED ONLY BY SIGN-IN AND FORGOT PASSWORD. After sign-in, the session's own
 * organisation is the authority, and nothing compares it with the address —
 * a platform administrator signed in at `platform.…` and impersonating a tenant
 * is one such case, and it must keep working. Do not add a comparison.
 */

// A DNS label: 1–63 lower-case letters, digits and inner hyphens, not punycode.
// No dot can match, which is what makes "exactly one label" true.
const DNS_LABEL = /^(?!xn--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function tenantSlugFromHost(hostname: string, baseDomain: string): string | null {
  // Browsers already lower-case a hostname; this does not rely on it. A
  // trailing dot (the fully qualified form) names the same host.
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const suffix = `.${baseDomain.toLowerCase()}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!DNS_LABEL.test(label)) return null;
  if (INFRASTRUCTURE_LABELS.includes(label)) return null;
  return label;
}

@Injectable({ providedIn: 'root' })
export class TenantHostService {
  /** Read once: the address cannot change without loading the page again. */
  readonly slug: string | null = tenantSlugFromHost(
    inject(DOCUMENT).location.hostname,
    environment.baseDomain,
  );
}
