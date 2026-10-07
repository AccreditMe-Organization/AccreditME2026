import { BlockList, isIP } from 'net';
import { lookup as dnsLookup, LookupAddress, LookupOptions } from 'dns';

// ACC-177 — the private-address guard for a customer's MinIO endpoint.
//
// A tenant admin types the endpoint, and the server connects to it. Without a
// guard that is a request forger: point it at 169.254.169.254, at the Redis
// proxy, at anything on the platform's private network, and the server makes
// the call. On the cloud tier only PUBLIC addresses are allowed; a Tier 2/3
// installation whose MinIO sits on a private network sets
// STORAGE_ALLOW_PRIVATE_ENDPOINTS=true.
//
// THE CHECK RUNS AT CONNECT TIME, ON EVERY CONNECTION (Ahmad, 7 Oct). It is not
// a save-time validation: a host that resolved to a public address when the
// settings were saved can be re-pointed at a private one afterwards. So the
// guard is the socket's own `lookup` — the address it approves is the address
// the socket connects to, and there is no second resolution to slip between
// the check and the connection. An IP literal never reaches `lookup` (Node
// skips it), so the endpoint's host is ALSO checked directly, by
// assertEndpointHostAllowed(), every time a provider is built.

const blocked = new BlockList();
// IPv4 — unspecified, private, CGNAT, loopback, link-local (cloud metadata),
// IETF, TEST-NETs, benchmarking, multicast, reserved, broadcast.
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
// IPv6 — unspecified, loopback, NAT64 (reaches IPv4 space), discard,
// documentation, unique-local, link-local, multicast.
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** True when the address is not on the public internet. */
export function isNonPublicAddress(address: string): boolean {
  // An IPv4-mapped IPv6 address (::ffff:10.0.0.1) is the IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const candidate = mapped ? mapped[1]! : address;
  const family = isIP(candidate);
  if (family === 0) return true; // not an address at all — refuse
  return blocked.check(candidate, family === 4 ? 'ipv4' : 'ipv6');
}

export class PrivateEndpointRefusedError extends Error {
  constructor(readonly host: string) {
    super(`The storage endpoint ${host} is not a public address`);
    this.name = 'PrivateEndpointRefusedError';
  }
}

/**
 * Refuses an endpoint whose host is an IP literal on a private range. A host
 * NAME is checked when the socket resolves it, by guardedLookup().
 */
export function assertEndpointHostAllowed(hostname: string): void {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 0 && isNonPublicAddress(bare)) {
    throw new PrivateEndpointRefusedError(hostname);
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A drop-in for dns.lookup that refuses a host if ANY address it resolves to
 * is non-public, and otherwise hands the socket exactly the vetted addresses.
 * "Any", not "the first": a name resolving to one public and one private
 * address must not be allowed to land on the private one.
 */
export function guardedLookup(hostname: string, options: LookupOptions | number, callback: LookupCallback): void {
  const opts: LookupOptions = typeof options === 'number' ? { family: options } : (options ?? {});
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err, opts.all ? [] : '', 0);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isNonPublicAddress(a.address))) {
      return callback(new PrivateEndpointRefusedError(hostname) as NodeJS.ErrnoException, opts.all ? [] : '', 0);
    }
    if (opts.all) return callback(null, list);
    const first = list[0]!;
    return callback(null, first.address, first.family);
  });
}
