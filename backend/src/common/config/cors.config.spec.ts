import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  FRONTEND_URL_MISSING,
  buildCorsOptions,
  resolveFrontendOrigin,
} from './cors.config';

/**
 * ACC-128's two acceptance criteria, as tests.
 *
 * Both exist because the old code CLAIMED this behaviour in a comment and did
 * not have it. A comment cannot be asserted; these can.
 */
const ALLOWED = 'https://accreditme.app';

@Controller('probe')
class ProbeController {
  @Get()
  ok(): { ok: true } {
    return { ok: true };
  }
}

describe('CORS configuration (ACC-128)', () => {
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
      expect(resolveFrontendOrigin({ FRONTEND_URL: ALLOWED })).toBe(ALLOWED);
      expect(resolveFrontendOrigin({ FRONTEND_URL: `  ${ALLOWED}  ` })).toBe(ALLOWED);
    });

    it('reads process.env by default, which is what main.ts relies on', () => {
      const saved = process.env['FRONTEND_URL'];
      process.env['FRONTEND_URL'] = ALLOWED;
      try {
        expect(resolveFrontendOrigin()).toBe(ALLOWED);
      } finally {
        if (saved === undefined) delete process.env['FRONTEND_URL'];
        else process.env['FRONTEND_URL'] = saved;
      }
    });
  });

  /**
   * Criterion 2, verbatim: "A request from an unlisted origin is REFUSED RATHER
   * THAN REFLECTED."
   *
   * Reflected means the server echoes the REQUESTER's origin back, which is what
   * makes a permissive policy dangerous. So the assertion that settles this is
   * that `Access-Control-Allow-Origin` never carries the requester's value.
   *
   * Asserted against the REAL middleware through a real Nest app, not against a
   * callback of ours — `app.enableCors()` and the `cors` package are the things
   * whose behaviour was in doubt, and a unit test of our own function would have
   * proved only that our function does what we wrote.
   */
  describe('criterion 2 — an unlisted origin is never reflected', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
      }).compile();
      app = moduleRef.createNestApplication();
      app.enableCors(buildCorsOptions(ALLOWED));
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('echoes the allowed origin back to it, with credentials', async () => {
      const res = await request(app.getHttpServer()).get('/probe').set('Origin', ALLOWED);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      // Vary: Origin, or a shared cache could serve one origin's response to
      // another.
      expect(res.headers['vary']).toContain('Origin');
    });

    // THE CRITERION. The header carries the CONFIGURED origin, never the caller's
    // — so a browser compares it with its own origin, finds a mismatch and
    // blocks. Nothing is reflected.
    it('does NOT reflect an unlisted origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('Origin', 'https://evil.example');

      expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    });

    it('never answers with a wildcard, which credentials would make unusable', async () => {
      for (const origin of [ALLOWED, 'https://evil.example']) {
        const res = await request(app.getHttpServer()).get('/probe').set('Origin', origin);
        expect([origin, res.headers['access-control-allow-origin']]).toEqual([origin, ALLOWED]);
      }
    });

    it('does not reflect a near miss either — scheme, port and subdomain all count', async () => {
      for (const near of [
        'http://accreditme.app',
        'https://accreditme.app:8443',
        'https://www.accreditme.app',
        'https://accreditme.app.evil.example',
        'https://accreditme.appx',
      ]) {
        const res = await request(app.getHttpServer()).get('/probe').set('Origin', near);
        // Named in the assertion, since Jest has no withContext: a bare failure
        // would not say which origin slipped through.
        expect([near, res.headers['access-control-allow-origin']]).toEqual([near, ALLOWED]);
      }
    });

    // The preflight is what a browser actually sends first for anything
    // non-simple, and it must not carry the caller's origin either.
    it('does not reflect on a preflight', async () => {
      const res = await request(app.getHttpServer())
        .options('/probe')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
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
    });

    // An unlisted origin is BLOCKED BY THE BROWSER, not refused by us: the
    // handler still runs and answers 200. Recorded as an assertion so nobody
    // reads the absence of a 403 as an oversight — it is the behaviour ACC-128
    // asks for, and a status code here would be an unrequested change.
    it('still answers the request itself, because the browser is what blocks', async () => {
      const res = await request(app.getHttpServer())
        .get('/probe')
        .set('Origin', 'https://evil.example');

      expect(res.status).toBe(200);
    });
  });
});
