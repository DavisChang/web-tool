'use strict';

/**
 * Fetch a URL server-side and return its body as markdown source.
 * Pure of Express; throws typed errors the server maps to status codes:
 *   { code: 'INVALID_URL' }   -> 400 "invalid url"
 *   { code: 'BLOCKED_HOST' }  -> 400 "blocked host"
 *   { code: 'FETCH_FAILED', reason } -> 502 "failed to fetch: <reason>"
 */

const dns = require('dns').promises;
const net = require('net');

const FETCH_TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;

/**
 * Build a typed error.
 * @param {string} code
 * @param {string} [reason]
 */
function typedError(code, reason) {
  const err = new Error(reason || code);
  err.code = code;
  if (reason) err.reason = reason;
  return err;
}

/**
 * Parse an IPv4-literal hostname into its canonical 32-bit value, accepting the
 * alternate encodings the URL/socket layer also accepts: dotted decimal/octal/
 * hex, and short forms (a, a.b, a.b.c, a.b.c.d). Returns null if the string is
 * not a valid IPv4 literal in any of these forms.
 * @param {string} host
 * @returns {number|null} unsigned 32-bit address, or null
 */
function parseIPv4(host) {
  if (!/^[0-9a-fx.]+$/i.test(host)) return null;
  const parts = host.split('.');
  if (parts.length === 0 || parts.length > 4) return null;

  const nums = [];
  for (const p of parts) {
    if (p === '') return null;
    let n;
    if (/^0x[0-9a-f]+$/i.test(p)) {
      n = parseInt(p, 16);
    } else if (/^0[0-7]+$/.test(p)) {
      n = parseInt(p, 8);
    } else if (/^[0-9]+$/.test(p)) {
      n = parseInt(p, 10);
    } else {
      return null;
    }
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }

  // Short-form rules: the final part absorbs the remaining bytes.
  const last = nums[nums.length - 1];
  const lead = nums.slice(0, -1);
  for (const part of lead) {
    if (part > 0xff) return null;
  }
  const maxLast = Math.pow(256, 4 - lead.length);
  if (last >= maxLast) return null;

  let value = last;
  for (let i = 0; i < lead.length; i++) {
    value += lead[i] * Math.pow(256, 3 - i);
  }
  return value >>> 0;
}

/**
 * Is a canonical 32-bit IPv4 value within an internal / reserved range?
 * @param {number} ip unsigned 32-bit
 * @returns {boolean}
 */
function isBlockedIPv4Value(ip) {
  const a = (ip >>> 24) & 0xff;
  const b = (ip >>> 16) & 0xff;

  if (a === 0) return true; // 0.0.0.0/8 ("this" network)
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast 224.0.0.0/4 + reserved 240.0.0.0/4
  return false;
}

/**
 * Normalize an IPv6 literal into an array of 8 16-bit groups, expanding "::".
 * Also accepts an embedded IPv4 tail (e.g. ::ffff:127.0.0.1). Returns null if
 * not a parseable IPv6 literal.
 * @param {string} addr (no brackets)
 * @returns {number[]|null}
 */
function expandIPv6(addr) {
  if (net.isIPv6(addr) === false) return null;

  let head = addr;
  let v4tail = null;

  // Split off a trailing IPv4 form if present.
  const lastColon = head.lastIndexOf(':');
  const tail = head.slice(lastColon + 1);
  if (tail.indexOf('.') !== -1) {
    if (net.isIPv4(tail) === false) return null;
    v4tail = tail.split('.').map(Number);
    head = head.slice(0, lastColon + 1); // keep trailing ':'
    head = head.replace(/:$/, ''); // drop the dangling colon we kept
  }

  const dblIdx = head.indexOf('::');
  let groups;
  if (dblIdx !== -1) {
    const left = head.slice(0, dblIdx).split(':').filter((s) => s !== '');
    const right = head.slice(dblIdx + 2).split(':').filter((s) => s !== '');
    const v4groups = v4tail ? 2 : 0;
    const missing = 8 - v4groups - left.length - right.length;
    if (missing < 0) return null;
    groups = left
      .concat(new Array(missing).fill('0'))
      .concat(right);
  } else {
    groups = head.split(':').filter((s) => s !== '');
  }

  const nums = groups.map((g) => parseInt(g, 16));
  if (v4tail) {
    nums.push((v4tail[0] << 8) | v4tail[1]);
    nums.push((v4tail[2] << 8) | v4tail[3]);
  }
  if (nums.length !== 8 || nums.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff)) {
    return null;
  }
  return nums;
}

/**
 * Decide whether an IP address string (v4 or v6 literal) targets an internal /
 * reserved range that should be blocked to mitigate SSRF.
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) {
    return isBlockedIPv4Value(parseIPv4(ip));
  }
  if (fam === 6) {
    const g = expandIPv6(ip);
    if (!g) return true; // unparseable -> block defensively

    // IPv4-mapped (::ffff:0:0/96) and IPv4-compatible (::/96 with low bits):
    // unwrap to IPv4 and apply v4 rules.
    const isMapped = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 &&
      g[4] === 0 && g[5] === 0xffff;
    const isCompat = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 &&
      g[4] === 0 && g[5] === 0;
    if (isMapped || isCompat) {
      const v4 = ((g[6] << 16) | g[7]) >>> 0;
      return isBlockedIPv4Value(v4);
    }

    if (g.every((x) => x === 0)) return true; // ::
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 &&
        g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 1) return true; // ::1
    if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((g[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast ff00::/8
    return false;
  }
  // Not an IP literal.
  return false;
}

/**
 * Decide whether a hostname should be blocked to mitigate SSRF, using only the
 * textual form (no DNS). Blocks loopback, link-local, metadata host, *.local,
 * RFC1918, and any IP literal (in any encoding) resolving to a reserved range.
 *
 * NOTE: hostname-only checking cannot defend against DNS rebinding; the actual
 * resolved addresses are validated in fetchMarkdown via assertResolvedSafe().
 * @param {string} hostname (already lowercased)
 * @returns {boolean}
 */
