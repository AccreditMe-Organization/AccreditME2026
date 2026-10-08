import { AppLinkConfig } from '../../common/config/app-url.config';

/**
 * A notification body as email HTML — ACC-158.
 *
 * ## Escape first, then link
 *
 * A body is stored TEXT, and much of it is interpolated from tenant data — an
 * organisation name, a task title, a committee name. It used to go into the
 * email as `<p>${body}</p>`, so any of those values was HTML. The whole body is
 * escaped first, which covers every value interpolated into it without each
 * call site having to remember.
 *
 * ## Only OUR links become anchors
 *
 * After escaping, a URL becomes `<a href>` only if it points at the product: a
 * host under `APP_BASE_DOMAIN` over https, or exactly the development
 * `APP_LINK_ORIGIN`. A URL someone typed into a task title stays plain text, so
 * the product's own email is not a way to deliver a clickable link to anyone.
 * (A mail client may still auto-link it; that is the client's choice, not one
 * this product makes on the sender's behalf.)
 *
 * ## Direction
 *
 * An Arabic body is `<p dir="rtl">`, and every anchor is `dir="ltr"`. Without
 * the second, a Latin URL inside right-to-left text is laid out by the bidi
 * algorithm, and the punctuation around it — the colon before it, a full stop
 * after it — can be drawn on the wrong side. That is correctness, not styling.
 * An English body is a plain `<p>`, exactly as before.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Matched against ESCAPED text, so `<`, `>`, `"` and `'` can no longer occur
// raw; whitespace ends a URL.
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/g;

// Sentence punctuation that follows a URL rather than belonging to it, Latin
// and Arabic (the Arabic comma and semicolon).
const TRAILING_PUNCTUATION = /[.,;:!?)\u060C\u061B]+$/;

// ACC-139 — local links are built as {scheme}://{slug}.localhost[:port]
// (buildTenantUrl), so the development origin matches with exactly one label in
// front of `localhost`, on the same scheme and port. Bare localhost and any
// other port stay plain text.
const ONE_LABEL_LOCALHOST = /^[a-z0-9-]+\.localhost$/;

function isLocalTenantUrl(url: URL, devOrigin: string): boolean {
  const dev = new URL(devOrigin);
  return (
    url.protocol === dev.protocol &&
    url.port === dev.port &&
    ONE_LABEL_LOCALHOST.test(url.hostname)
  );
}

function isProductUrl(raw: string, links: AppLinkConfig): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (links.devOrigin && isLocalTenantUrl(url, links.devOrigin)) return true;
  if (url.protocol !== 'https:') return false;
  return (
    url.hostname === links.baseDomain ||
    url.hostname.endsWith(`.${links.baseDomain}`)
  );
}

export function renderEmailHtml(
  body: string,
  direction: 'ltr' | 'rtl',
  links: AppLinkConfig,
): string {
  const linked = escapeHtml(body).replace(URL_IN_TEXT, (match) => {
    const trailing = TRAILING_PUNCTUATION.exec(match)?.[0] ?? '';
    const escapedUrl = trailing ? match.slice(0, -trailing.length) : match;
    if (!isProductUrl(unescapeHtml(escapedUrl), links)) return match;
    return `<a href="${escapedUrl}" dir="ltr">${escapedUrl}</a>${trailing}`;
  });
  return direction === 'rtl'
    ? `<p dir="rtl">${linked}</p>`
    : `<p>${linked}</p>`;
}
