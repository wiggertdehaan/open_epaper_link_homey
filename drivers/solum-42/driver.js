'use strict';

const { Driver } = require('homey');
const { fetchAllTags } = require('../../lib/apClient');
const { readGateway } = require('../../lib/gateway');
const { pairedMacs, normalizeMac } = require('../../lib/devices');

class MyDriver extends Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('MyDriver has been initialized');

  }

  async fetchTags() {
    try {
      const gateway = readGateway(this.homey);

      if (!gateway) {
        this.homey.log('Gateway has not been configured.');
        return []; // nothing to list without an AP address
      }

      // The AP returns a page of tags at a time; walk them all so tags
      // beyond the first page can be paired too.
      return await fetchAllTags(gateway);
    } catch (error) {
      this.homey.log('Could not fetch the tag list:', error.message);
      return []; // an empty list rather than a failed pairing screen
    }
  }

  async filterAndFormatDevices(tags) {
    // Tags already paired, on this driver or any other, are left out. Homey
    // only refuses a duplicate within one driver, and the same tag paired on
    // two drivers ends up with two devices fighting over one screenshot.
    const paired = pairedMacs(this.homey);

    // This driver is for one hardware type only.
    const filteredDevices = tags.filter((device) => device.hwType === 2
      && !paired.has(normalizeMac(device.mac)));

    const formattedDevices = filteredDevices.map((device) => ({
      name: `${device.alias}`,
      data: {
        id: device.mac,
      },
    }));

    return formattedDevices;
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    try {
      const tags = await this.fetchTags();
      const result = await this.filterAndFormatDevices(tags);
      this.log('Tags available for pairing:', result);
      return result;
    } catch (error) {
      this.log('Could not list the tags:', error);
      return [];
    }

  }

}

module.exports = MyDriver;
