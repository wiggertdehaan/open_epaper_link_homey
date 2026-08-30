/* eslint-disable no-console */
/**
 * Runs the generic tag driver's pairing list against the live AP, without
 * deploying, by stubbing the `homey` runtime module.
 *
 * Checks the three things that matter: that every tag the AP knows shows up
 * with something recognisable, that tags already paired are filtered out, and
 * that the hwType is derived rather than chosen.
 *
 * Usage: node scripts/verify-pairing.js [ap-ip]
 */

const Module = require('module');
const path = require('path');

const AP = process.argv[2] || '192.168.111.179';

// MACs currently paired on the Homey, spread across the old per-model drivers.
const PAIRED = {
  'm2-29-uc8151': ['0000018143733B30', '000001814DDE3B39'],
  'solum-29': ['ABCD000000000113', 'ABCD000000000031', 'ABCD00000000010A', 'ABCD0000000000B3'],
  'tlsr-bwr-4-2-63': ['F5CFC7CA1332EB41', '1337C7CA1332EB41', 'F5CACAC83E325D41'],
  'newton-m3-29': ['000004F16309B296'],
};

// --- stub the runtime module the driver imports ---------------------------
const realLoad = Module._load;
Module._load = function stubbed(request, parent, isMain) {
  if (request === 'homey') {
    return { Driver: class Driver { log(...a) { console.log('   [driver]', ...a); } } };
  }
  return realLoad.call(this, request, parent, isMain);
};

const TagDriver = require(path.join(__dirname, '..', 'drivers', 'tag', 'driver.js'));

Module._load = realLoad;

// --- a minimal stand-in for the Homey object ------------------------------
function makeHomey({ gateway }) {
  const drivers = {};
  for (const [id, macs] of Object.entries(PAIRED)) {
    drivers[id] = {
      getDevices: () => Object.fromEntries(
        macs.map((mac, i) => [`d${i}`, { getData: () => ({ id: mac }) }]),
      ),
    };
  }
  return {
    settings: { get: (k) => (k === 'gateway' ? gateway : undefined) },
    drivers: { getDrivers: () => drivers },
    __: (key, tokens) => `${key}${tokens ? ` ${JSON.stringify(tokens)}` : ''}`,
    app: {
      tagTypeCache: {},
      async getTagTypeData(hw) {
        const axios = require(path.join(__dirname, '..', 'node_modules', 'axios'));
        const hex = Number(hw).toString(16).padStart(2, '0').toUpperCase();
        try {
          const r = await axios.get(`http://${gateway}/tagtypes/${hex}.json`, { timeout: 10000 });
          return r.data;
        } catch (e) { return null; }
      },
    },
  };
}

(async () => {
  let failures = 0;
  const check = (label, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures++;
  };

  // --- happy path -------------------------------------------------------
  console.log(`\n=== pairing list against ${AP} ===`);
  const driver = new TagDriver();
  driver.homey = makeHomey({ gateway: AP });

  const devices = await driver.onPairListDevices();
  console.log('');
  for (const d of devices) {
    console.log(`  ${d.name}`);
    console.log(`      ${d.description}`);
    console.log(`      data=${JSON.stringify(d.data)} store=${JSON.stringify(d.store)}`);
  }

  const allPaired = Object.values(PAIRED).flat().map((m) => m.toUpperCase());
  const listed = devices.map((d) => String(d.data.id).toUpperCase());

  console.log('');
  check('returned at least one tag', devices.length > 0);
  check('no already-paired tag is offered',
    !listed.some((m) => allPaired.includes(m)));
  check('every entry has a hwType derived from the AP',
    devices.every((d) => Number.isInteger(d.store.hwType)));
  check('every entry has a resolved model name',
    devices.every((d) => typeof d.store.model === 'string' && d.store.model.length > 0));
  check('every entry has a non-empty name',
    devices.every((d) => typeof d.name === 'string' && d.name.trim().length > 0));
  check('every entry carries the MAC as data.id',
    devices.every((d) => /^[0-9A-Fa-f]{16}$/.test(d.data.id)));
  check('MACAddress setting is prefilled',
    devices.every((d) => d.settings.MACAddress === d.data.id));
  check('names are unique',
    new Set(devices.map((d) => d.name)).size === devices.length);
  check('both tags Jonas wants are offered',
    ['000004F01C38B29D', '00007E1FB84FB29F']
      .every((m) => listed.includes(m)));

  // --- gateway not configured ------------------------------------------
  console.log('\n=== gateway unset ===');
  const noGw = new TagDriver();
  noGw.homey = makeHomey({ gateway: null });
  let msg = null;
  try { await noGw.onPairListDevices(); } catch (e) { msg = e.message; }
  console.log('  ->', msg);
  check('unset gateway raises a readable error', Boolean(msg) && msg.includes('noGateway'));

  // --- AP unreachable ---------------------------------------------------
  console.log('\n=== AP unreachable ===');
  const bad = new TagDriver();
  bad.homey = makeHomey({ gateway: '192.0.2.1' });
  msg = null;
  try { await bad.onPairListDevices(); } catch (e) { msg = e.message; }
  console.log('  ->', msg);
  check('unreachable AP raises a readable error', Boolean(msg) && msg.includes('unreachable'));

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
