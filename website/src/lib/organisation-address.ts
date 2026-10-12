// ACC-213 — the Sign in box's one rule: what someone types, read as an
// organisation's address. Pure, so the browser script and the checks share it.
import { DNS_LABEL, RESERVED_LABELS } from '../generated/reserved';

export const APP_BASE_DOMAIN = 'accreditme.app';

export type AddressProblem = 'empty' | 'format' | 'reserved';

export type AddressResult = { ok: true; slug: string } | { ok: false; problem: AddressProblem };

/**
 * Trims, lower-cases (a DNS name is case-insensitive) and drops a pasted
 * `.accreditme.app` (with or without a scheme or path), then checks the label:
 * one DNS label — a-z, 0-9 and hyphen, 1–63 characters, no leading or trailing
 * hyphen, not `xn--` — and not a reserved name.
 */
export function readAddress(input: string): AddressResult {
  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (value.endsWith(`.${APP_BASE_DOMAIN}`)) value = value.slice(0, -(APP_BASE_DOMAIN.length + 1));
  if (value === '') return { ok: false, problem: 'empty' };
  if (!DNS_LABEL.test(value)) return { ok: false, problem: 'format' };
  if (RESERVED_LABELS.includes(value)) return { ok: false, problem: 'reserved' };
  return { ok: true, slug: value };
}

/** Where Continue goes. */
export function signInUrl(slug: string): string {
  return `https://${slug}.${APP_BASE_DOMAIN}/login`;
}
