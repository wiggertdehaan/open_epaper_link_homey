'use strict';

/**
 * Works out which drivers correspond to tag types that actually have an LED or
 * buttons, and prints the `driver_id=` filters for the flow cards that use them.
 *
 * A tag type's JSON on the access point carries an `options` array; the ones
 * that matter here are "led" and "button". Each legacy driver filters on a
 * single hwType in its driver.js, which is what ties a driver to a tag type.
 *
 * Run: node scripts/build-capability-filters.js <ap-host>
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const AP = process.argv[2];
const DRIVERS = path.join(__dirname, '..', 'drivers');
const { log } = console;

function get(p) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${AP}${p}`, { timeout: 20000 }, (r) => {
      const c = [];
      r.on('data', (x) => c.push(x));
      r.on('end', () => resolve(Buffer.concat(c)));
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

async function main() {
  if (!AP) {
    log('usage: node scripts/build-capability-filters.js <ap-host>');
    process.exitCode = 2;
    return;
  }

  const byDriver = {};
  for (const dir of fs.readdirSync(DRIVERS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const js = path.join(DRIVERS, dir.name, 'driver.js');
    if (!fs.existsSync(js)) continue;
    const match = fs.readFileSync(js, 'utf8').match(/hwType\s*===?\s*(\d+)/);
    if (match) byDriver[dir.name] = Number(match[1]);
  }
  log(`${Object.keys(byDriver).length} drivers tied to a hwType`);

  const options = {};
  for (const hw of [...new Set(Object.values(byDriver))].sort((a, b) => a - b)) {
    const hex = hw.toString(16).toUpperCase().padStart(2, '0');
    try {
      // eslint-disable-next-line no-await-in-loop
      const tt = JSON.parse((await get(`/tagtypes/${hex}.json`)).toString('utf8'));
      options[hw] = { name: tt.name, options: tt.options || [] };
    } catch (e) {
      options[hw] = { name: '(unreadable)', options: [] };
    }
  }

  for (const capability of ['led', 'button']) {
    const drivers = Object.entries(byDriver)
      .filter(([, hw]) => (options[hw].options || []).includes(capability))
      .map(([name]) => name)
      .sort();
    log(`\n${capability}: ${drivers.length} driver(s)`);
    log(`"filter": "driver_id=${drivers.join('|')}"`);
  }

  const unknown = Object.entries(options).filter(([, o]) => o.name === '(unreadable)');
  if (unknown.length) log(`\ntag types the AP could not describe: ${unknown.map(([hw]) => hw).join(', ')}`);
}

main().catch((e) => {
  log('ERR:', e.message);
  process.exitCode = 1;
});
