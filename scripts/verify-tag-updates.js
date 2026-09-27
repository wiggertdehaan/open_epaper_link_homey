'use strict';

/* eslint-disable no-console */
/**
 * Covers how tag updates from the websocket are processed: one at a time per
 * tag with only the newest kept, image decodes limited across all tags,
 * button presses reported once and never replayed after a restart, and state
 * that must survive a restart kept outside memory.
 *
 * Run: node scripts/verify-tag-updates.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
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

const TagManager = require('../tagManager');
const APManager = require('../apManager');
const TagDevice = require('../lib/TagDevice');
const MyApp = require('../app');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowSeconds = () => Math.floor(Date.now() / 1000);

function makeDevice(id, extra = {}) {
  return {
    triggered: [],
    getData: () => ({ id }),
    ...extra,
  };
}

function driversWith(...devices) {
  return { tag: { getDevices: () => Object.fromEntries(devices.map((d, i) => [`d${i}`, d])) } };
}

function makeManager(apNow) {
  const fired = [];
  const manager = new TagManager({
    log: () => {},
    getGateway: () => '127.0.0.1',
    apNow,
    buttonPressedTrigger: {
      trigger: async (device, tokens) => {
        fired.push({ device, button: tokens.button });
      },
    },
  });
  return { manager, fired };
}

(async () => {
  const checks = [];

  // 1. One tag, a burst of updates: never two at once, and only the newest
  //    of those that arrived while one was running.
  {
    const { manager } = makeManager();
    const device = makeDevice('AABBCCDDEEFF0001');
    const processed = [];
    let running = 0;
    let maxRunning = 0;
    manager.processTagUpdate = async (d, tag) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await wait(30);
      processed.push(tag.lastseen);
      running--;
    };
    const drivers = driversWith(device);
    for (let i = 1; i <= 5; i++) {
      manager.updateTags([{ mac: 'AABBCCDDEEFF0001', lastseen: i }], drivers, async () => null);
    }
    await manager.idle();
    console.log(`five updates for one tag, processed: ${processed.join(', ')}`);
    checks.push(['updates for one tag never overlap', maxRunning === 1]);
    checks.push(['only the first and the newest are processed', processed.join(',') === '1,5']);
  }

  // 2. Many tags at once: decodes are limited across all of them.
  {
    const { manager } = makeManager();
    const devices = [];
    for (let i = 0; i < 8; i++) {
      devices.push(makeDevice(`AABBCCDDEEFF000${i}`, {
        getSettings: () => ({}),
        setCapabilityValue: async () => {},
        setSettings: async () => {},
        getScreenshotPath: () => '/nonexistent/scr.png',
      }));
    }
    let rendering = 0;
    let maxRendering = 0;
    manager.renderTagImage = async () => {
      rendering++;
      maxRendering = Math.max(maxRendering, rendering);
      await wait(20);
      rendering--;
    };
    const tags = devices.map((d) => ({ mac: d.getData().id, hash: 'ab', lastseen: 1 }));
    await manager.updateTags(tags, driversWith(...devices), async () => ({ width: 1, height: 1, bpp: 1 }));
    await manager.idle();
    console.log(`eight tags at once, at most ${maxRendering} decoding together`);
    checks.push(['image decodes are limited across tags', maxRendering === TagManager.RENDER_CONCURRENCY]);
  }

  // 3. Button presses
  {
    const apOffset = 3600 * 1000; // the AP's clock an hour behind Homey's
    const apNow = () => Date.now() - apOffset;
    const apSeconds = () => Math.floor(apNow() / 1000);
    const { manager, fired } = makeManager(apNow);
    manager.processTagUpdate = async () => {};
    const device = makeDevice('AABBCCDDEEFF0001');
    const drivers = driversWith(device);

    // What the AP announces on connect: an old press.
    const old = { mac: 'AABBCCDDEEFF0001', wakeupReason: 4, lastseen: apSeconds() - 600 };
    await manager.updateTags([old], drivers, async () => null);
    checks.push(['an old press re-announced after a restart does not fire', fired.length === 0]);

    const press = { mac: 'AABBCCDDEEFF0001', wakeupReason: 5, lastseen: apSeconds() };
    await manager.updateTags([press], drivers, async () => null);
    await manager.updateTags([press], drivers, async () => null);
    await wait(10);
    checks.push(['a new press fires once', fired.length === 1 && fired[0].button === 2]);

    // Same thing, but the first thing seen after a restart is a fresh press,
    // timestamped on an AP clock an hour behind.
    const { manager: fresh, fired: freshFired } = makeManager(apNow);
    fresh.processTagUpdate = async () => {};
    await fresh.updateTags([{ mac: 'AABBCCDDEEFF0001', wakeupReason: 6, lastseen: apSeconds() - 5 }], drivers, async () => null);
    await wait(10);
    checks.push(['a fresh press is reported even as the first sighting, on the AP clock',
      freshFired.length === 1 && freshFired[0].button === 3]);

    // A tag paired twice, from older versions, fires for both devices.
    const { manager: twice, fired: twiceFired } = makeManager(apNow);
    twice.processTagUpdate = async () => {};
    const a = makeDevice('AABBCCDDEEFF0002');
    const b = makeDevice('aabbccddeeff0002'); // lower case, as an old pairing may have stored it
    await twice.updateTags([{ mac: 'AABBCCDDEEFF0002', wakeupReason: 4, lastseen: apSeconds() }], driversWith(a, b), async () => null);
    await wait(10);
    checks.push(['a MAC matches whatever its case', twiceFired.length === 2]);
  }

  // 4. Updates wait for the device to be ready.
  {
    const { manager } = makeManager();
    let ready = false;
    let processedBeforeReady = false;
    const device = makeDevice('AABBCCDDEEFF0001', {
      ready: () => wait(50).then(() => {
        ready = true;
      }),
      getSettings: () => {
        if (!ready) processedBeforeReady = true;
        return { renderImage: false };
      },
      setCapabilityValue: async () => {},
      setSettings: async () => {},
    });
    await manager.updateTags([{ mac: 'AABBCCDDEEFF0001', temperature: 20, lastseen: 1 }],
      driversWith(device), async () => null);
    await manager.idle();
    checks.push(['an update waits for its device to be ready', ready && !processedBeforeReady]);
  }

  // 5. The AP's clock, from the `sys` frame
  {
    const manager = new APManager({ log: () => {}, homey: { drivers: { getDriver: () => null } } });
    manager.updateAPs({ currtime: nowSeconds() - 7200 });
    const behind = Math.round((Date.now() - manager.apNow()) / 1000);
    manager.updateAPs({ currtime: 'rubbish' });
    const kept = Math.round((Date.now() - manager.apNow()) / 1000);
    checks.push(['the AP clock offset comes from currtime', Math.abs(behind - 7200) <= 1]);
    checks.push(['a frame without a usable currtime changes nothing', kept === behind]);
  }

  // 6. The timeout trigger survives a restart without firing twice.
  {
    const store = {};
    const fired = [];
    const device = {
      getStoreValue: (key) => store[key],
      setStoreValue: async (key, value) => {
        store[key] = value;
      },
    };
    const makeApp = () => {
      const app = Object.create(MyApp.prototype);
      app.log = () => {};
      app.tagTimeoutTrigger = {
        trigger: async (d, tokens) => {
          fired.push(tokens);
        },
      };
      return app;
    };
    const now = Date.now();
    const late = { mac: 'AA', lastseen: Math.floor(now / 1000) - 7200, nextcheckin: Math.floor(now / 1000) - 3600 };
    const back = { mac: 'AA', lastseen: Math.floor(now / 1000), nextcheckin: Math.floor(now / 1000) + 600 };

    await makeApp().applyTagTimeout(device, late, now);
    await makeApp().applyTagTimeout(device, late, now); // after a restart
    const afterRestart = fired.length;
    await makeApp().applyTagTimeout(device, back, now);
    await makeApp().applyTagTimeout(device, late, now);
    checks.push(['a timed-out tag fires once, also across a restart', afterRestart === 1]);
    checks.push(['and again after it came back and went quiet again', fired.length === 2]);
  }

  // 7. The camera Image is registered once, however many updates race for it.
  {
    let created = 0;
    let unregistered = 0;
    const device = Object.create(TagDevice.prototype);
    device.getData = () => ({ id: 'AABBCCDDEEFF0001' });
    device.log = () => {};
    device.error = () => {};
    device.setCameraImage = async () => wait(20);
    device.homey = {
      images: {
        createImage: async () => {
          created++;
          await wait(20);
          return {
            setPath() {},
            update: async () => {},
            unregister: async () => {
              unregistered++;
            },
          };
        },
      },
      drivers: { getDrivers: () => ({}) },
    };
    await Promise.all([1, 2, 3, 4].map(() => device.updateCameraImage('/tmp/x.png')));
    checks.push(['concurrent updates register one camera Image', created === 1]);

    // A second device showing the same tag keeps the screenshot on delete.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oepl-shared-'));
    const shot = path.join(dir, 'scr_AABBCCDDEEFF0001.png');
    fs.writeFileSync(shot, 'png');
    device.getScreenshotPath = () => shot;
    const twin = { getData: () => ({ id: 'AABBCCDDEEFF0001' }) };
    device.homey.drivers.getDrivers = () => driversWith(device, twin);
    await device.onDeleted();
    checks.push(['deleting one of two devices for a tag keeps the screenshot', fs.existsSync(shot)]);
    checks.push(['and unregisters its camera Image', unregistered === 1]);

    const alone = Object.create(TagDevice.prototype);
    alone.getData = () => ({ id: 'AABBCCDDEEFF0001' });
    alone.log = () => {};
    alone.getScreenshotPath = () => shot;
    alone.homey = { drivers: { getDrivers: () => driversWith(alone) } };
    await alone.onDeleted();
    checks.push(['deleting the only device for a tag removes it', !fs.existsSync(shot)]);
    fs.rmSync(dir, { recursive: true, force: true });
  }

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
