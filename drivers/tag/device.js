'use strict';

const { Device } = require('homey');

/**
 * A tag paired through the generic driver.
 *
 * Everything about rendering and capability updates lives in TagManager, which
 * matches tags to devices by MAC rather than by driver, so this needs nothing
 * beyond what every other tag device does. The hardware type is on the device
 * store, put there during pairing.
 */
class TagDeviceGeneric extends Device {

  async onInit() {
    const hwType = this.getStoreValue('hwType');
    const model = this.getStoreValue('model');
    this.log(`Tag ${this.getData().id} initialized (${model || 'unknown model'}, hwType ${hwType})`);
  }

  async onAdded() {
    this.log('Tag has been added');
  }

  async onRenamed(name) {
    this.log('Tag was renamed');
  }

  async onDeleted() {
    this.log('Tag has been deleted');
  }

}

module.exports = TagDeviceGeneric;
