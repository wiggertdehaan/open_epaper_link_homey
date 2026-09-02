'use strict';

const { Driver } = require('homey');

const { fetchAllTags } = require('../../lib/apClient');

/**
 * One driver for pairing any OpenEPaperLink tag.
 *
 * The AP already knows the hardware type of every tag it has seen, so there is
 * no reason to make the user pick a model from a list. This lists everything
 * /get_db returns, works out the hwType per tag, and hands Homey a
 * multi-select list.
 */
class TagDriver extends Driver {

  async onInit() {
    this.log('Tag driver has been initialized');
  }

  /**
   * MAC addresses already paired anywhere in this app, so a tag cannot be
   * added twice - including tags sitting on the older per-model drivers.
   */
  pairedMacs() {
    const macs = new Set();
    const drivers = this.homey.drivers.getDrivers();
    for (const driverId of Object.keys(drivers)) {
      const devices = drivers[driverId].getDevices();
      for (const key of Object.keys(devices)) {
        const data = devices[key].getData();
        if (data && data.id) macs.add(String(data.id).toUpperCase());
      }
    }
    return macs;
  }

  async fetchTags() {
    const gateway = this.homey.settings.get('gateway');
    if (!gateway) {
      throw new Error(this.homey.__('pair.noGateway'));
    }

    try {
      // Walks every page: the AP hands out ten tags at a time.
      return await fetchAllTags(gateway);
    } catch (error) {
      if (/Unexpected response/.test(error.message)) {
        throw new Error(this.homey.__('pair.badResponse', { gateway }));
      }
      throw new Error(this.homey.__('pair.unreachable', { gateway, error: error.message }));
    }
  }

  /**
   * Model name straight from the AP's own tag type definition, which is the
   * authoritative source; falls back to the raw hwType if the AP has no
   * definition for it.
   */
  async resolveModelName(hwType) {
    const { app } = this.homey;
    if (app && typeof app.getTagTypeData === 'function') {
      try {
        const tagType = await app.getTagTypeData(hwType);
        if (tagType && tagType.name) return tagType.name;
      } catch {
        // fall through
      }
    }
    return `Tag type 0x${Number(hwType).toString(16).padStart(2, '0').toUpperCase()}`;
  }

  /** "3.09 V - 25 C - seen 4 min ago", enough to recognise a tag by. */
  describe(tag) {
    const parts = [];

    if (typeof tag.batteryMv === 'number' && tag.batteryMv > 0 && tag.batteryMv !== 1337) {
      parts.push(`${(tag.batteryMv / 1000).toFixed(2)} V`);
    }
    if (typeof tag.temperature === 'number') {
      parts.push(`${tag.temperature} °C`);
    }
    if (typeof tag.lastseen === 'number' && tag.lastseen > 0) {
      const seconds = Math.max(0, Math.floor(Date.now() / 1000) - tag.lastseen);
      if (seconds < 90) parts.push('seen just now');
      else if (seconds < 3600) parts.push(`seen ${Math.round(seconds / 60)} min ago`);
      else if (seconds < 86400) parts.push(`seen ${Math.round(seconds / 3600)} h ago`);
      else parts.push(`seen ${Math.round(seconds / 86400)} d ago`);
    }

    return parts.join(' · ');
  }

  async onPairListDevices() {
    const tags = await this.fetchTags();
    const paired = this.pairedMacs();

    const available = tags.filter((tag) => tag.mac && !paired.has(String(tag.mac).toUpperCase()));
    this.log(`Pairing: ${tags.length} tag(s) known to the AP, ${tags.length - available.length} already paired`);

    const devices = [];
    for (const tag of available) {
      const hwType = Number(tag.hwType);
      // eslint-disable-next-line no-await-in-loop
      const model = await this.resolveModelName(hwType);
      const alias = (tag.alias || '').trim();

      // The pairing list is only guaranteed to render `name`, so an unnamed
      // tag gets a name that is useful on its own: model plus the tail of the
      // MAC, which is what is printed on the label. Tags the AP already has an
      // alias for keep that alias, since it becomes the device name in Homey.
      const shortMac = String(tag.mac).slice(-4).toUpperCase();

      devices.push({
        name: alias || `${model} ${shortMac}`,
        data: {
          // Same shape the per-model drivers use, so nothing downstream needs
          // to care which driver a device came from.
          id: tag.mac,
        },
        store: {
          hwType,
          model,
        },
        settings: {
          MACAddress: tag.mac,
        },
        // Rendered as a subtitle by clients that support it; harmless if not.
        description: [model, this.describe(tag)].filter(Boolean).join(' · '),
      });
    }

    // Tags of the same model can share the tail of their MAC, so any name that
    // is not unique gets the full MAC appended - otherwise the list shows two
    // identical rows and there is no way to tell which is which.
    const counts = {};
    for (const d of devices) counts[d.name] = (counts[d.name] || 0) + 1;
    for (const d of devices) {
      if (counts[d.name] > 1) d.name = `${d.name} (${d.data.id})`;
    }

    devices.sort((a, b) => a.name.localeCompare(b.name));
    return devices;
  }

}

module.exports = TagDriver;
