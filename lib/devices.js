'use strict';

/**
 * Finding paired devices by the tag they belong to.
 *
 * A device's data.id is the MAC of its tag. The AP reports MACs in upper case,
 * but nothing guarantees that for a device paired years ago, so every
 * comparison goes through normalizeMac().
 */

function normalizeMac(mac) {
  return String(mac || '').trim().toUpperCase();
}

/**
 * Every paired device, grouped by MAC. A list per MAC rather than a single
 * device, because older versions allowed the same tag to be paired on more
 * than one driver and those duplicates still exist.
 *
 * @returns {Map<string, Array<object>>}
 */
function devicesByMac(homey) {
  const byMac = new Map();
  const drivers = homey.drivers.getDrivers();

  for (const driverId of Object.keys(drivers)) {
    let devices;
    try {
      devices = drivers[driverId].getDevices();
    } catch {
      // A driver that has not finished initialising yet has nothing to offer.
      continue;
    }

    for (const key of Object.keys(devices)) {
      const device = devices[key];
      const data = device.getData();
      if (!data || !data.id) continue;

      const mac = normalizeMac(data.id);
      if (!byMac.has(mac)) byMac.set(mac, []);
      byMac.get(mac).push(device);
    }
  }

  return byMac;
}

/** MACs of every paired device, normalised. */
function pairedMacs(homey) {
  return new Set(devicesByMac(homey).keys());
}

module.exports = { normalizeMac, devicesByMac, pairedMacs };
