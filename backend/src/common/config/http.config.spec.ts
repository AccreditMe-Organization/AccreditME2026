import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express, Request } from 'express';
import { configureHttp, TRUSTED_PROXIES } from './http.config';
import { byAddress } from '../throttle/throttle-identity';

/**
 * ACC-129 follow-up — which address Express reports as `req.ip`, through
 * Express's OWN getter with configureHttp() applied, for a request arriving
 * from a given socket. supertest cannot make a request arrive from an fd12::
 * socket, so the request is built on Express's request prototype instead: the
 * code that decides `req.ip` is Express's, not a copy of it.
 *
 * Measured 7 Oct: Railway's edge reaches the container over its private IPv6
 * network (upstreamAddress http://[fd12:…]:3000). With only 100.64.0.0/10
 * trusted, that hop was not trusted, X-Forwarded-For was ignored, and 31
 * lookups from one visitor never reached the limit.
 */
describe('the client address behind Railway (ACC-129)', () => {
  let express: Express;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({}).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();
    configureHttp(app);
    await app.init();
    express = app.getHttpAdapter().getInstance();
    close = () => app.close();
  });

  afterAll(async () => close());

  /** A request as Express sees it, arriving from `socket` with an X-Forwarded-For. */
  function arriving(socket: string, forwardedFor?: string): Request {
    const req = Object.create(express.request) as Request;
    Object.assign(req, {
      app: express,
      headers:
        forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    });
    Object.defineProperty(req, 'socket', { value: { remoteAddress: socket } });
    Object.defineProperty(req, 'connection', {
      value: { remoteAddress: socket },
    });
    return req;
  }

  const RAILWAY_PRIVATE_HOP = 'fd12:991e:1f29:1:b000:167:3eae:99af';

  it('trusts the configured proxies, and no others', () => {
    expect(TRUSTED_PROXIES).toEqual(['loopback', '100.64.0.0/10', 'fd00::/8']);
  });

  it("counts a request from Railway's private network as the visitor, not the hop", () => {
    const req = arriving(RAILWAY_PRIVATE_HOP, '203.0.113.7');
    expect(req.ip).toBe('203.0.113.7');
    expect(byAddress(req)).toBe('ip:203.0.113.7');
  });

  it('a left-hand value the visitor sent cannot escape their bucket through that hop', () => {
    expect(
      byAddress(arriving(RAILWAY_PRIVATE_HOP, '10.9.9.9, 203.0.113.7')),
    ).toBe('ip:203.0.113.7');
    expect(
      byAddress(arriving(RAILWAY_PRIVATE_HOP, '8.8.8.8, 203.0.113.7')),
    ).toBe('ip:203.0.113.7');
  });

  it('still trusts the older 100.64.0.0/10 path, alone or behind the private hop', () => {
    expect(arriving('::ffff:100.64.0.1', '203.0.113.7').ip).toBe('203.0.113.7');
    expect(arriving(RAILWAY_PRIVATE_HOP, '203.0.113.7, 100.64.0.9').ip).toBe(
      '203.0.113.7',
    );
  });

  it('believes no X-Forwarded-For from a socket outside the trusted ranges', () => {
    // Non-vacuity guard: the same header IS honoured from a trusted hop above,
    // so this proves the trust list is doing the deciding.
    expect(arriving('198.51.100.50', '203.0.113.7').ip).toBe('198.51.100.50');
    expect(arriving('2001:db8::5', '203.0.113.7').ip).toBe('2001:db8::5');
  });
});
