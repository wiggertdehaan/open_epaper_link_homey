'use strict';

/* eslint-disable no-console */
/**
 * Covers the per-device settings applied in TagManager.processTagUpdate:
 * the temperature offset, the switch that turns image rendering off, and the
 * read-only Last seen label.
 *
 * Run: node scripts/verify-device-settings.js
 */

const Module = require('module');

const realLoad = Module._load;
Module._load = function stubbed(request) {
  if (request === 'homey') return { Device: class {}, Driver: class {} };
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const TagManager = require('../tagManager');

const TAG_TYPE = {
  name: 'Test', width: 296, height: 128, bpp: 2, options: [],
};

function makeDevice(settings) {
  return {
    settings: { ...settings },
    capabilities: {},
    settingWrites: 0,
    getSettings() {
      return this.settings;
    },
    async setSettings(values) {
      this.settingWrites++; Object.assign(this.settings, values);
    },
    setCapabilityValue(cap, value) {
      this.capabilities[cap] = value; return Promise.resolve();
    },
    hasCapability() {
      return false;
    },
    async addCapability() {},
    async removeCapability() {},
    getScreenshotPath() {
      return '/tmp/never-written.png';
    },
    async updateCameraImage() {},
  };
}

function makeManager() {
  const m = Object.create(TagManager.prototype);
  m.homey = { log: () => {} };
  m.lastRendered = new Map();
  m.lastWakeup = new Map();
  m.renders = 0;
  m.UpdateTagImage = async () => {
    m.renders++;
  };
  return m;
}

const tag = (over = {}) => ({
  mac: 'AABBCCDDEEFF0001',
  hwType: 1,
  temperature: 21,
  batteryMv: 2900,
  lastseen: 1788291029,
  hash: 'abc',
  ...over,
});

(async () => {
  const checks = [];

  // Offset
  const m1 = makeManager();
  const d1 = makeDevice({ temperatureOffset: -2.5, renderImage: true });
  await m1.processTagUpdate(d1, tag(), TAG_TYPE);
  checks.push(['offset is applied to the reading', d1.capabilities.measure_temperature === 18.5]);

  const m2 = makeManager();
  const d2 = makeDevice({ renderImage: true });
  await m2.processTagUpdate(d2, tag(), TAG_TYPE);
  checks.push(['no offset set leaves the reading alone', d2.capabilities.measure_temperature === 21]);

  const m3 = makeManager();
  const d3 = makeDevice({ temperatureOffset: 'nonsense', renderImage: true });
  await m3.processTagUpdate(d3, tag(), TAG_TYPE);
  checks.push(['an unusable offset is ignored, not NaN', d3.capabilities.measure_temperature === 21]);

  // Render switch
  const m4 = makeManager();
  const d4 = makeDevice({ renderImage: false });
  await m4.processTagUpdate(d4, tag(), TAG_TYPE);
  checks.push(['renderImage false skips the image pipeline', m4.renders === 0]);
  checks.push(['renderImage false still updates the sensors', d4.capabilities.measure_voltage === 2.9]);

  const m5 = makeManager();
  const d5 = makeDevice({});
  await m5.processTagUpdate(d5, tag(), TAG_TYPE);
  checks.push(['rendering is on when the setting is absent', m5.renders === 1]);

  // Last seen, and not writing settings for nothing
  const m6 = makeManager();
  const d6 = makeDevice({ renderImage: true });
  await m6.processTagUpdate(d6, tag(), TAG_TYPE);
  const firstWrites = d6.settingWrites;
  const seen = d6.settings.lastSeen;
  await m6.processTagUpdate(d6, tag(), TAG_TYPE);
  const repeatWrites = d6.settingWrites;
  await m6.processTagUpdate(d6, tag({ lastseen: 1788291500 }), TAG_TYPE);
  const changedWrites = d6.settingWrites;

  checks.push(['MAC address is stored', d6.settings.MACAddress === 'AABBCCDDEEFF0001']);
  checks.push(['last seen is filled in and readable', typeof seen === 'string' && seen !== '-' && seen.length > 8]);
  checks.push(['the first update writes settings', firstWrites === 1]);
  checks.push(['an identical update writes nothing', repeatWrites === 1]);
  checks.push(['a newer check-in writes again', changedWrites === 2]);

  const m7 = makeManager();
  const d7 = makeDevice({});
  await m7.processTagUpdate(d7, tag({ lastseen: 0 }), TAG_TYPE);
  checks.push(['a tag never seen shows a dash', d7.settings.lastSeen === '-']);

  console.log(`temperature 21 with offset -2.5 -> ${d1.capabilities.measure_temperature}`);
  console.log(`last seen rendered as           -> ${seen}`);
  console.log('');

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
