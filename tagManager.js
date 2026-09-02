'use strict';

const fs = require('fs');
const { Jimp } = require('jimp');
const axios = require('axios');
const { decodeRawImage } = require('./lib/rawImage');

// A tag reports why it woke up on every check-in. Pressing a button is one of
// the reasons, which is how a press reaches the AP at all: the tag has no
// separate channel, it simply wakes and checks in early with this field set.
// See oepl-proto.h, struct AvailDataReq.
const WAKEUP_REASON_BUTTON = { 4: 1, 5: 2, 6: 3 };

class TagManager {
  // constructor
  constructor(homey, gateway) {
    this.homey = homey;
    this.gateway = gateway;
    // last wake-up reason seen per tag, so a press is reported once rather
    // than on every websocket broadcast that repeats the same check-in
    this.lastWakeup = new Map();
    // hash of the framebuffer last rendered per tag, so an unchanged image
    // is not downloaded and decoded again on every websocket reconnect
    this.lastRendered = new Map();
    this.homey.log(`TagManager constructor gateway: ${this.gateway}`);
  }

  // The gateway address can be changed at any time from the app settings
  // page, so it must be updatable in place rather than captured at boot.
  setGateway(gateway) {
    this.gateway = gateway;
  }

  // update tags
  //
  // resolveTagType is called per tag: a single websocket message can carry
  // tags of different hardware types, so the type must be looked up for each
  // one instead of reusing the first tag's type for the whole batch.
  updateTags(tags, drivers, resolveTagType) {
    tags.forEach((tag) => {
      Promise.resolve()
        .then(() => resolveTagType(tag.hwType))
        .then((tagtype) => this.updateTag(tag, drivers, tagtype))
        .catch((error) => {
          this.homey.log(`Error resolving tag type for ${tag.mac}:`, error);
        });
    });
  }

  updateTag(tag, drivers, tagtype) {
    this.homey.log(`updating homey with Tag (mac): ${tag.mac}`);
    Object.keys(drivers).forEach((driverId) => {
      const driver = drivers[driverId];
      const devices = driver.getDevices();

      Object.keys(devices).forEach((deviceKey) => {
        const device = devices[deviceKey];
        const { id: deviceId } = device.getData();
        if (tag.mac === deviceId) {
          this.triggerButton(device, tag);

          // Each device is updated independently so one device's
          // failure (eg. a rejected setSettings call) can't be
          // left as an unhandled rejection or block the others.
          this.processTagUpdate(device, tag, tagtype).catch((error) => {
            this.homey.log(`Error updating device for tag ${tag.mac}:`, error);
          });
        }
      });
    });
  }

  async processTagUpdate(device, tag, tagtype) {
    // Keeps the led/button marker capabilities in step with the tag type,
    // which is what the flow cards filter on.
    if (typeof device.syncFeatureCapabilities === 'function') {
      await device.syncFeatureCapabilities(tagtype);
    }

    const settings = device.getSettings() || {};

    // Tags lying side by side can read several degrees apart: the sensor
    // sits behind the panel and is warmed by it, by a different amount per
    // model and mounting. The offset is per device for that reason.
    const offset = Number(settings.temperatureOffset) || 0;
    this.updateDeviceCapability(device, 'measure_temperature', tag.temperature + offset);

    this.updateDeviceCapability(device, 'measure_voltage', (tag.batteryMv / 1000));
    const alarmBattery = tag.batteryMv <= 2400 || tag.batteryMv === 0 || tag.batteryMv === 1337;
    this.updateDeviceCapability(device, 'alarm_battery', alarmBattery);

    // Decoding a framebuffer costs seconds of CPU on a Homey, so a user
    // who does not look at the preview can switch it off per device.
    if (settings.renderImage !== false) {
      await this.UpdateTagImage(device, tag, tagtype);
    }

    await this.updateInfoSettings(device, tag, settings);
  }

  /**
     * Writes the read-only informational settings, and only when one of them
     * actually changed.
     *
     * setSettings is not free and this runs on every check-in of every tag, so
     * writing unconditionally would undo the point of skipping unchanged
     * images.
     */
  async updateInfoSettings(device, tag, settings) {
    const next = {
      MACAddress: tag.mac,
      lastSeen: this.formatTimestamp(tag.lastseen),
    };

    const changed = Object.keys(next).filter((key) => settings[key] !== next[key]);
    if (changed.length === 0) return;

    try {
      await device.setSettings(next);
    } catch (error) {
      this.homey.log(`Could not update settings for tag ${tag.mac}:`, error.message || error);
    }
  }

  /** A unix timestamp as something readable in the user's own timezone. */
  formatTimestamp(seconds) {
    if (!seconds || seconds <= 0) return '-';

    const date = new Date(seconds * 1000);
    try {
      // this.homey is the app; the Homey instance hangs off it.
      const timeZone = this.homey.homey.clock.getTimezone();
      return date.toLocaleString('en-GB', { timeZone, hour12: false });
    } catch {
      // No clock manager available (tests), fall back to ISO.
      return date.toISOString().replace('T', ' ').slice(0, 19);
    }
  }

