import { escapeHtml, renderEmailHtml } from './email-html';
import { AppLinkConfig } from '../../common/config/app-url.config';

/** ACC-158 — escape first, then link only the product's own hosts. */
const LINKS: AppLinkConfig = { baseDomain: 'accreditme.app', devOrigin: null };
const INVITE =
  'https://al-nakheel.accreditme.app/accept-invitation?token=0123abcd';

describe('renderEmailHtml (ACC-158)', () => {
  it('makes a link to a tenant host an anchor, with the URL as its text', () => {
    expect(
      renderEmailHtml(`Accept your invitation: ${INVITE}`, 'ltr', LINKS),
    ).toBe(
      `<p>Accept your invitation: <a href="${INVITE}" dir="ltr">${INVITE}</a></p>`,
    );
  });

  it('escapes every interpolated value — markup in tenant data arrives as text', () => {
    const html = renderEmailHtml(
      `Join <script>alert(1)</script> & "Co" 'Ltd' on AccreditMe`,
      'ltr',
      LINKS,
    );
    expect(html).toBe(
      '<p>Join &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot; &#39;Ltd&#39; on AccreditMe</p>',
    );
    expect(html).not.toContain('<script>');
  });

  // A URL someone typed into a task title must not become a clickable link in
  // the product's own email.
  it('leaves a URL to any other host as plain text', () => {
    for (const url of [
      'https://evil.example/login',
      'https://accreditme.app.evil.example/x',
      'https://evilaccreditme.app/x',
      'http://al-nakheel.accreditme.app/x', // http, not https
    ]) {
      expect(renderEmailHtml(`See ${url}`, 'ltr', LINKS)).toBe(
        `<p>See ${url}</p>`,
      );
    }
  });

  // ACC-139 — a local link is the tenant's own local host
  // (http://{slug}.localhost:4200), which is what buildTenantUrl writes.
  it("links a tenant's local host when the development origin is configured, and nothing else on localhost", () => {
    const dev: AppLinkConfig = {
      baseDomain: 'accreditme.app',
      devOrigin: 'http://localhost:4200',
    };
    const local = 'http://al-nakheel.localhost:4200/accept-invitation?token=1';
    expect(renderEmailHtml(local, 'ltr', dev)).toBe(
      `<p><a href="${local}" dir="ltr">${local}</a></p>`,
    );
    for (const other of [
      'http://localhost:4200/x', // no organisation in it
      'http://al-nakheel.localhost:3000/x', // another port
      'https://al-nakheel.localhost:4200/x', // another scheme
      'http://a.b.localhost:4200/x', // two labels
    ]) {
      expect(renderEmailHtml(other, 'ltr', dev)).toBe(`<p>${other}</p>`);
    }
    expect(renderEmailHtml(local, 'ltr', LINKS)).toBe(`<p>${local}</p>`);
  });

  it('keeps sentence punctuation after a link outside the anchor', () => {
    expect(renderEmailHtml(`Open ${INVITE}.`, 'ltr', LINKS)).toBe(
      `<p>Open <a href="${INVITE}" dir="ltr">${INVITE}</a>.</p>`,
    );
    expect(renderEmailHtml(`افتح ${INVITE}،`, 'rtl', LINKS)).toBe(
      `<p dir="rtl">افتح <a href="${INVITE}" dir="ltr">${INVITE}</a>،</p>`,
    );
  });

  it('keeps an ampersand in a link escaped inside href, as HTML requires', () => {
    const url = 'https://acme.accreditme.app/x?a=1&b=2';
    expect(renderEmailHtml(url, 'ltr', LINKS)).toBe(
      '<p><a href="https://acme.accreditme.app/x?a=1&amp;b=2" dir="ltr">https://acme.accreditme.app/x?a=1&amp;b=2</a></p>',
    );
  });

  it('marks an Arabic body right-to-left and leaves an English one as a plain paragraph', () => {
    expect(renderEmailHtml('مرحبا', 'rtl', LINKS)).toBe(
      '<p dir="rtl">مرحبا</p>',
    );
    expect(renderEmailHtml('Hello', 'ltr', LINKS)).toBe('<p>Hello</p>');
  });
});

describe('escapeHtml (ACC-158)', () => {
  it('escapes the five characters that are significant in HTML text and attributes', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
