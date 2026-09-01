'use strict';

/* eslint-disable no-console */
/**
 * Proves the app survives a gateway that is missing, unreachable, or simply
 * not an OpenEPaperLink AP.
 *
 * This is the shape of issue #4. An AP is a small device on a home network: it
 * gets unplugged, changes address, or the user types the address of something
 * else entirely. None of that may take the app down, because a crashed app
 * stops running every flow the user built on it.
 *
 * The rule this checks: lib/apClient throws, deliberately, because a caller
 * pairing a device needs to tell the user why the list is empty. Every other
 * caller must catch.
 *
 * Run: node scripts/verify-gateway-errors.js [address-of-something-not-an-AP]
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const realLoad = Module._load;
Module._load = function stubbed(request) {
  if (request === 'homey') return { Device: class {}, Driver: class {}, App: class {} };
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const { fetchAllTags } = require('../lib/apClient');
const TagManager = require('../tagManager');

// Reserved for documentation and never routable, so this cannot hit a real
// device on someone's network.
const UNREACHABLE = '192.0.2.1';
const WRONG_DEVICE = process.argv[2] || null;

const homeyStub = (gateway) => ({
  settings: { get: (key) => (key === 'gateway' ? gateway : undefined) },
  log: () => {},
  error: () => {},
});

async function driverFetchSurvives(gateway) {
  // The per-model drivers all share this shape.
  const DriverClass = require('../drivers/solum-29/driver');
  const driver = Object.create(DriverClass.prototype);
  driver.homey = homeyStub(gateway);
  return driver.fetchTags();
}

(async () => {
  const checks = [];

  // 1. apClient itself is allowed - required - to throw.
  for (const [label, gateway] of [['no gateway', null], ['unreachable', UNREACHABLE]]) {
    let threw = false;
    try {
      await fetchAllTags(gateway, { timeout: 3000 });
    } catch (error) {
      threw = true;
    }
    checks.push([`apClient reports ${label} by throwing`, threw]);
  }

  // 2. A pairing driver must turn that into an empty list, never a crash.
  for (const [label, gateway] of [['no gateway', null], ['an unreachable AP', UNREACHABLE]]) {
    let result;
    let threw = false;
    try {
      result = await driverFetchSurvives(gateway);
    } catch (error) {
      threw = true;
    }
    checks.push([`a driver survives ${label}`, !threw && Array.isArray(result) && result.length === 0]);
  }

  // 3. The generic driver must explain itself rather than show an empty list.
  const TagDriver = require('../drivers/tag/driver');
  const translations = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8'));
  const tagDriver = Object.create(TagDriver.prototype);
  tagDriver.log = () => {};
  tagDriver.homey = {
    ...homeyStub(UNREACHABLE),
    drivers: { getDrivers: () => ({}) },
    app: {},
    __: (key, tokens = {}) => {
      const value = key.split('.').reduce((o, k) => (o || {})[k], translations);
      return value ? value.replace(/__(\w+)__/g, (_, t) => tokens[t]) : key;
    },
  };

  let message = '';
  try {
    await tagDriver.onPairListDevices();
  } catch (error) {
    message = error.message;
  }
  checks.push(['the generic driver explains an unreachable AP', message.includes(UNREACHABLE) && message.length > 40]);

  tagDriver.homey.settings.get = () => null;
  let noGatewayMessage = '';
  try {
    await tagDriver.onPairListDevices();
  } catch (error) {
    noGatewayMessage = error.message;
  }
  checks.push(['the generic driver explains a missing address', /settings/i.test(noGatewayMessage)]);

  // 4. Downloading an image from a dead AP yields null, not an exception.
  const manager = Object.create(TagManager.prototype);
  manager.homey = { log: () => {} };
  manager.gateway = UNREACHABLE;
  manager.lastRendered = new Map();
  manager.lastWakeup = new Map();

  let raw = 'unset';
  let rawThrew = false;
  try {
    raw = await manager.downloadRawImage({ mac: 'AABBCCDDEEFF0001', hash: 'x' });
  } catch (error) {
    rawThrew = true;
  }
  checks.push(['downloadRawImage returns null instead of throwing', !rawThrew && raw === null]);

  // 5. A tag update with no tag type must not crash on tagType.width.
  const device = {
    getSettings: () => ({}),
    setCapabilityValue: () => Promise.resolve(),
    hasCapability: () => false,
    getScreenshotPath: () => path.join(require('os').tmpdir(), 'never.png'),
    updateCameraImage: async () => {},
    setSettings: async () => {},
  };
  let updateThrew = false;
  try {
    await manager.processTagUpdate(device, {
      mac: 'AABBCCDDEEFF0001', temperature: 20, batteryMv: 2900, lastseen: 1, hash: 'x',
    }, null);
  } catch (error) {
    updateThrew = true;
  }
  checks.push(['a tag update with no tag type does not throw', !updateThrew]);

  // 6. Optional: an address that answers HTTP but is not an AP.
  if (WRONG_DEVICE) {
    let wrongResult;
    let wrongThrew = false;
    try {
      wrongResult = await driverFetchSurvives(WRONG_DEVICE);
    } catch (error) {
      wrongThrew = true;
    }
    checks.push([`a driver survives ${WRONG_DEVICE} not being an AP`,
      !wrongThrew && Array.isArray(wrongResult) && wrongResult.length === 0]);
  }

  let failures = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures++;
  }
  if (!WRONG_DEVICE) {
    console.log('\n(pass the address of a non-AP web server as an argument to also cover that case)');
  }
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
