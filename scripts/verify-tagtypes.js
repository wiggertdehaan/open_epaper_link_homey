'use strict';

/* eslint-disable no-console */
/**
 * Covers lib/tagTypes.js: where a tag type definition comes from, that
 * nothing unusable is ever cached, that a cached copy is refreshed from the
 * AP once it is old, and that a hwType from the network cannot be used to
 * reach outside the cache directory.
 *
 * Runs against a stand-in AP on localhost and temporary directories.
 *
 * Run: node scripts/verify-tagtypes.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { TagTypeStore, isValidHwType } = require('../lib/tagTypes');

const DEF = (version, extra = {}) => ({
  version, name: `Type v${version}`, width: 296, height: 128, bpp: 2, colortable: { white: [255, 255, 255] }, ...extra,
});

(async () => {
  const checks = [];
  const served = {}; // path -> body, or a function
  const hits = [];

  const ap = http.createServer((req, res) => {
    hits.push(req.url);
    const body = served[req.url];
    setTimeout(() => {
      if (body === undefined) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    }, 20);
  });
  await new Promise((resolve) => ap.listen(0, '127.0.0.1', resolve));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oepl-tagtypes-'));
  const cacheDir = path.join(root, 'cache');
  const bundledDir = path.join(root, 'bundled');
  fs.mkdirSync(bundledDir);

  let gateway = `127.0.0.1:${ap.address().port}`;
  const makeStore = (options = {}) => new TagTypeStore({
    cacheDir, bundledDir, getGateway: () => gateway, ...options,
  });

  const age = (file, ms) => {
    const when = new Date(Date.now() - ms);
    fs.utimesSync(file, when, when);
  };

  // hwType is checked before it goes anywhere near a path or a URL
  checks.push(['hwType must be a byte', [0, 1, 255].every(isValidHwType)
    && !['../../etc/x', '01', 256, -1, 1.5, null, undefined, NaN].some(isValidHwType)]);
  const hitsBefore = hits.length;
  const traversal = await makeStore().get('../../../tmp/evil');
  checks.push(['a path in hwType is refused without touching disk or network',
    traversal === null && hits.length === hitsBefore && !fs.existsSync(cacheDir)]);

  // First sight: fetched once, however many ask at the same time, and cached
  served['/tagtypes/01.json'] = DEF(1);
  const store = makeStore();
  const burst = await Promise.all([1, 1, 1, 1, 1].map((hw) => store.get(hw)));
  checks.push(['a burst of lookups for a new type costs one fetch',
    hits.filter((h) => h === '/tagtypes/01.json').length === 1 && burst.every((d) => d && d.version === 1)]);
  const cachedFile = path.join(cacheDir, '01.json');
  checks.push(['the fetched definition is cached on disk', fs.existsSync(cachedFile)
    && JSON.parse(fs.readFileSync(cachedFile, 'utf8')).version === 1]);

  // A fresh cached copy is used without asking the AP
  served['/tagtypes/01.json'] = DEF(2);
  const fromCache = await makeStore().get(1);
  checks.push(['a fresh cached copy is used as is', fromCache.version === 1]);

  // A stale one is refreshed from the AP
  age(cachedFile, 8 * 24 * 60 * 60 * 1000);
  const refreshed = await makeStore().get(1);
  checks.push(['a stale cached copy is refreshed from the AP', refreshed.version === 2
    && JSON.parse(fs.readFileSync(cachedFile, 'utf8')).version === 2]);

  // A bad answer is never cached, and the stale copy is used meanwhile
  age(cachedFile, 8 * 24 * 60 * 60 * 1000);
  served['/tagtypes/01.json'] = {};
  const afterBad = await makeStore().get(1);
  checks.push(['an answer that is not a tag type is not cached', afterBad.version === 2
    && JSON.parse(fs.readFileSync(cachedFile, 'utf8')).version === 2]);

  // A corrupt cache file is ignored rather than trusted
  fs.writeFileSync(cachedFile, '{"name": "half a fi');
  served['/tagtypes/01.json'] = DEF(3);
  const afterCorrupt = await makeStore().get(1);
  checks.push(['a corrupt cache file is replaced from the AP', afterCorrupt.version === 3]);

  // Unreachable AP, nothing cached: the bundled copy
  fs.writeFileSync(path.join(bundledDir, '02.json'), JSON.stringify(DEF(9)));
  gateway = '127.0.0.1:1';
  const retrying = makeStore({ retryMs: 50 });
  const bundled = await retrying.get(2);
  checks.push(['with the AP unreachable the bundled copy is used', bundled && bundled.version === 9]);

  // ...and the AP is asked again soon, not in a week
  gateway = `127.0.0.1:${ap.address().port}`;
  served['/tagtypes/02.json'] = DEF(10);
  const soon = await retrying.get(2);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const later = await retrying.get(2);
  checks.push(['after a fallback the AP is asked again soon', soon.version === 9 && later.version === 10]);

  // Real definitions without a size or colour table are still definitions
  served['/tagtypes/F0.json'] = {
    version: 1, name: 'No display', width: 0, height: 0, bpp: 1,
  };
  const noDisplay = await makeStore().get(0xF0);
  checks.push(['a tag type with no display is accepted', noDisplay && noDisplay.name === 'No display']);

  // No definition anywhere
  const nothing = await makeStore().get(0x77);
  checks.push(['an unknown type with no fallback gives null', nothing === null]);

  // Every definition shipped with the app passes the check
  const shipped = path.join(__dirname, '..', 'assets', 'tagtypes');
  const shippedStore = new TagTypeStore({
    cacheDir: path.join(root, 'none'), bundledDir: shipped, getGateway: () => null,
  });
  const rejected = fs.readdirSync(shipped).filter((f) => !shippedStore.readFile(path.join(shipped, f)));
  checks.push(['every bundled definition is accepted', rejected.length === 0]);
  if (rejected.length) console.log('rejected:', rejected.join(', '));

  ap.close();
  fs.rmSync(root, { recursive: true, force: true });

  let failures = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures++;
  }
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
