import { ForbiddenException } from '@nestjs/common';
import {
  FRONTEND_URL_MISSING,
  ORIGIN_NOT_ALLOWED,
  buildCorsOptions,
  resolveFrontendOrigin,
} from './cors.config';

/**
 * ACC-128's two acceptance criteria, as tests.
 *
 * Both exist because the old code CLAIMED this behaviour in a comment and did
 * not have it. A comment cannot be asserted; these can.
 */
describe('CORS configuration (ACC-128)', () => {
  const ALLOWED = 'https://accreditme.app';

  describe('resolveFrontendOrigin — the boot must fail without it', () => {
    it('throws when FRONTEND_URL is absent, naming the variable', () => {
      expect(() => resolveFrontendOrigin({})).toThrow(FRONTEND_URL_MISSING);
      // The message must NAME it: a boot failure that does not say which
      // variable is missing sends the reader to the source.
      expect(FRONTEND_URL_MISSING).toContain('FRONTEND_URL');
    });

    // A dashboard field left as a space is the same mistake as an unset one, and
    // must not pass as configured — the deployed variable set was exactly this
    // class of error (CORS_ORIGIN set and dead, FRONTEND_URL live and missing).
    it('throws when FRONTEND_URL is blank or whitespace', () => {
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

  describe('buildCorsOptions — an unlisted origin is REFUSED, not reflected', () => {
    /** Runs the options' origin callback the way the cors middleware does. */
    const ask = (
      requestOrigin: string | undefined,
    ): { error: Error | null; allowed: boolean | undefined } => {
      const origin = buildCorsOptions(ALLOWED).origin as (
        o: string | undefined,
        cb: (err: Error | null, allow?: boolean) => void,
      ) => void;
      let error: Error | null = null;
      let allowed: boolean | undefined;
      origin(requestOrigin, (err, allow) => {
        error = err;
        allowed = allow;
      });
      return { error, allowed };
    };

    it('allows the configured origin', () => {
      const { error, allowed } = ask(ALLOWED);

      expect(error).toBeNull();
      expect(allowed).toBe(true);
    });

    // THE CRITERION. A string origin never refuses server-side: measured against
    // the cors package, it emits the CONFIGURED origin and calls next() with no
    // error, leaving the browser to compare and reject. That is untestable here,
    // which is why the origin is a function.
    it('refuses a different origin with a 403, not a 500', () => {
      const { error, allowed } = ask('https://evil.example');

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as unknown as ForbiddenException).message).toBe(ORIGIN_NOT_ALLOWED);
      expect(allowed).toBe(false);
    });

    it('refuses a near miss — scheme, port and subdomain all count', () => {
      for (const near of [
        'http://accreditme.app', // wrong scheme
        'https://accreditme.app:443', // explicit port is a different origin string
        'https://www.accreditme.app', // subdomain
        'https://accreditme.app.evil.example', // suffix attack
        'https://accreditme.appx',
      ]) {
        // The origin under test is named in the assertion itself, since Jest
        // has no withContext: a bare failure would not say which one slipped.
        expect([near, ask(near).error instanceof ForbiddenException]).toEqual([near, true]);
      }
    });

    // NOT A CROSS-ORIGIN REQUEST. curl, server-to-server calls and Railway's own
    // health check send no Origin header; refusing them would take the API down
    // for everything that is not a browser — which is most of what calls it
    // today, the deploy's own health probe included.
    it('allows a request with no Origin header at all', () => {
      const { error, allowed } = ask(undefined);

      expect(error).toBeNull();
      expect(allowed).toBe(true);
    });

    it('keeps credentials enabled, which is what forbids a wildcard', () => {
      expect(buildCorsOptions(ALLOWED).credentials).toBe(true);
    });
  });
});
