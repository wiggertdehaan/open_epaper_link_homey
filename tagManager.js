'use strict';

const fs = require('fs');
const { Jimp } = require('jimp');
const { http } = require('./lib/http');
const { decodeRawImage } = require('./lib/rawImage');
const { createLimiter } = require('./lib/limiter');
const { normalizeMac } = require('./lib/devices');

// A tag reports why it woke up on every check-in. Pressing a button is one of
// the reasons, which is how a press reaches the AP at all: the tag has no
// separate channel, it simply wakes and checks in early with this field set.
// See oepl-proto.h, struct AvailDataReq.
const WAKEUP_REASON_BUTTON = { 4: 1, 5: 2, 6: 3 };

// When the websocket connects, the AP announces every tag's last check-in,
// however old. The first time a tag is seen, a button press only counts if the
// check-in carrying it is at most this old; otherwise every app restart would
// replay the last press of every tag.
const BUTTON_FRESH_MS = 60 * 1000;

// Framebuffer decodes run at most this many at once. A reconnect re-announces
// every tag in one go, and decoding all of them in parallel is enough to have
// Homey stop the app for using too much memory.
const RENDER_CONCURRENCY = 2;

// The informational Last seen setting changes on every check-in. Writing it
// that often costs a settings write per tag per check-in for a label the user
// rarely opens, so it is refreshed at most this often.
const LAST_SEEN_WRITE_INTERVAL_MS = 10 * 60 * 1000;

// A device that never becomes ready must not hold up its tag's queue forever.
const DEVICE_READY_TIMEOUT_MS = 30 * 1000;

// The AP reports these instead of a voltage when it has no reading: 0 before
// the first measurement, 1337 for tags it cannot measure.
const BATTERY_UNKNOWN_MV = [0, 1337];
const BATTERY_LOW_MV = 2400;

const NO_HASH = '00000000000000000000000000000000';

class TagManager {

  /**
   * @param {object} homey  the app; named so for historic reasons
   */
  constructor(homey) {
    this.homey = homey;
    // last wake-up reason seen per tag, so a press is reported once rather
    // than on every websocket broadcast that repeats the same check-in
    this.lastWakeup = new Map();
    // hash of the framebuffer last rendered per tag, so an unchanged image
    // is not downloaded and decoded again on every websocket reconnect
    this.lastRendered = new Map();
    // when the informational settings were last written, per tag
    this.lastInfoWrite = new Map();
    // the newest update waiting per tag, and the worker processing each tag
    this.queued = new Map();
    this.draining = new Map();
    this.renderLimit = createLimiter(RENDER_CONCURRENCY);
    this.homey.log(`TagManager constructor gateway: ${this.gateway()}`);
  }

  gateway() {
    return this.homey.getGateway();
  }

  /** Now, on the AP's clock, which is the clock tag timestamps are on. */
  apNow() {
    return typeof this.homey.apNow === 'function' ? this.homey.apNow() : Date.now();
  }

  /**
   * Takes one websocket `tags` frame.
   *
   * Updates for one tag are processed one at a time, and while one is being
   * processed only the newest of any further updates is kept: an older
   * check-in has nothing to add once a newer one has arrived. Button presses
   * are the exception, since each check-in can carry one, so those are
   * picked out here as the frame arrives, before anything is dropped.
   *
   * resolveTagType is called per tag: a single websocket message can carry
   * tags of different hardware types.
   *
   * @returns {Promise<void>} settles once the work this frame started is done
   */
  updateTags(tags, drivers, resolveTagType) {
    const started = [];

    for (const tag of tags) {
      if (!tag || !tag.mac) continue;

      const mac = normalizeMac(tag.mac);
      const devices = this.devicesFor(mac, drivers);
      if (devices.length === 0) continue;

      this.triggerButton(devices, tag);

      this.queued.set(mac, { tag, devices, resolveTagType });
      if (!this.draining.has(mac)) started.push(this.drain(mac));
    }

    return Promise.all(started).then(() => {});
  }

