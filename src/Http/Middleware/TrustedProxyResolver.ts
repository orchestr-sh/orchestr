/**
 * TrustedProxyResolver - the single place proxy trust is decided
 * Symfony's Request::setTrustedProxies() header set + trusted proxy list
 *
 * The resolver answers two questions the framework needs before any
 * `X-Forwarded-*` value can influence a request: is this source address a
 * proxy the application trusts, and is this forwarded header part of the
 * configured trust set? Every matching rule - wildcard, exact address, IPv4
 * or IPv6 CIDR block - lives here (SRP); the TrustProxies middleware only
 * wires the resolver onto requests and Request only asks questions.
 *
 * @example
 * ```typescript
 * // config/trustedproxy.ts
 * export default {
 *   proxies: ['203.0.113.10', '10.0.0.0/8'],
 *   headers: ['x-forwarded-for', 'x-forwarded-proto'],
 * };
 *
 * const trust = new TrustedProxyResolver(resolveTrustedProxyConfig(config.get('trustedproxy')));
 *
 * trust.isTrustedProxy('10.1.2.3'); // true - inside the /8
 * trust.isTrustedProxy('198.51.100.7'); // false
 * trust.trusts('x-forwarded-host'); // false - not in the header set
 * ```
 */

import type { ProxyTrust } from '@/Routing/Request';

/**
 * The `trustedproxy` configuration section
 * Laravel: the proxy list and header set handed to Symfony's trusted proxies
 */
export interface TrustedProxyConfig {
  /**
   * Addresses whose forwarded headers may be honoured. Entries are the `*`
   * wildcard (trust every source), exact IPv4/IPv6 addresses, or CIDR blocks
   * like `10.0.0.0/8` and `2001:db8::/32`.
   */
  proxies: string[];

  /**
   * Forwarded request headers to trust from those proxies, lowercase.
   * The recognised values are `x-forwarded-for`, `x-forwarded-proto`,
   * `x-forwarded-host` and `x-forwarded-port`.
   */
  headers: string[];
}

/**
 * Framework defaults: trust nobody (forwarded headers are ignored until the
 * application names its proxies) and honour the complete X-Forwarded set
 * once it does.
 */
export const DEFAULT_TRUSTED_PROXY_CONFIG: TrustedProxyConfig = {
  proxies: [],
  headers: ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port'],
};

/**
 * Normalise a raw `trustedproxy` config section onto the framework defaults:
 * `proxies`/`headers` accept a single string or a list, entries are coerced
 * to strings, header names lowercased, and anything malformed falls back to
 * the default entry list.
 */
export function resolveTrustedProxyConfig(section: unknown): TrustedProxyConfig {
  const provided = section && typeof section === 'object' ? (section as Partial<TrustedProxyConfig>) : {};

  return {
    proxies: toStringList(provided.proxies, DEFAULT_TRUSTED_PROXY_CONFIG.proxies),
    headers: toStringList(provided.headers, DEFAULT_TRUSTED_PROXY_CONFIG.headers).map((header) => header.toLowerCase()),
  };
}

function toStringList(value: unknown, fallback: string[]): string[] {
  if (value === undefined || value === null) {
    return [...fallback];
  }

  const list = Array.isArray(value) ? value : [value];

  return list.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
}

/**
 * IPv4 -> 4 bytes; IPv6 (including `::` abbreviation and `::ffff:` mapped
 * IPv4) -> 16 bytes; undefined for anything that is not a valid address.
 */
function addressBytes(address: string): Uint8Array | undefined {
  if (address.includes(':')) {
    return ipv6Bytes(address);
  }

  const parts = address.split('.');

  if (parts.length !== 4) {
    return undefined;
  }

  const bytes = new Uint8Array(4);

  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i]) || Number(parts[i]) > 255) {
      return undefined;
    }

    bytes[i] = Number(parts[i]);
  }

  return bytes;
}