  // Fires the button trigger when a tag reports that a press is what woke it.
  // The same check-in can be broadcast more than once, so the reason alone is
  // not enough; it only counts as a new press when the check-in itself is new.
  triggerButton(device, tag) {
    const button = WAKEUP_REASON_BUTTON[tag.wakeupReason];
    const previous = this.lastWakeup.get(tag.mac);
    this.lastWakeup.set(tag.mac, { reason: tag.wakeupReason, lastseen: tag.lastseen });
    if (!button) return;
    if (previous && previous.reason === tag.wakeupReason && previous.lastseen === tag.lastseen) return;

    const card = this.homey.buttonPressedTrigger;
    if (!card) return;
    this.homey.log(`Tag ${tag.mac} reports button ${button} was pressed`);
    card.trigger(device, { button }).catch((error) => {
      this.homey.log(`Error firing the button trigger for ${tag.mac}:`, error);
    });
  }

  updateDeviceCapability(device, capability, value) {
    device.setCapabilityValue(capability, value)
      .catch((error) => {
        this.homey.log('Error updating capability:', error);
      });
  }

  async UpdateTagImage(device, tag, tagType) {
    if (!tagType) {
      this.homey.log(`No tag type data for tag ${tag.mac} (hwType ${tag.hwType}), skipping image update`);
      return;
    }

    if (tagType.bpp === 16) {
      this.homey.log(`bpp 16 tags are not supported for image rendering yet, skipping image update for tag:${tag.mac}`);
      return;
    }

    // The AP re-announces every tag it knows whenever the websocket
    // reconnects, which it does on its own every minute or two. Without
    // this check each of those re-announcements downloads the framebuffer
    // again, decodes it and rewrites the PNG - work that produced exactly
    // the same picture, since `hash` is the AP's own digest of the
    // framebuffer and had not changed.
    //
    // The all-zero hash means the AP has no digest for this tag, so it
    // says nothing about whether the content changed; those always render.
    const hash = tag.hash && tag.hash !== '00000000000000000000000000000000' ? tag.hash : null;
    if (hash && this.lastRendered.get(tag.mac) === hash) {
      try {
        if (fs.existsSync(device.getScreenshotPath())) {
          this.homey.log(`Image for tag ${tag.mac} is unchanged (hash ${hash}), skipping`);
          return;
        }
      } catch {
        // Cannot tell whether the file is there; fall through and render.
      }
    }

    const data = await this.downloadRawImage(tag);
    if (!data || data.length === 0) {
      return;
    }

    let decoded;
    try {
      decoded = decodeRawImage(data, tagType);
    } catch (error) {
      // A buffer we cannot decode must not be rendered: unpacking it
      // anyway produces black/white noise on the device tile, which is
      // worse than simply keeping the previous image.
      this.homey.log(`Skipping image for tag ${tag.mac}: ${error.message}`);
      return;
    }

    this.homey.log(`Decoded raw image for tag ${tag.mac
    } (hwType ${tag.hwType}, ${decoded.container}, ${
      decoded.width}x${decoded.height}, ${decoded.planes} plane(s))`);

    try {
      let image = new Jimp({ width: decoded.width, height: decoded.height, color: 0xffffffff });
      for (let p = 0; p < decoded.width * decoded.height; p++) {
        image.bitmap.data[p * 4] = decoded.rgb[p * 3];
        image.bitmap.data[p * 4 + 1] = decoded.rgb[p * 3 + 1];
        image.bitmap.data[p * 4 + 2] = decoded.rgb[p * 3 + 2];
        image.bitmap.data[p * 4 + 3] = 255;
      }

      // Panels whose framebuffer is stored rotated need turning upright
      // before we hand the picture to Homey.
      if (decoded.rotateDegrees) image = image.rotate(decoded.rotateDegrees);

      const squareImage = this.createSquareImage(image);
      const path = device.getScreenshotPath();

      // Wait for the file to actually be on disk before pointing
      // Homey's camera Image at it, otherwise Homey can read a
      // half-written (or not-yet-existing) file.
      await squareImage.write(path);

      // Reuses the device's own registered Image (created once,
      // cached on the device) instead of registering a new one on
      // every update.
      await device.updateCameraImage(path);

      if (hash) this.lastRendered.set(tag.mac, hash);

      this.homey.log('Image updated for tag:', tag.mac);
    } catch (error) {
      this.homey.log('Error processing image:', error);
    }
  }

  createSquareImage(originalImage) {
    let imageToProcess = originalImage;

    if (originalImage.bitmap.height > originalImage.bitmap.width) {
      imageToProcess = originalImage.rotate(-90);
    }

    const { width } = imageToProcess.bitmap;
    const { height } = imageToProcess.bitmap;

    const squareSize = Math.max(width, height);

    const squareImage = new Jimp({ width: squareSize, height: squareSize, color: 0x00000000 });

    const x = (squareSize - width) / 2;
    const y = (squareSize - height) / 2;

    squareImage.composite(imageToProcess, x, y);

    return squareImage;
  }

  async downloadRawImage(tag) {
    if (!tag || !tag.mac) {
      this.homey.log('Invalid tag for downloadRawImage');
      return null;
    }

    this.homey.log(`Downloading raw image for tag: ${tag.mac}`);

    // Gebruik een willekeurige waarde als hash niet beschikbaar of default is
    let cachetag = tag.hash;
    if (!cachetag || cachetag === '00000000000000000000000000000000') {
      cachetag = Date.now(); // Gebruik huidige timestamp in plaats van Math.random()
    }

    const url = `http://${this.gateway}/current/${tag.mac}.raw?${cachetag}`;
    this.homey.log(`Fetching raw image from gateway: ${url}`);

    try {
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
      return response.data;
    } catch (error) {
      this.homey.log(`Error downloading raw data: ${error.message || error}`);
      return null;
    }
  }

}

module.exports = TagManager;