  /** Settles once every queued update has been processed. */
  async idle() {
    while (this.draining.size > 0) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([...this.draining.values()]);
    }
  }

  devicesFor(mac, drivers) {
    const matches = [];
    for (const driverId of Object.keys(drivers)) {
      let devices;
      try {
        devices = drivers[driverId].getDevices();
      } catch {
        continue; // driver still initialising
      }
      for (const key of Object.keys(devices)) {
        const device = devices[key];
        const data = device.getData();
        if (data && normalizeMac(data.id) === mac) matches.push(device);
      }
    }
    return matches;
  }

  drain(mac) {
    const work = (async () => {
      while (this.queued.has(mac)) {
        const { tag, devices, resolveTagType } = this.queued.get(mac);
        this.queued.delete(mac);

        try {
          // eslint-disable-next-line no-await-in-loop
          const tagType = await resolveTagType(tag.hwType);
          for (const device of devices) {
            // Each device separately, so one failing (eg. a rejected
            // setSettings call) cannot stop the others.
            // eslint-disable-next-line no-await-in-loop
            await this.processTagUpdate(device, tag, tagType).catch((error) => {
              this.homey.log(`Error updating device for tag ${tag.mac}:`, error);
            });
          }
        } catch (error) {
          this.homey.log(`Error resolving tag type for ${tag.mac}:`, error);
        }
      }
    })().finally(() => {
      this.draining.delete(mac);
      // Belt and braces: never leave an update queued with no worker.
      // drain() handles its own errors, so there is nothing to catch.
      if (this.queued.has(mac)) this.drain(mac).catch(() => {});
    });

    this.draining.set(mac, work);
    return work;
  }

  async processTagUpdate(device, tag, tagtype) {
    // Frames start arriving as soon as the app starts, before Homey has
    // finished initialising the devices they are for.
    await this.whenReady(device);

    // Keeps the led/button marker capabilities in step with the tag type,
    // which is what the flow cards filter on.
    if (typeof device.syncFeatureCapabilities === 'function') {
      await device.syncFeatureCapabilities(tagtype);
    }

    const settings = device.getSettings() || {};

    // Tags lying side by side can read several degrees apart: the sensor
    // sits behind the panel and is warmed by it, by a different amount per
    // model and mounting. The offset is per device for that reason.
    if (typeof tag.temperature === 'number' && Number.isFinite(tag.temperature)) {
      const offset = Number(settings.temperatureOffset);
      const corrected = tag.temperature + (Number.isFinite(offset) ? offset : 0);
      // Rounded, or an offset of 0.1 turns 21 into 21.099999999999998.
      this.updateDeviceCapability(device, 'measure_temperature', Math.round(corrected * 10) / 10);
    }

    // A placeholder is not a reading: writing it would put 0 V or 1.337 V in
    // Insights and raise a low battery alarm for a battery that is fine.
    const mv = tag.batteryMv;
    if (typeof mv === 'number' && Number.isFinite(mv) && !BATTERY_UNKNOWN_MV.includes(mv)) {
      this.updateDeviceCapability(device, 'measure_voltage', mv / 1000);
      this.updateDeviceCapability(device, 'alarm_battery', mv <= BATTERY_LOW_MV);
    }

    // Decoding a framebuffer costs seconds of CPU on a Homey, so a user
    // who does not look at the preview can switch it off per device.
    if (settings.renderImage !== false) {
      await this.UpdateTagImage(device, tag, tagtype);
    }

    await this.updateInfoSettings(device, tag, settings);
  }

  async whenReady(device) {
    if (typeof device.ready !== 'function') return;

    // Homey's own timers when running on a Homey, so the platform can clear
    // them; plain ones in the verification scripts.
    const { homey } = this.homey;
    const timers = homey && typeof homey.setTimeout === 'function'
      ? homey
      : { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };

    let timer;
    const timeout = new Promise((resolve) => {
      timer = timers.setTimeout(resolve, DEVICE_READY_TIMEOUT_MS);
    });
    try {
      await Promise.race([device.ready(), timeout]);
    } finally {
      timers.clearTimeout(timer);
    }
  }

  /**
     * Writes the read-only informational settings when one of them changed.
     *
     * setSettings is not free and this runs on every check-in of every tag.
     * The MAC is written as soon as it differs; Last seen changes on every
     * check-in, so it is only refreshed every LAST_SEEN_WRITE_INTERVAL_MS.
     */
  async updateInfoSettings(device, tag, settings) {
    const next = {
      MACAddress: tag.mac,
      lastSeen: this.formatTimestamp(tag.lastseen),
    };

    const changed = Object.keys(next).filter((key) => settings[key] !== next[key]);
    if (changed.length === 0) return;

    const mac = normalizeMac(tag.mac);
    const lastWrite = this.lastInfoWrite.get(mac);
    const onlyLastSeen = changed.length === 1 && changed[0] === 'lastSeen';
    const wasBlank = !settings.lastSeen || settings.lastSeen === '-';
    if (onlyLastSeen && !wasBlank && lastWrite !== undefined
        && Date.now() - lastWrite < LAST_SEEN_WRITE_INTERVAL_MS) {
      return;
    }

    try {
      await device.setSettings(next);
      this.lastInfoWrite.set(mac, Date.now());
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

  /**
   * The button a check-in reports as pressed, if it is a press not reported
   * before; otherwise null.
   *
   * The same check-in can be broadcast more than once, so the reason alone is
   * not enough; it only counts as a new press when the check-in itself is new.
   */
  newButtonPress(tag) {
    const mac = normalizeMac(tag.mac);
    const button = WAKEUP_REASON_BUTTON[tag.wakeupReason];
    const previous = this.lastWakeup.get(mac);
    this.lastWakeup.set(mac, { reason: tag.wakeupReason, lastseen: tag.lastseen });

    if (!button) return null;

    if (previous) {
      if (previous.reason === tag.wakeupReason && previous.lastseen === tag.lastseen) return null;
      return button;
    }

    // First sighting since the app started: likely the AP re-announcing an
    // old check-in on connect, not a press happening now.
    const age = this.apNow() - Number(tag.lastseen) * 1000;
    if (!Number.isFinite(age) || age > BUTTON_FRESH_MS) {
      this.homey.log(`Tag ${tag.mac} last woke for button ${button}, but that check-in is old, not triggering`);
      return null;
    }
    return button;
  }

  triggerButton(devices, tag) {
    const button = this.newButtonPress(tag);
    if (!button) return;

    const card = this.homey.buttonPressedTrigger;
    if (!card) return;

    this.homey.log(`Tag ${tag.mac} reports button ${button} was pressed`);
    for (const device of devices) {
      this.whenReady(device)
        .then(() => card.trigger(device, { button }))
        .catch((error) => {
          this.homey.log(`Error firing the button trigger for ${tag.mac}:`, error);
        });
    }
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
    const mac = normalizeMac(tag.mac);
    const hash = tag.hash && tag.hash !== NO_HASH ? tag.hash : null;
    if (hash && this.lastRendered.get(mac) === hash) {
      try {
        if (fs.existsSync(device.getScreenshotPath())) {
          this.homey.log(`Image for tag ${tag.mac} is unchanged (hash ${hash}), skipping`);
          return;
        }
      } catch {
        // Cannot tell whether the file is there; fall through and render.
      }
    }

    await this.renderLimit(() => this.renderTagImage(device, tag, tagType, hash));
  }

  async renderTagImage(device, tag, tagType, hash) {
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

    const path = device.getScreenshotPath();
    const temporary = `${path}.tmp`;

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

      // Written next to the real file and renamed over it: a rename is
      // atomic, so Homey, which may read the file at any moment to show the
      // tile, never sees a half-written PNG.
      const png = await squareImage.getBuffer('image/png');
      // eslint-disable-next-line node/no-unsupported-features/node-builtins
      await fs.promises.writeFile(temporary, png);
      // eslint-disable-next-line node/no-unsupported-features/node-builtins
      await fs.promises.rename(temporary, path);

      // Reuses the device's own registered Image (created once,
      // cached on the device) instead of registering a new one on
      // every update.
      await device.updateCameraImage(path);

      if (hash) this.lastRendered.set(normalizeMac(tag.mac), hash);

      this.homey.log('Image updated for tag:', tag.mac);
    } catch (error) {
      this.homey.log('Error processing image:', error);
      // eslint-disable-next-line node/no-unsupported-features/node-builtins
      await fs.promises.unlink(temporary).catch(() => {});
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

    const gateway = this.gateway();
    if (!gateway) {
      this.homey.log('Gateway has not been configured, cannot download the image');
      return null;
    }

    this.homey.log(`Downloading raw image for tag: ${tag.mac}`);

    // The hash busts any cache between us and the AP. Without a usable hash
    // the current time does the same job.
    let cachetag = tag.hash;
    if (!cachetag || cachetag === NO_HASH) {
      cachetag = Date.now();
    }

    const url = `http://${gateway}/current/${tag.mac}.raw?${cachetag}`;
    this.homey.log(`Fetching raw image from gateway: ${url}`);

    try {
      const response = await http.get(url, { responseType: 'arraybuffer' });
      return response.data;
    } catch (error) {
      this.homey.log(`Error downloading raw data: ${error.message || error}`);
      return null;
    }
  }

}

TagManager.BUTTON_FRESH_MS = BUTTON_FRESH_MS;
TagManager.LAST_SEEN_WRITE_INTERVAL_MS = LAST_SEEN_WRITE_INTERVAL_MS;
TagManager.RENDER_CONCURRENCY = RENDER_CONCURRENCY;

module.exports = TagManager;
