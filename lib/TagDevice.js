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

    await fs.promises.unlink(this.getScreenshotPath()).catch(() => {
      // no screenshot was ever written for this device, nothing to clean up
    });
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

module.exports = TagDevice;
