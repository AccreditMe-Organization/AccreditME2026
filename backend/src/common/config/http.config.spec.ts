import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express, Request } from 'express';
import { configureHttp, RAILWAY_PROXY_HOPS } from './http.config';
import { byAddress } from '../throttle/throttle-identity';

/**
 * ACC-129 — which address Express reports as `req.ip`, through Express's OWN
 * getter with configureHttp() applied. The request is built on Express's
 * request prototype so it can arrive from Railway's router socket: the code
 * that decides `req.ip` is Express's, not a copy of it.
 *
 * The headers are the shape measured on Railway on 7 Oct:
 * socket ::ffff:100.64.0.x (the internal router), X-Forwarded-For
 * "<visitor>, <edge>", the edge address varying per request.
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

  const ROUTER = '::ffff:100.64.0.3';

  it('trusts exactly two hops: the router, then the edge', () => {
    expect(RAILWAY_PROXY_HOPS).toBe(2);
    expect(express.get('trust proxy')).toBe(2);
  });

  it('counts the visitor in front of the edge address', () => {
    const req = arriving(ROUTER, '203.0.113.7, 152.233.15.123');
    expect(req.ip).toBe('203.0.113.7');
    expect(byAddress(req)).toBe('ip:203.0.113.7');
  });

  it('gives one visitor the same address whichever edge they came through', () => {
    const a = arriving('::ffff:100.64.0.2', '203.0.113.7, 152.233.15.123');
    const b = arriving('::ffff:100.64.0.4', '203.0.113.7, 152.233.68.97');
    // Non-vacuity guard: the two requests really do differ in every hop.
    expect(a.socket.remoteAddress).not.toBe(b.socket.remoteAddress);
    expect(a.headers['x-forwarded-for']).not.toBe(b.headers['x-forwarded-for']);
    expect(byAddress(a)).toBe(byAddress(b));
  });

  it('a value the visitor wrote on the left is never the one counted', () => {
    const req = arriving(ROUTER, '6.6.6.6, 203.0.113.7, 152.233.15.123');
    expect(req.ip).toBe('203.0.113.7');
    expect(req.ip).not.toBe('6.6.6.6');
  });

  it('takes a single-entry X-Forwarded-For as the visitor', () => {
    expect(arriving(ROUTER, '203.0.113.7').ip).toBe('203.0.113.7');
  });

  it('with no X-Forwarded-For (local), the socket address is the visitor', () => {
    expect(arriving('127.0.0.1').ip).toBe('127.0.0.1');
    expect(arriving('198.51.100.50').ip).toBe('198.51.100.50');
  });
});
