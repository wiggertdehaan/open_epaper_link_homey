'use strict';

/* eslint-disable no-console */
/**
 * Checks how lib/apDiscovery.js decides what a subnet is and what an AP is.
 *
 * Both matter more than they look. Getting the subnet wrong means sweeping
 * someone else's network, and being loose about what counts as an AP means
 * offering the user the address of their printer.
 *
 * Pass an address to also run a real sweep:
 *   node scripts/verify-ap-discovery.js 192.168.0.158
 */

const { subnetOf, looksLikeAp, discover } = require('../lib/apDiscovery');

const AP_SYSINFO = {
  alias: 'SBW',
  env: 'ESP32_S3_16_8_YELLOW_AP',
  buildtime: '1768750871',
  buildversion: '2.85',
  ap_version: 25,
};

const checks = [
  ['a plain address gives its /24', subnetOf('192.168.0.17') === '192.168.0'],
  ['an address with a port gives its /24', subnetOf('192.168.0.17:80') === '192.168.0'],
  ['a 10.x address works too', subnetOf('10.1.2.3') === '10.1.2'],
  ['a hostname is refused', subnetOf('homey.local') === null],
  ['an IPv6 address is refused', subnetOf('fe80::1') === null],
  ['a short address is refused', subnetOf('192.168.0') === null],
  ['an out of range octet is refused', subnetOf('192.168.0.999') === null],
  ['nothing is refused', subnetOf(null) === null && subnetOf('') === null && subnetOf(42) === null],

  ['a real AP sysinfo is recognised', looksLikeAp(AP_SYSINFO) === true],
  ['an AP with no alias is still recognised', looksLikeAp({ env: 'ESP32', ap_version: 0 }) === true],
  ['some other JSON is not an AP', looksLikeAp({ hostname: 'printer', model: 'HP' }) === false],
  ['half a match is not an AP', looksLikeAp({ env: 'ESP32' }) === false],
  ['an empty env is not an AP', looksLikeAp({ env: '', ap_version: 1 }) === false],
  ['a string body is not an AP', looksLikeAp('<html>hello</html>') === false],
  ['nothing is not an AP', looksLikeAp(null) === false && looksLikeAp(undefined) === false],
];

let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

(async () => {
  const from = process.argv[2];
  if (from) {
    console.log(`\nSweeping the network ${from} is on:`);
    const started = Date.now();
    const found = await discover(from, { log: (m) => console.log(`  ${m}`) });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  took ${seconds}s, found ${found.length}`);
    for (const ap of found) {
      console.log(`  ${ap.address}  ${ap.alias || '(no alias)'}  ${ap.env}  firmware ${ap.buildversion}`);
    }
  } else {
    console.log('\n(pass a local address as an argument to also sweep for real)');
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
