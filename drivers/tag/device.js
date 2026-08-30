'use strict';

const TagDevice = require('../../lib/TagDevice');
const { batteries, modelName } = require('../../lib/tagModels');

/**
 * A tag paired through the generic driver. Everything about rendering and
 * capability updates lives in TagDevice and TagManager, which key off the MAC
 * rather than the driver, so all this adds is the per-model detail that used
 * to be baked into the manifest of a hundred separate drivers.
 */
class TagDeviceGeneric extends TagDevice {

  async onInit() {
    await super.onInit();

    const hwType = this.getStoreValue('hwType');
    if (hwType === null || hwType === undefined) return;

    // The manifest can only declare one battery layout, so the real one is
    // applied per device once we know the model.
    const layout = batteries(hwType);
    const current = this.getEnergy() || {};
    if (JSON.stringify(current.batteries || []) !== JSON.stringify(layout)) {
      await this.setEnergy({ ...current, batteries: layout }).catch((error) => {
        this.error('Failed to set energy:', error);
      });
    }

    const model = this.getStoreValue('model') || modelName(hwType);
    this.log(`Tag ${this.getData().id} is a ${model} (hwType ${hwType})`);
  }

}

module.exports = TagDeviceGeneric;
