'use strict';

const { Driver } = require('homey');

const apDiscovery = require('../../lib/apDiscovery');

/**
 * Pairing the access point itself as a device.
 *
 * The app already knows one AP address, from its own settings, so pairing
 * normally has nothing to look for: it offers that one. Only when no address
 * is set, or the configured one does not answer, does it fall back to sweeping
 * the network - the same sweep the Search button on the settings page uses.
 */
class ApDriver extends Driver {

  async onInit() {
    this.log('AP driver has been initialized');
  }

  /**
   * The app talks to exactly one AP, so the device gets a fixed id rather than
   * one derived from the address. /sysinfo carries no serial or MAC to key on,
   * and an address is a poor identity: a DHCP lease change would otherwise
   * orphan the device and its flows.
   */
  static DEVICE_ID = 'ap';

  async alreadyPaired() {
    const devices = this.getDevices();
    return Object.keys(devices).length > 0;
  }

  async onPairListDevices() {
    if (await this.alreadyPaired()) {
      // Homey would refuse the duplicate anyway; saying so is friendlier than
      // an empty list the user cannot explain.
      throw new Error(this.homey.__('pair.apAlreadyAdded'));
    }

    const configured = this.homey.settings.get('gateway');
    const found = [];

    if (configured) {
      this.log('Checking the configured address', configured);
      const ap = await apDiscovery.probe(configured, 8000);
      if (ap) found.push(ap);
      else this.log('The configured address did not answer as an AP, sweeping instead');
    }

    if (found.length === 0) {
      const localAddress = await this.homey.cloud.getLocalAddress();
      const discovered = await apDiscovery.discover(localAddress, {
        log: (message) => this.log(message),
      });
      found.push(...discovered);
    }

    if (found.length === 0) {
      throw new Error(this.homey.__('pair.apNotFound'));
    }

    return found.map((ap) => ({
      name: ap.alias ? `OpenEPaperLink AP (${ap.alias})` : 'OpenEPaperLink AP',
      data: { id: ApDriver.DEVICE_ID },
      settings: {
        address: ap.address,
        firmware: ap.buildversion || '-',
        board: ap.env || '-',
        apVersion: ap.apVersion === undefined ? '-' : String(ap.apVersion),
      },
    }));
  }

}

module.exports = ApDriver;
