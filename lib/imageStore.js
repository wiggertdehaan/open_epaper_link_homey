'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Bookkeeping for the PNG screenshots the app writes for each tag's camera
 * image.
 *
 * History, because it explains what can be lying around:
 *
 *   - Every released version has written one file per tag, named
 *     `scr_<mac>.png`, into /tmp. The filename is keyed on the tag MAC and is
 *     overwritten on each update, so files never multiplied per update.
 *   - What did multiply was Homey Image objects: before the shared TagDevice
 *     base class, `homey.images.createImage()` was called on every websocket
 *     tag update and the previous Image was never unregistered. Those are
 *     registrations inside Homey, not files, and the Apps SDK gives an app no
 *     way to enumerate them (ManagerImages has getImage/createImage/
 *     unregisterImage but no list), so they cannot be swept up from here.
 *     They are released when the app restarts, and the leak itself is fixed.
 *   - Files do still linger in one case: a device removed while the app was
 *     not running never got its onDeleted hook, so its screenshot stays
 *     behind. Renamed or re-paired tags leave the same trace.
 *
 * So this module sweeps orphaned screenshot files: ones that are not owned by
 * any currently paired device.
 */

// Where screenshots are written. /tmp is where every version has put them;
// /userdata is the documented location for app data and is checked too so a
// sweep also finds anything left there.
const IMAGE_DIRS = ['/tmp', '/userdata'];

// Only ever consider files this app is responsible for.
const SCREENSHOT_RE = /^scr_([0-9A-Za-z]+)\.png$/;

// A file younger than this is never removed, so a screenshot being written
// right now cannot be swept away by a concurrent sweep.
const MIN_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Lists the app's screenshot files across the known directories.
 * @returns {Array<{dir:string,name:string,path:string,mac:string,size:number,mtimeMs:number}>}
 */
function listScreenshots(dirs = IMAGE_DIRS) {
  const found = [];
  for (const dir of dirs) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      continue; // directory not present in this environment
    }
    for (const name of names) {
      const match = SCREENSHOT_RE.exec(name);
      if (!match) continue;
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        found.push({
          dir, name, path: full, mac: match[1], size: stat.size, mtimeMs: stat.mtimeMs,
        });
      } catch (err) {
        // vanished between readdir and stat, ignore
      }
    }
  }
  return found;
}

/** MAC addresses of every currently paired device, upper-cased. */
function pairedMacs(homey) {
  const macs = new Set();
  const drivers = homey.drivers.getDrivers();
  for (const driverId of Object.keys(drivers)) {
    const devices = drivers[driverId].getDevices();
    for (const key of Object.keys(devices)) {
      const data = devices[key].getData();
      if (data && data.id) macs.add(String(data.id).toUpperCase());
    }
  }
  return macs;
}

/**
 * Describes what is on disk without changing anything.
 * @returns {{files:number,bytes:number,orphans:number,orphanBytes:number,byDir:object,paired:number}}
 */
function report(homey) {
  const files = listScreenshots();
  const keep = pairedMacs(homey);
  const now = Date.now();

  const byDir = {};
  let bytes = 0;
  let orphans = 0;
  let orphanBytes = 0;

  for (const f of files) {
    byDir[f.dir] = byDir[f.dir] || { files: 0, bytes: 0 };
    byDir[f.dir].files++;
    byDir[f.dir].bytes += f.size;
    bytes += f.size;
    if (!keep.has(f.mac.toUpperCase()) && now - f.mtimeMs >= MIN_AGE_MS) {
      orphans++;
      orphanBytes += f.size;
    }
  }

  return {
    files: files.length, bytes, orphans, orphanBytes, byDir, paired: keep.size,
  };
}

/**
 * Removes screenshots that no paired device owns.
 *
 * The rules, deliberately conservative:
 *   - only files matching `scr_<mac>.png` in the app's own directories are
 *     ever considered, so nothing else on the filesystem can be touched;
 *   - a file whose MAC belongs to a paired device is always kept, however old;
 *   - a file modified within the last hour is always kept, so an update in
 *     flight is never deleted out from under itself;
 *   - with no paired device to compare against, nothing is swept unless the
 *     caller passes force. An empty device list is ambiguous: it means either
 *     that the user has no tags, or that the drivers have not finished
 *     loading their devices yet. Without this guard the second case sweeps
 *     every screenshot the app owns, blanking each tile until that tag next
 *     updates - which on e-paper can be hours.
 *
 * @param {object} homey
 * @param {{dryRun?:boolean,force?:boolean}} [options]
 * @returns {{deleted:number,bytes:number,kept:number,failed:number,files:string[],skipped?:string}}
 */
function cleanup(homey, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const files = listScreenshots();
  const keep = pairedMacs(homey);
  const now = Date.now();

  const result = {
    deleted: 0, bytes: 0, kept: 0, failed: 0, files: [],
  };

  if (keep.size === 0 && !options.force) {
    result.kept = files.length;
    result.skipped = 'no paired devices to compare against';
    return result;
  }

  for (const f of files) {
    const owned = keep.has(f.mac.toUpperCase());
    const fresh = now - f.mtimeMs < MIN_AGE_MS;
    if (owned || fresh) {
      result.kept++;
      continue;
    }

    if (dryRun) {
      result.deleted++;
      result.bytes += f.size;
      result.files.push(f.path);
      continue;
    }

    try {
      fs.unlinkSync(f.path);
      result.deleted++;
      result.bytes += f.size;
      result.files.push(f.path);
    } catch (err) {
      result.failed++;
    }
  }

  return result;
}

module.exports = {
  IMAGE_DIRS, MIN_AGE_MS, listScreenshots, pairedMacs, report, cleanup,
};
