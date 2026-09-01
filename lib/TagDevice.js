'use strict';

const fs = require('fs');
const { Device } = require('homey');

/**
 * Shared base class for every OpenEPaperLink tag driver's Device.
 *
 * Centralises the Homey camera Image lifecycle: the Image is created and
 * registered once per device (on first use) and reused afterwards via
 * setPath()+update(), instead of registering a brand new Image on every
 * incoming tag update. Also owns the on-disk screenshot file used to feed
 * that Image, and cleans both up when the device is removed.
 */
class TagDevice extends Device {

  async onInit() {
    this.log('TagDevice has been initialized');
  }

  async onAdded() {
    this.log('TagDevice has been added');
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('TagDevice settings were changed');
  }

  async onRenamed(name) {
    this.log('TagDevice was renamed');
  }

  async onDeleted() {
    this.log('TagDevice has been deleted');

    if (this.cameraImage) {
      await this.cameraImage.unregister().catch((error) => {
        this.error('Failed to unregister camera image:', error);
      });
      this.cameraImage = null;
    }

    // The eslint config declares engines >=8, but the Apps SDK v3 runtime is
    // Node 16+, where fs.promises is long since available.
    // eslint-disable-next-line node/no-unsupported-features/node-builtins
    await fs.promises.unlink(this.getScreenshotPath()).catch(() => {
      // no screenshot was ever written for this device, nothing to clean up
    });
  }

  /**
   * Brings this device's hardware marker capabilities in line with what the
   * AP says its tag type can do.
   *
   * These carry no value worth reading; they exist so flow cards can be
   * filtered on `capabilities=` instead of `driver_id=`. That indirection is
   * what lets one generic driver serve every model: driver_id can only say
   * which driver a device sits on, which stops meaning anything about the
   * hardware once a single driver pairs all of them.
   *
   * Applied at runtime rather than declared in driver.compose.json, because a
   * declared capability lands on every device of that driver regardless of
   * model, and because it is the only way to reach devices that were paired
   * before these capabilities existed.
   */
  async syncFeatureCapabilities(tagType) {
    // No options array means the AP could not describe this tag type. Leaving
    // the capabilities untouched is deliberate: dropping them here would strip
    // a working device's flow cards on a single failed lookup.
    if (!tagType || !Array.isArray(tagType.options)) return;

    for (const [option, capability] of Object.entries(TagDevice.FEATURE_CAPABILITIES)) {
      const wanted = tagType.options.includes(option);
      if (wanted === this.hasCapability(capability)) continue;

      try {
        if (wanted) {
          // eslint-disable-next-line no-await-in-loop
          await this.addCapability(capability);
          // eslint-disable-next-line no-await-in-loop
          await this.setCapabilityValue(capability, true);
          this.log(`Added capability ${capability} (tag type advertises "${option}")`);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await this.removeCapability(capability);
          this.log(`Removed capability ${capability} (tag type does not advertise "${option}")`);
        }
      } catch (error) {
        this.error(`Could not sync capability ${capability}:`, error);
      }
    }
  }

  /**
   * Path of the raw screenshot written for this device by TagManager.
   */
  getScreenshotPath() {
    return `/tmp/scr_${this.getData().id}.png`;
  }

  /**
   * Returns this device's registered camera Image, creating and
   * registering it the first time it's needed. The same Image instance
   * is reused for the lifetime of the device.
   */
  async getCameraImage() {
    if (!this.cameraImage) {
      const { id } = this.getData();
      this.cameraImage = await this.homey.images.createImage();
      await this.setCameraImage(id, id, this.cameraImage);
    }
    return this.cameraImage;
  }

  /**
   * Points this device's camera Image at a freshly written file on disk
   * and notifies Homey the contents changed.
   */
  async updateCameraImage(path) {
    const image = await this.getCameraImage();
    image.setPath(path);
    await image.update();
  }

}

// Tag type `options` entry -> the capability that marks it.
TagDevice.FEATURE_CAPABILITIES = {
  led: 'oepl_led',
  button: 'oepl_button',
};

module.exports = TagDevice;
