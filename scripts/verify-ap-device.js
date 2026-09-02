'use strict';

/* eslint-disable no-console */
/**
 * Covers the access point device: what pairing offers, and how a `sys` frame
 * from the websocket maps onto capabilities.
 *
 * Pass an AP address to also pair against a real one:
 *   node scripts/verify-ap-device.js 192.168.0.16
 */

const Module = require('module');

const realLoad = Module._load;
Module._load = function stubbed(request) {
  if (request === 'homey') {
    return { Device: class {}, Driver: class {} };
  }
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const ApDevice = require('../drivers/ap/device');
const ApDriver = require('../drivers/ap/driver');
const APManager = require('../apManager');

// A real frame, captured from an AP over the websocket.
const SYS = {
  currtime: 1788350223,
  heap: 192092,
  recordcount: 4,
  dbsize: 880,
  littlefsfree: 6144000,
  psfree: 8348147,
  apstate: 1,
  runstate: 2,
  rssi: -72,
  wifistatus: 3,
  wifissid: 'SBW',
  uptime: 36044,
};

function makeDevice(settings = {}) {
  const device = Object.create(ApDevice.prototype);
  device.capabilities = {};
  device.settings = { ...settings };
  device.settingWrites = 0;
  device.log = () => {};
  device.error = () => {};
  device.getSettings = () => device.settings;
  device.setSettings = async (values) => {
    device.settingWrites++;
    Object.assign(device.settings, values);
  };
  device.setCapabilityValue = async (cap, value) => {
    device.capabilities[cap] = value;
  };
  return device;
}

(async () => {
  const checks = [];

  // A sys frame becomes capability values.
  const device = makeDevice();
  await device.applySysFrame(SYS);

  checks.push(['Wi-Fi signal comes through as dBm', device.capabilities.measure_signal_strength === -72]);
  checks.push(['tag count comes through', device.capabilities.oepl_ap_tags === 4]);
  checks.push(['uptime is converted to hours', device.capabilities.oepl_ap_uptime === 10]);
  checks.push(['free heap is converted to kB', device.capabilities.oepl_ap_heap === 188]);
  checks.push(['the Wi-Fi network lands in settings', device.settings.wifiSsid === 'SBW']);

  // Repeating the same frame must not rewrite settings.
  const writesAfterFirst = device.settingWrites;
  await device.applySysFrame(SYS);
  checks.push(['an identical frame writes no settings', device.settingWrites === writesAfterFirst]);

  // Partial and malformed frames must not throw or write rubbish.
  const partial = makeDevice();
  await partial.applySysFrame({ rssi: -50 });
  checks.push(['a partial frame sets only what it carries',
    partial.capabilities.measure_signal_strength === -50
    && partial.capabilities.oepl_ap_tags === undefined]);

  const junk = makeDevice();
  let threw = false;
  try {
    await junk.applySysFrame(null);
    await junk.applySysFrame('nonsense');
    await junk.applySysFrame({ rssi: 'loud', uptime: null, heap: undefined });
  } catch {
    threw = true;
  }
  checks.push(['a malformed frame does not throw', !threw]);
  checks.push(['a malformed frame sets nothing', Object.keys(junk.capabilities).length === 0]);

  // APManager stays quiet when no AP is paired.
  const manager = Object.create(APManager.prototype);
  manager.homey = {
    log: () => {},
    homey: {
      drivers: {
        getDriver: () => {
          throw new Error('not ready');
        },
      },
    },
  };
  let managerThrew = false;
  try {
    manager.updateAPs(SYS);
  } catch {
    managerThrew = true;
  }
  checks.push(['APManager survives the driver not being ready', !managerThrew]);

  const paired = makeDevice();
  manager.homey.homey.drivers.getDriver = () => ({ getDevices: () => ({ a: paired }) });
  manager.updateAPs(SYS);
  await new Promise((resolve) => setTimeout(resolve, 50));
  checks.push(['APManager feeds a paired AP device', paired.capabilities.oepl_ap_tags === 4]);

  // Pairing refuses a second access point.
  const driver = Object.create(ApDriver.prototype);
  driver.log = () => {};
  driver.getDevices = () => ({ existing: {} });
  driver.homey = { __: (key) => key, settings: { get: () => null } };
  let refusal = '';
  try {
    await driver.onPairListDevices();
  } catch (error) {
    refusal = error.message;
  }
  checks.push(['a second access point is refused', refusal === 'pair.apAlreadyAdded']);

  // Optional: pair against a real AP.
  const address = process.argv[2];
  if (address) {
    const live = Object.create(ApDriver.prototype);
    live.log = (...a) => console.log('  [driver]', ...a);
    live.getDevices = () => ({});
    live.homey = {
      __: (key) => key,
      settings: { get: (k) => (k === 'gateway' ? address : undefined) },
      cloud: { getLocalAddress: async () => address },
    };
    const devices = await live.onPairListDevices();
    console.log('\npairing would offer:');
    for (const d of devices) {
      console.log(`  ${d.name}`);
      console.log(`    data.id  ${d.data.id}`);
      console.log(`    settings ${JSON.stringify(d.settings)}`);
    }
    checks.push(['a real AP is offered for pairing', devices.length === 1 && devices[0].data.id === 'ap']);
    checks.push(['its firmware is filled in', /\d/.test(devices[0].settings.firmware)]);
  }

  console.log('');
  let failures = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures++;
  }
  if (!address) console.log('\n(pass an AP address as an argument to also pair against a real one)');
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
