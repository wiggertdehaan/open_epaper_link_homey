'use strict';

// A clock difference smaller than this is network latency and rounding, not
// an AP whose clock is wrong, and is not worth a line in the log.
const CLOCK_SKEW_NOTICE_MS = 2 * 60 * 1000;

/**
 * Routes the AP's own status to the access point device.
 *
 * The AP broadcasts a `sys` frame over the same websocket the tag updates
 * arrive on, every few seconds, carrying its uptime, free heap, how many tags
 * it knows and its Wi-Fi signal. Until the access point could be added as a
 * device there was nowhere to put any of that, and this class did nothing.
 *
 * The frame also carries the AP's current time, which is kept whether or not
 * an AP device is paired: every timestamp the AP reports about a tag is on
 * the AP's clock, and comparing those against Homey's clock is only right when
 * the two agree.
 */
class APManager {

  constructor(homey) {
    this.homey = homey;
    // Homey's clock minus the AP's; zero until the first `sys` frame.
    this.clockOffsetMs = 0;
    this.clockSkewed = false;
  }

  /**
     * Hands one `sys` frame to the AP device, if one is paired.
     *
     * Frames arrive every few seconds whether or not anyone added the access
     * point, so this stays cheap and silent when there is no device: no
     * logging, no work beyond the lookup.
     */
  updateAPs(sys) {
    this.recordClock(sys);

    const device = this.apDevice();
    if (!device) return;

    device.applySysFrame(sys).catch((error) => {
      this.homey.log('Error applying AP status:', error.message || error);
    });
  }

  recordClock(sys) {
    const currtime = Number(sys && sys.currtime);
    if (!Number.isFinite(currtime) || currtime <= 0) return;

    this.clockOffsetMs = Date.now() - currtime * 1000;

    // Logged on the change only, since frames arrive every few seconds.
    const skewed = Math.abs(this.clockOffsetMs) > CLOCK_SKEW_NOTICE_MS;
    if (skewed !== this.clockSkewed) {
      this.clockSkewed = skewed;
      this.homey.log(skewed
        ? `The AP's clock is ${Math.round(Math.abs(this.clockOffsetMs) / 1000)} s `
          + `${this.clockOffsetMs > 0 ? 'behind' : 'ahead of'} Homey's; correcting for it`
        : "The AP's clock agrees with Homey's again");
    }
  }

  /** Now, as the AP's clock has it, in milliseconds. */
  apNow() {
    return Date.now() - this.clockOffsetMs;
  }

  /** The paired access point device, if there is one. */
  apDevice() {
    try {
      const driver = this.homey.homey.drivers.getDriver('ap');
      if (!driver) return null;

      const devices = driver.getDevices();
      const keys = Object.keys(devices);
      return keys.length > 0 ? devices[keys[0]] : null;
    } catch {
      // getDriver throws if the driver is not ready yet, which it is not
      // during the first moments after boot.
      return null;
    }
  }

}

module.exports = APManager;