function isBlockedHost(hostname) {
  if (!hostname) return true;

  // Strip IPv6 brackets if present.
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '');

  const exactBlocked = new Set([
    'localhost',
    '0.0.0.0',
    '::1',
  ]);
  if (exactBlocked.has(host)) return true;

  // mDNS / internal domains.
  if (host === 'local' || host.endsWith('.local')) return true;

  // IP literals (any encoding): normalize then range-check.
  if (net.isIP(host)) {
    return isBlockedIp(host);
  }
  const v4 = parseIPv4(host);
  if (v4 !== null) {
    return isBlockedIPv4Value(v4);
  }

  return false;
}

/**
 * Resolve a hostname and assert every returned address is external. Throws a
 * BLOCKED_HOST typed error if any address is internal/reserved.
 * @param {string} hostname (with brackets already stripped for IPv6)
 * @returns {Promise<void>}
 */
async function assertResolvedSafe(hostname) {
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '');

  // IP literal: already validated by isBlockedHost; nothing to resolve.
  if (net.isIP(host) || parseIPv4(host) !== null) {
    if (isBlockedHost(host.toLowerCase())) throw typedError('BLOCKED_HOST');
    return;
  }

  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (_e) {
    throw typedError('BLOCKED_HOST');
  }
  if (!addrs || addrs.length === 0) throw typedError('BLOCKED_HOST');
  for (const { address } of addrs) {
    if (isBlockedIp(address)) throw typedError('BLOCKED_HOST');
  }
}

/**
 * Transform a github.com/.../blob/... URL into a raw.githubusercontent.com URL.
 * Returns the original href if no transform applies.
 * @param {URL} u
 * @returns {string}
 */
function githubBlobToRaw(u) {
  if (u.hostname === 'github.com' && u.pathname.includes('/blob/')) {
    // /<user>/<repo>/blob/<branch>/<path...> -> raw host, drop 'blob'.
    const parts = u.pathname.split('/').filter(Boolean);
    const blobIdx = parts.indexOf('blob');
    if (blobIdx >= 2) {
      const user = parts[0];
      const repo = parts[1];
      const rest = parts.slice(blobIdx + 1); // <branch>/<path...>
      return `https://raw.githubusercontent.com/${user}/${repo}/${rest.join('/')}`;
    }
  }
  return u.href;
}

/**
 * Validate a URL string for SSRF safety: scheme, textual host blocklist, and
 * DNS-resolved address blocklist. Throws typed errors on failure.
 * @param {string} target
 * @returns {Promise<URL>}
 */
async function validateUrl(target) {
  let u;
  try {
    u = new URL(target);
  } catch (_e) {
    throw typedError('INVALID_URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw typedError('INVALID_URL');
  }
  if (isBlockedHost(u.hostname.toLowerCase())) {
    throw typedError('BLOCKED_HOST');
  }
  await assertResolvedSafe(u.hostname);
  return u;
}

/**
 * Fetch markdown from a URL.
 * @param {string} rawUrl
 * @returns {Promise<{ url: string, markdown: string }>}
 */
async function fetchMarkdown(rawUrl) {
  // Validate the initial URL (scheme + host + resolved addresses).
  const u = await validateUrl(rawUrl);

  // Apply GitHub blob -> raw transform; re-validate the rewritten host.
  let current = githubBlobToRaw(u);
  await validateUrl(current);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    // Follow redirects manually so every hop is re-validated against the
    // blocklist (defeats redirect-based SSRF). fetch() will not auto-follow.
    let redirects = 0;
    /* eslint-disable no-await-in-loop */
    while (true) {
      res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { Accept: 'text/markdown, text/plain, text/*, */*' },
      });

      const status = res.status;
      const isRedirect = status === 301 || status === 302 || status === 303 ||
        status === 307 || status === 308;
      if (!isRedirect) break;

      const location = res.headers.get('location');
      if (!location) break; // treat as a normal (non-OK) response below
      if (redirects >= MAX_REDIRECTS) {
        throw typedError('FETCH_FAILED', 'too many redirects');
      }
      redirects += 1;

      // Resolve relative redirects against the current URL, then re-validate.
      const next = new URL(location, current).href;
      await validateUrl(next);
      current = next;
    }
    /* eslint-enable no-await-in-loop */
  } catch (err) {
    clearTimeout(timer);
    if (err && (err.code === 'BLOCKED_HOST' || err.code === 'INVALID_URL' || err.code === 'FETCH_FAILED')) {
      throw err;
    }
    const reason = err && err.name === 'AbortError' ? 'request timed out' : (err && err.message) || 'network error';
    throw typedError('FETCH_FAILED', reason);
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw typedError('FETCH_FAILED', `${res.status} ${res.statusText}`);
  }

  let markdown;
  try {
    markdown = await res.text();
  } catch (err) {
    throw typedError('FETCH_FAILED', (err && err.message) || 'failed to read body');
  }

  return { url: current, markdown };
}

module.exports = { fetchMarkdown, isBlockedHost, githubBlobToRaw };
