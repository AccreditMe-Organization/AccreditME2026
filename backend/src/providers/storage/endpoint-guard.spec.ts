import * as dns from 'dns';
import { assertEndpointHostAllowed, guardedLookup, isNonPublicAddress, PrivateEndpointRefusedError } from './endpoint-guard';

jest.mock('dns', () => ({ lookup: jest.fn() }));
const lookup = dns.lookup as unknown as jest.Mock;

describe('endpoint guard (ACC-177)', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.10',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:10.0.0.1', // IPv4-mapped
    '64:ff9b::a00:1', // NAT64 into 10.0.0.1
    'not-an-address',
  ])('treats %s as non-public', (address) => {
    expect(isNonPublicAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '52.95.110.1', '2a00:1450:4001:82a::200e'])('treats %s as public', (address) => {
    expect(isNonPublicAddress(address)).toBe(false);
  });

  it('refuses a private IP literal outright — Node never calls lookup for one', () => {
    expect(() => assertEndpointHostAllowed('10.0.0.5')).toThrow(PrivateEndpointRefusedError);
    expect(() => assertEndpointHostAllowed('[::1]')).toThrow(PrivateEndpointRefusedError);
    expect(() => assertEndpointHostAllowed('minio.example.com')).not.toThrow();
  });

  // The check runs when the socket resolves the name, on every connection —
  // so a host re-pointed at a private address after the settings were saved is
  // refused at the next request.
  it('refuses a host that now resolves to a private address', (done) => {
    lookup.mockImplementation((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: '10.0.0.7', family: 4 }]),
    );
    guardedLookup('minio.example.com', {}, (err) => {
      expect(err).toBeInstanceOf(PrivateEndpointRefusedError);
      done();
    });
  });

  it('refuses a host if ANY of its addresses is private, not only the first', (done) => {
    lookup.mockImplementation((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [
        { address: '52.95.110.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    );
    guardedLookup('minio.example.com', { all: true }, (err) => {
      expect(err).toBeInstanceOf(PrivateEndpointRefusedError);
      done();
    });
  });

  it('hands the socket exactly the vetted public address', (done) => {
    lookup.mockImplementation((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: '52.95.110.1', family: 4 }]),
    );
    guardedLookup('minio.example.com', {}, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe('52.95.110.1');
      expect(family).toBe(4);
      done();
    });
  });
});