function ipv6Bytes(value: string): Uint8Array | undefined {
  // A trailing embedded IPv4 (e.g. ::ffff:192.0.2.3) becomes two 16-bit groups
  const lastColon = value.lastIndexOf(':');
  const tail = value.slice(lastColon + 1);

  if (tail.includes('.')) {
    const v4 = addressBytes(tail);

    if (!v4) {
      return undefined;
    }

    value = `${value.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }

  const [head, middle, ...rest] = value.split('::');

  if (rest.length > 0) {
    return undefined; // more than one `::`
  }

  const parseGroups = (source: string): number[] | undefined => {
    if (source === '') {
      return [];
    }

    const groups = source.split(':').map((group) => group.toLowerCase());

    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
      return undefined;
    }

    return groups.map((group) => Number.parseInt(group, 16));
  };

  const left = parseGroups(head ?? '');

  if (left === undefined) {
    return undefined;
  }

  let groups: number[];

  if (middle === undefined) {
    // No `::` abbreviation: the address must spell out all eight groups
    if (left.length !== 8) {
      return undefined;
    }

    groups = left;
  } else {
    const right = parseGroups(middle);

    if (right === undefined) {
      return undefined;
    }

    const fill = 8 - left.length - right.length;

    if (fill < 1) {
      return undefined; // `::` cannot overlap explicit groups
    }

    groups = [...left, ...new Array<number>(fill).fill(0), ...right];
  }

  const bytes = new Uint8Array(16);

  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });

  return bytes;
}

/**
 * An IPv6 address in `::ffff:a.b.c.d` form carries an IPv4 hop; unwrap it
 * so lists written in either family can still speak to sockets reported in
 * the other.
 */
function comparableBytes(address: Uint8Array): Uint8Array {
  const mapped =
    address.length === 16 &&
    address.slice(0, 10).every((byte) => byte === 0) &&
    address[10] === 0xff &&
    address[11] === 0xff;

  return mapped ? address.slice(12) : address;
}

/**
 * Whether an address falls inside a CIDR block (or equals it when no prefix
 * length is given). Families must match: an IPv4 address never satisfies an
 * IPv6 block and vice versa.
 */
function matchesCidr(address: string, block: string): boolean {
  const [network, prefixPart] = block.split('/');
  const left = comparableBytes(addressBytes(address) ?? new Uint8Array());
  const right = comparableBytes(addressBytes(network) ?? new Uint8Array());

  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return false;
  }

  const prefix = prefixPart === undefined ? left.length * 8 : Number.parseInt(prefixPart, 10);

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > left.length * 8) {
    return false;
  }

  for (let i = 0; i < left.length; i++) {
    if (i * 8 >= prefix) {
      break;
    }

    const bits = Math.min(8, prefix - i * 8);
    const mask = (0xff << (8 - bits)) & 0xff;

    if ((left[i] & mask) !== (right[i] & mask)) {
      return false;
    }
  }

  return true;
}

/**
 * TrustedProxyResolver - answers the middleware's and Request's trust
 * questions for one configuration
 */
export class TrustedProxyResolver implements ProxyTrust {
  constructor(
    /**
     * The effective trusted-proxy options
     */
    public readonly config: TrustedProxyConfig = { ...DEFAULT_TRUSTED_PROXY_CONFIG }
  ) {}

  /**
   * Determine whether a source address belongs to a trusted proxy. The `*`
   * wildcard trusts every address - including an unknown socket (undefined),
   * which is what a test harness or an in-memory transport hands over.
   * Exact entries compare byte-wise, so `::1` and `0:0:0:0:0:0:0:1` agree.
   * Laravel: Symfony's isFromTrustedProxy() against the setTrustedProxies list
   */
  isTrustedProxy(ip: string | undefined): boolean {
    if (this.config.proxies.includes('*')) {
      return true;
    }

    if (ip === undefined) {
      return false;
    }

    return this.config.proxies.some((proxy) => {
      if (proxy.includes('/')) {
        return matchesCidr(ip, proxy);
      }

      const bytes = addressBytes(ip);
      const trusted = addressBytes(proxy);

      if (bytes && trusted) {
        // Byte-wise comparison, with ::ffff: mapped forms unwrapped so an
        // IPv4 socket matches an IPv6-written entry and vice versa
        const left = comparableBytes(bytes);
        const right = comparableBytes(trusted);

        if (left.length === right.length) {
          return left.every((byte, index) => byte === right[index]);
        }
      }

      return ip === proxy;
    });
  }

  /**
   * Determine whether a forwarded header is part of the trust set. Header
   * names match case-insensitively.
   */
  trusts(header: string): boolean {
    return this.config.headers.includes(header.toLowerCase());
  }
}
