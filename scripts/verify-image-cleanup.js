'use strict';

/* eslint-disable no-console */
/**
 * Exercises lib/imageStore.js against real files in a temporary directory.
 *
 * The point is to prove the safety rules hold, because this code deletes
 * things: a screenshot owned by a paired device must survive, a freshly
 * written file must survive, anything that is not one of our screenshots must
 * be left alone entirely, and a genuinely orphaned screenshot must go.
 *
 * Run: node scripts/verify-image-cleanup.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const imageStore = require('../lib/imageStore');

const HOUR = 60 * 60 * 1000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oepl-cleanup-'));

// A stand-in for the Homey object: two paired devices.
const homey = {
  drivers: {
    getDrivers: () => ({
      driverA: { getDevices: () => ({ d1: { getData: () => ({ id: 'AABBCCDDEEFF0001' }) } }) },
      driverB: { getDevices: () => ({ d2: { getData: () => ({ id: 'aabbccddeeff0002' }) } }) },
    }),
  },
};

function write(name, ageMs, contents = 'x') {
  const full = path.join(dir, name);
  fs.writeFileSync(full, contents);
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(full, when, when);
  return full;
}

// owned by a paired device, old -> must be kept
const ownedOld = write('scr_AABBCCDDEEFF0001.png', 30 * 24 * HOUR);
// owned, lower-case MAC on disk vs upper-case device id -> must be kept
const ownedCase = write('scr_aabbccddeeff0002.png', 30 * 24 * HOUR);
// orphaned and old -> must go
const orphanOld = write('scr_DEADBEEF00000001.png', 5 * 24 * HOUR, 'abcdefghij');
const orphanOld2 = write('scr_DEADBEEF00000002.png', 2 * HOUR, 'abcde');
// orphaned but written moments ago -> must be kept (an update may be in flight)
const orphanFresh = write('scr_DEADBEEF00000003.png', 60 * 1000);
// not one of ours -> must never be touched
const foreign = write('important-user-file.png', 10 * 24 * HOUR);
const foreign2 = write('scr_notamac.txt', 10 * 24 * HOUR);

const files = imageStore.listScreenshots([dir]);
console.log(`listScreenshots found ${files.length} screenshot(s) (expected 5)`);

// Point the module at our temp directory for the duration of the test.
const realDirs = imageStore.IMAGE_DIRS.slice();
imageStore.IMAGE_DIRS.length = 0;
imageStore.IMAGE_DIRS.push(dir);

const preview = imageStore.cleanup(homey, { dryRun: true });
console.log(`dry run: would delete ${preview.deleted}, keep ${preview.kept}`);

const result = imageStore.cleanup(homey);
console.log(`cleanup: deleted ${result.deleted}, kept ${result.kept}, failed ${result.failed}, bytes ${result.bytes}`);

imageStore.IMAGE_DIRS.length = 0;
realDirs.forEach((d) => imageStore.IMAGE_DIRS.push(d));

// Second phase: a sweep that finds no paired device must do nothing. An empty
// device list is ambiguous - no tags owned, or drivers still loading - and
// treating it as "everything is an orphan" would blank every tile. An explicit
// force, as sent by the settings page button, still sweeps.
const emptyHomey = {
  drivers: { getDrivers: () => ({ driverA: { getDevices: () => ({}) } }) },
};

const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oepl-cleanup-guard-'));
const guardOrphan = path.join(guardDir, 'scr_AABBCCDDEEFF0009.png');
fs.writeFileSync(guardOrphan, 'xxxxx');
const longAgo = new Date(Date.now() - 3 * HOUR);
fs.utimesSync(guardOrphan, longAgo, longAgo);

imageStore.IMAGE_DIRS.length = 0;
imageStore.IMAGE_DIRS.push(guardDir);

const guarded = imageStore.cleanup(emptyHomey);
const survivedGuard = fs.existsSync(guardOrphan);
const forced = imageStore.cleanup(emptyHomey, { force: true });

imageStore.IMAGE_DIRS.length = 0;
realDirs.forEach((d) => imageStore.IMAGE_DIRS.push(d));

console.log(`no paired devices: guarded deleted ${guarded.deleted}`
  + ` (${guarded.skipped || 'not skipped'}), forced deleted ${forced.deleted}`);

const checks = [
  ['owned + old screenshot kept', fs.existsSync(ownedOld)],
  ['owned (case-insensitive MAC) kept', fs.existsSync(ownedCase)],
  ['orphan older than an hour deleted', !fs.existsSync(orphanOld)],
  ['second old orphan deleted', !fs.existsSync(orphanOld2)],
  ['fresh orphan kept', fs.existsSync(orphanFresh)],
  ['unrelated file untouched', fs.existsSync(foreign)],
  ['non-png with our prefix untouched', fs.existsSync(foreign2)],
  ['dry run deleted nothing itself', preview.deleted === 2],
  ['cleanup deleted exactly the two orphans', result.deleted === 2],
  ['freed byte count is real', result.bytes === 15],
  ['no paired devices: sweep skipped', guarded.deleted === 0 && Boolean(guarded.skipped)],
  ['no paired devices: orphan survived the guarded sweep', survivedGuard],
  ['no paired devices: force still sweeps', forced.deleted === 1 && !fs.existsSync(guardOrphan)],
];

let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(guardDir, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
