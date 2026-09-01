'use strict';

const net = require('net');
const axios = require('axios');

/**
 * Finding the OpenEPaperLink AP on the local network.
 *
 * There is no mDNS record to look for, so this sweeps the Homey's own /24 and
 * asks every address for /sysinfo. An AP answers that with a small JSON body
 * carrying `env` (the board it was built for) and `ap_version`, which together
 * are specific enough that no other device on a home network will match.
 *
 * The sweep is user-initiated, from a button on the settings page, rather than
 * something that runs on its own: it is 254 requests, and a home network is
 * not ours to poll unasked.
 */

// An AP is an ESP32 and answers slowly, more so when several requests
// arrive at once. Addresses with nothing behind them fail immediately
// rather than waiting this out, so a generous timeout only costs time on
// hosts that are actually up. Measured: 1500 ms with 24 in flight misses
// the AP entirely.
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_CONCURRENCY = 8;

// Phase one only asks whether anything accepts a TCP connection on port 80.
// That is cheap, so it can be short and wide, and it cuts the addresses worth
// a real HTTP request down from 254 to the handful of web servers on the
// network.
const REACHABLE_TIMEOUT_MS = 800;
const REACHABLE_CONCURRENCY = 32;

/**
 * The /24 an address belongs to.
 *
 * @param {string} address  "192.168.0.17" or "192.168.0.17:80"
 * @returns {string|null}   "192.168.0", or null if it is not an IPv4 address
 */
function subnetOf(address) {
  if (typeof address !== 'string') return null;

  const host = address.split(':')[0].trim();
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  if (!parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)) return null;

  return parts.slice(0, 3).join('.');
}

/**
 * Whether a /sysinfo body came from an OpenEPaperLink AP.
 */
function looksLikeAp(data) {
  return Boolean(data)
    && typeof data === 'object'
    && typeof data.env === 'string'
    && data.env.length > 0
    && data.ap_version !== undefined;
}

/**
 * Runs `task` over `items`, at most `limit` at a time.
 */
async function pool(items, limit, task) {
  const results = [];
  let next = 0;

  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      // eslint-disable-next-line no-await-in-loop
      const value = await task(items[index]);
      if (value) results.push(value);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Whether anything accepts a TCP connection on port 80 at this address.
 *
 * An address with no host behind it is refused or unreachable straight away,
 * so this settles the great majority of a /24 in milliseconds.
 */
function acceptsHttp(address, timeout) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value ? address : null);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(80, address);
  });
}

/**
 * Asks one address whether it is an AP.
 *
 * @returns {Promise<object|null>} { address, alias, env, buildversion, apVersion }
 */
async function probe(address, timeout) {
  try {
    const { data } = await axios.get(`http://${address}/sysinfo`, {
      timeout,
      // A device that answers with a 500 page is not an AP; do not follow it.
      validateStatus: (status) => status === 200,
    });

    if (!looksLikeAp(data)) return null;

    return {
      address,
      alias: typeof data.alias === 'string' && data.alias.trim() ? data.alias.trim() : null,
      env: data.env,
      buildversion: data.buildversion || null,
      apVersion: data.ap_version,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Sweeps the /24 that `localAddress` sits on, looking for APs.
 *
 * @param {string} localAddress  the Homey's own address
 * @param {object} [options]
 * @param {number} [options.timeout]      per-address timeout in ms
 * @param {number} [options.concurrency]  addresses probed at once
 * @param {function} [options.log]
 * @returns {Promise<Array<object>>} every AP found, in address order
 */
async function discover(localAddress, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  const concurrency = options.concurrency || DEFAULT_CONCURRENCY;
  const log = options.log || (() => {});

  const subnet = subnetOf(localAddress);
  if (!subnet) {
    throw new Error(`Cannot work out a subnet from "${localAddress}"`);
  }

  const candidates = [];
  for (let host = 1; host <= 254; host++) candidates.push(`${subnet}.${host}`);

  log(`Scanning ${subnet}.1-254 for an OpenEPaperLink AP`);

  // Asking all 254 addresses for /sysinfo directly takes about two minutes,
  // because an AP needs a timeout of seconds and every address has to be given
  // that long. Narrowing to the web servers first brings it under twenty.
  const reachable = await pool(
    candidates,
    options.reachableConcurrency || REACHABLE_CONCURRENCY,
    (address) => acceptsHttp(address, options.reachableTimeout || REACHABLE_TIMEOUT_MS),
  );

  log(`${reachable.length} address(es) answer on port 80, asking each for /sysinfo`);

  const found = await pool(reachable, concurrency, async (address) => {
    const result = await probe(address, timeout);
    if (result) log(`Found an AP at ${result.address}${result.alias ? ` (${result.alias})` : ''}`);
    return result;
  });

  // The pool finishes in completion order, not address order.
  found.sort((a, b) => Number(a.address.split('.')[3]) - Number(b.address.split('.')[3]));
  return found;
}

module.exports = {
  DEFAULT_TIMEOUT_MS, DEFAULT_CONCURRENCY, REACHABLE_TIMEOUT_MS, REACHABLE_CONCURRENCY,
  subnetOf, looksLikeAp, acceptsHttp, probe, discover,
};
