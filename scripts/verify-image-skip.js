'use strict';

/* eslint-disable no-console */
/**
 * Proves that an unchanged framebuffer is not downloaded and decoded again.
 *
 * The AP re-announces every tag it knows whenever the websocket reconnects,
 * which it does on its own every minute or two. Each re-announcement used to
 * redo the whole image pipeline for a picture that had not changed: an HTTP
 * download of the framebuffer, a decode that takes seconds on a Homey, a PNG
 * write and a Homey Image update. That is the load behind issues #31 and #43.
 *
 * Run: node scripts/verify-image-skip.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// 'homey' only exists inside the Homey runtime.
const realLoad = Module._load;
Module._load = function stubbed(request) {
  if (request === 'homey') return { Device: class {}, Driver: class {} };
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const TagManager = require('../tagManager');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oepl-skip-'));
const screenshot = path.join(dir, 'scr_AABBCCDDEEFF0001.png');

const TAG_TYPE = {
  name: 'Test 2.9"',
  width: 296,
  height: 128,
  bpp: 2,
  rotatebuffer: 0,
  colortable: { white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0] },
};

// A bare two-plane framebuffer of the right length, so the real decoder runs.
const FRAME = Buffer.alloc(Math.ceil((296 * 128) / 8) * 2);

let downloads = 0;
let cameraUpdates = 0;

const device = {
  getScreenshotPath: () => screenshot,
  updateCameraImage: async () => {
    cameraUpdates++;
  },
};

const manager = Object.create(TagManager.prototype);
manager.homey = { log: () => {} };
manager.gateway = '127.0.0.1';
manager.lastRendered = new Map();
manager.downloadRawImage = async () => {
  downloads++; return FRAME;
};

const tagAt = (hash) => ({ mac: 'AABBCCDDEEFF0001', hwType: 1, hash });

(async () => {
  const HASH = '50f4acba60e8dd940000000000000000';

  await manager.UpdateTagImage(device, tagAt(HASH), TAG_TYPE);
  const afterFirst = { downloads, cameraUpdates, file: fs.existsSync(screenshot) };

  // Same hash, as an AP re-announcement after a reconnect sends it.
  await manager.UpdateTagImage(device, tagAt(HASH), TAG_TYPE);
  const afterRepeat = { downloads, cameraUpdates };

  // A new hash means the tag really did change.
  await manager.UpdateTagImage(device, tagAt('ffffffffffffffff0000000000000000'), TAG_TYPE);
  const afterChange = { downloads, cameraUpdates };

  // The all-zero hash carries no information, so it must never be cached.
  await manager.UpdateTagImage(device, tagAt('00000000000000000000000000000000'), TAG_TYPE);
  await manager.UpdateTagImage(device, tagAt('00000000000000000000000000000000'), TAG_TYPE);
  const afterZero = { downloads, cameraUpdates };

  // A screenshot that has gone missing must be rendered again even on a hit.
  fs.unlinkSync(screenshot);
  await manager.UpdateTagImage(device, tagAt('00000000000000000000000000000000'), TAG_TYPE);
  manager.lastRendered.set('AABBCCDDEEFF0001', HASH);
  fs.unlinkSync(screenshot);
  await manager.UpdateTagImage(device, tagAt(HASH), TAG_TYPE);
  const afterMissing = { downloads };

  console.log(`first render        downloads=${afterFirst.downloads} camera=${afterFirst.cameraUpdates} file=${afterFirst.file}`);
  console.log(`same hash again     downloads=${afterRepeat.downloads} camera=${afterRepeat.cameraUpdates}`);
  console.log(`changed hash        downloads=${afterChange.downloads} camera=${afterChange.cameraUpdates}`);
  console.log(`zero hash twice     downloads=${afterZero.downloads} camera=${afterZero.cameraUpdates}`);
  console.log(`missing screenshot  downloads=${afterMissing.downloads}`);
  console.log('');

  const checks = [
    ['first update renders', afterFirst.downloads === 1 && afterFirst.cameraUpdates === 1],
    ['first update writes the screenshot', afterFirst.file],
    ['same hash downloads nothing', afterRepeat.downloads === 1],
    ['same hash does not touch the camera image', afterRepeat.cameraUpdates === 1],
    ['a changed hash renders again', afterChange.downloads === 2 && afterChange.cameraUpdates === 2],
    ['an all-zero hash is never cached', afterZero.downloads === 4],
    ['a missing screenshot is rendered again', afterMissing.downloads === 6],
  ];

  let failures = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures++;
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
