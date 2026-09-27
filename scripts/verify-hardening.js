'use strict';

/* eslint-disable no-console */
/**
 * Covers the input handling that sits between the app and the network: how
 * the AP address from the settings is read, the limits on every HTTP request,
 * and the cap on decompressing a framebuffer.
 *
 * Run: node scripts/verify-hardening.js
 */

const zlib = require('zlib');
const Module = require('module');

const realLoad = Module._load;
Module._load = function stubbed(request) {
  if (request === 'homey') {
    return {
      App: class {

        log() {}

      },
      Device: class {},
      Driver: class {},
    };
  }
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const { normalizeGateway } = require('../lib/gateway');
const { http, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES } = require('../lib/http');
const { unwrap } = require('../lib/rawImage');
const MyApp = require('../app');

const checks = [];

// The AP address
const cases = [
  ['192.168.1.10', '192.168.1.10'],
  ['  192.168.1.10  ', '192.168.1.10'],
  ['http://192.168.1.10', '192.168.1.10'],
  ['https://192.168.1.10/', '192.168.1.10'],
  ['http://192.168.1.10/index.html?x=1', '192.168.1.10'],
  ['192.168.1.10:8080', '192.168.1.10:8080'],
  ['HTTP://openepaperlink.local/', 'openepaperlink.local'],
  ['ap-kitchen', 'ap-kitchen'],
  ['', null],
  ['   ', null],
  [null, null],
  [42, null],
  ['http://', null],
  ['192.168.1.10:99999', null],
  ['user@192.168.1.10', null],
  ['192.168.1.10 extra', null],
  ['-bad-.local', null],
];
for (const [input, expected] of cases) {
  const actual = normalizeGateway(input);
  checks.push([`address ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, actual === expected]);
}

// Saving from the settings page
const store = {};
const app = Object.create(MyApp.prototype);
app.homey = {
  settings: {
    get: (key) => store[key],
    set: (key, value) => {
      store[key] = value;
    },
    unset: (key) => {
      delete store[key];
    },
  },
  __: (key, tokens) => `${key} ${JSON.stringify(tokens)}`,
};
checks.push(['a pasted URL is stored as a bare address', app.setGateway(' http://192.168.1.10/ ') === '192.168.1.10'
  && store.gateway === '192.168.1.10']);
let refusal = '';
try {
  app.setGateway('not an address');
} catch (error) {
  refusal = error.message;
}
checks.push(['something that is not an address is refused', refusal.startsWith('errors.invalidGateway')
  && store.gateway === '192.168.1.10']);
checks.push(['an empty value clears the address', app.setGateway('') === null && !('gateway' in store)]);
store.gateway = 'http://192.168.1.20/';
checks.push(['an address saved by an older version is still usable', app.getGateway() === '192.168.1.20']);

// Every HTTP request is bounded
checks.push(['requests time out', http.defaults.timeout === DEFAULT_TIMEOUT_MS && DEFAULT_TIMEOUT_MS > 0]);
checks.push(['responses are size-capped', http.defaults.maxContentLength === MAX_RESPONSE_BYTES]);

// A framebuffer that inflates past what it declares is refused, not expanded
const bomb = zlib.deflateSync(Buffer.alloc(64 * 1024 * 1024));
const container = Buffer.alloc(4 + bomb.length);
container.writeUInt32LE(1024, 0); // claims 1 kB
bomb.copy(container, 4);
const started = Date.now();
const { payload } = unwrap(container, { width: 296, height: 128, bpp: 2 });
const took = Date.now() - started;
console.log(`${bomb.length} bytes that inflate to 64 MB, claiming 1 kB: refused in ${took} ms`);
checks.push(['a zlib payload larger than it claims is refused', payload === null]);
checks.push(['without inflating all of it', took < 1000]);

let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
