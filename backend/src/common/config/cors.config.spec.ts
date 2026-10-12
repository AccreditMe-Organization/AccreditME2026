import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  FRONTEND_URL_MISSING,
  buildCorsOptions,
  isAllowedOrigin,
  labelFromOrigin,
  resolveFrontendOrigin,
} from './cors.config';

/**
 * ACC-128's two acceptance criteria, as tests, and ACC-139's widening of the
 * second to every tenant's own origin.
 *
 * Both exist because the old code CLAIMED this behaviour in a comment and did
 * not have it. A comment cannot be asserted; these can.
 */
const FRONTEND = 'http://localhost:4200';
const BASE_DOMAIN = 'accreditme.app';
const TENANT = 'https://acme.accreditme.app';

@Controller('probe')
class ProbeController {
  @Get()
  ok(): { ok: true } {
    return { ok: true };
  }
}

describe('CORS configuration (ACC-128, ACC-139)', () => {
  describe('criterion 1 — the boot must fail without FRONTEND_URL', () => {
    it('throws when it is absent, naming the variable', () => {
      expect(() => resolveFrontendOrigin({})).toThrow(FRONTEND_URL_MISSING);
      // The message must NAME it: a boot failure that does not say which
      // variable is missing sends the reader to the source.
      expect(FRONTEND_URL_MISSING).toContain('FRONTEND_URL');
    });

    // A dashboard field left as a space is the same mistake as an unset one, and
    // must not pass as configured — the deployed variable set was exactly this
    // class of error (CORS_ORIGIN set to an unedited placeholder, FRONTEND_URL
    // live and missing).
    it('throws when it is blank or whitespace', () => {
      expect(() => resolveFrontendOrigin({ FRONTEND_URL: '' })).toThrow(FRONTEND_URL_MISSING);
      expect(() => resolveFrontendOrigin({ FRONTEND_URL: '   ' })).toThrow(FRONTEND_URL_MISSING);
      expect(() => resolveFrontendOrigin({ FRONTEND_URL: '\t\n' })).toThrow(FRONTEND_URL_MISSING);
    });

    it('returns the origin, trimmed, when it is set', () => {
      expect(resolveFrontendOrigin({ FRONTEND_URL: FRONTEND })).toBe(FRONTEND);
      expect(resolveFrontendOrigin({ FRONTEND_URL: `  ${FRONTEND}  ` })).toBe(
        FRONTEND,
      );
    });

    it('reads process.env by default, which is what main.ts relies on', () => {
      const saved = process.env['FRONTEND_URL'];
      process.env['FRONTEND_URL'] = FRONTEND;
      try {
        expect(resolveFrontendOrigin()).toBe(FRONTEND);
      } finally {
        if (saved === undefined) delete process.env['FRONTEND_URL'];
        else process.env['FRONTEND_URL'] = saved;
      }
    });
  });

  /**
   * Criterion 2, as ACC-139 amends it: an origin is reflected only when it is
   * FRONTEND_URL exactly, or https://{one label}.{APP_BASE_DOMAIN} with no
   * port. Everything else gets no Access-Control-Allow-Origin at all.
   *
   * Asserted against the REAL middleware through a real Nest app, not only
   * against our predicate — `app.enableCors()` and the `cors` package are what
   * a browser actually meets.
   */
  describe('criterion 2 — only our own origins are reflected', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
      }).compile();
      app = moduleRef.createNestApplication();
      app.enableCors(buildCorsOptions(FRONTEND, BASE_DOMAIN));
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    const allowOriginFor = async (origin: string): Promise<unknown> =>
      (await request(app.getHttpServer()).get('/probe').set('Origin', origin))
        .headers['access-control-allow-origin'];

    it("echoes a tenant's own origin back to it, with credentials", async () => {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('Origin', TENANT);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(TENANT);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      // Vary: Origin, or a shared cache could serve one origin's response to
      // another.
      expect(res.headers['vary']).toContain('Origin');
    });

    it('echoes FRONTEND_URL back to it, exactly as before', async () => {
      expect(await allowOriginFor(FRONTEND)).toBe(FRONTEND);
    });

    // THE GUARANTEE ACC-128 MADE, surviving the widening: an origin outside
    // our own namespace is never reflected. Named in the assertion, since Jest
    // has no withContext — a bare failure would not say which one slipped.
    it('reflects nothing outside our own origins — scheme, port, depth and domain all count', async () => {
      for (const origin of [
        'https://acme.accreditme.evil', // another domain
        'https://accreditme.app.evil.com', // ours as a prefix of theirs
        'https://evilaccreditme.app', // ours as a suffix of a word
        'http://acme.accreditme.app', // not https
        'https://accreditme.app', // the apex: no tenant in it
        'https://a.b.accreditme.app', // two labels
        'https://acme.accreditme.app:8443', // a port
        'https://xn--80ak6aa92e.accreditme.app', // a punycode label
        'http://localhost:4201', // near FRONTEND_URL, not it
        'https://evil.example',
      ]) {
        expect([origin, await allowOriginFor(origin)]).toEqual([
          origin,
          undefined,
        ]);
      }
    });

    // The preflight is what a browser actually sends first for anything
    // non-simple, and it must not carry the caller's origin either.
    it('does not reflect on a preflight, and does on a tenant preflight', async () => {
      const refused = await request(app.getHttpServer())
        .options('/probe')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(refused.headers['access-control-allow-origin']).toBeUndefined();

      const allowed = await request(app.getHttpServer())
        .options('/probe')
        .set('Origin', TENANT)
        .set('Access-Control-Request-Method', 'POST');
      expect(allowed.headers['access-control-allow-origin']).toBe(TENANT);
    });

    // NOT A CROSS-ORIGIN REQUEST, and it must stay a 200. curl, server-to-server
    // calls and Railway's own health probe send no Origin header; an earlier
    // version of this file refused them with a 403, which would have taken the
    // API down for everything that is not a browser — the deploy's own health
    // check included.
    it('leaves a request with no Origin header alone', async () => {
      const res = await request(app.getHttpServer()).get('/probe');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    // An unlisted origin is BLOCKED BY THE BROWSER, not refused by us: the
    // handler still runs and answers 200. Recorded as an assertion so nobody
    // reads the absence of a 403 as an oversight — §15.10 records why the 403
    // version was reverted.
    it('still answers the request itself, because the browser is what blocks', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('Origin', 'https://evil.example');

      expect(res.status).toBe(200);
    });
  });

  describe('isAllowedOrigin', () => {
    it('allows one DNS label under the base domain, and FRONTEND_URL', () => {
      for (const origin of [
        TENANT,
        'https://al-nakheel.accreditme.app',
        'https://platform.accreditme.app',
        FRONTEND,
      ]) {
        expect([
          origin,
          isAllowedOrigin(origin, FRONTEND, BASE_DOMAIN),
        ]).toEqual([origin, true]);
      }
    });

    it('refuses a label that is not a DNS label, and anything that is not an origin', () => {
      for (const origin of [
        'https://-acme.accreditme.app',
        'https://acme-.accreditme.app',
        'https://.accreditme.app',
        'https://acme.accreditme.app/',
        'https://acme.accreditme.app/path',
        'not a url',
        '',
      ]) {
        expect([
          origin,
          isAllowedOrigin(origin, FRONTEND, BASE_DOMAIN),
        ]).toEqual([origin, false]);
      }
    });
  });

  // ACC-204 — the one place an Origin is read as an organisation's address.
  describe('labelFromOrigin', () => {
    const DEV = 'http://localhost:4200';

    it('reads the one label of a production address', () => {
      expect(labelFromOrigin('https://al-nakheel.accreditme.app', 'accreditme.app')).toBe('al-nakheel');
      // The platform organisation's address (its slug is `platform`).
      expect(labelFromOrigin('https://platform.accreditme.app', 'accreditme.app')).toBe('platform');
    });

    it('reads a local address only when the dev origin is given, on its scheme and port', () => {
      expect(labelFromOrigin('http://al-nakheel.localhost:4200', 'accreditme.app', DEV)).toBe('al-nakheel');
      expect(labelFromOrigin('http://platform.localhost:4200', 'accreditme.app', DEV)).toBe('platform');
      expect(labelFromOrigin('http://al-nakheel.localhost:4200', 'accreditme.app')).toBeNull();
      expect(labelFromOrigin('http://al-nakheel.localhost:4201', 'accreditme.app', DEV)).toBeNull();
      expect(labelFromOrigin('https://al-nakheel.localhost:4200', 'accreditme.app', DEV)).toBeNull();
    });

    it('returns the label of www (it matches no organisation), and null for everything that names none', () => {
      expect(labelFromOrigin('https://www.accreditme.app', 'accreditme.app')).toBe('www');
      for (const origin of [
        'https://accreditme.app', // the apex
        'https://a.b.accreditme.app', // two labels
        'https://al-nakheel.accreditme.app/', // more than an origin
        'https://al-nakheel.accreditme.app/login',
        'https://al-nakheel.accreditme.app:8443', // a port in production
        'http://al-nakheel.accreditme.app', // http in production
        'https://al-nakheel.accreditme.app.evil.example',
        'https://evil.example',
        'https://xn--nxasmq6b.accreditme.app', // punycode is not a slug
        'null', // what a sandboxed page sends
        '',
        'not an origin',
      ]) {
        expect([origin, labelFromOrigin(origin, 'accreditme.app', DEV)]).toEqual([origin, null]);
      }
    });
  });
});
