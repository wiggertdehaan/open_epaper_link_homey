'use strict';

const TagDevice = require('../../lib/TagDevice');

/**
 * A tag paired through the generic driver.
 *
 * Everything about rendering and capability updates lives in TagManager, which
 * matches tags to devices by MAC rather than by driver, so this needs nothing
 * beyond what every other tag device does. The hardware type is on the device
 * store, put there during pairing.
 *
 * It extends the same TagDevice base as the per-model drivers, which owns the
 * Homey camera Image lifecycle and the screenshot file. TagManager calls
 * getScreenshotPath() and updateCameraImage() on whatever device a tag maps
 * to, so a device without them would simply never render an image.
 */
class TagDeviceGeneric extends TagDevice {

  async onInit() {
    const hwType = this.getStoreValue('hwType');
    const model = this.getStoreValue('model');
    this.log(`Tag ${this.getData().id} initialized (${model || 'unknown model'}, hwType ${hwType})`);
  }

}

module.exports = TagDeviceGeneric;
