'use strict';

const { Device } = require('homey');

const apDiscovery = require('../../lib/apDiscovery');
const { readGateway } = require('../../lib/gateway');

// The AP sends a `sys` frame every few seconds. Uptime and free heap change in
// every one of them, so writing each frame through would log a point to
// Insights every few seconds for numbers nobody reads that closely.
const SYS_WRITE_INTERVAL_MS = 60 * 1000;

/**
 * The access point as a Homey device.
 *
 * The live numbers arrive on their own: the AP broadcasts a `sys` frame over
 * the websocket every few seconds, and APManager feeds them here. What the
 * frame does not carry is the fixed description of the AP - firmware, board,
 * protocol version - so that is read from /sysinfo on start and refreshed
 * daily, which is often enough to notice a firmware upgrade.
 */
class ApDevice extends Device {

  async onInit() {
    this.log('AP device has been initialized');

    // A firmware upgrade is the only thing that changes these, so once a day
    // is plenty; the delay keeps it off the boot path.
    this.descriptionTimeout = this.homey.setTimeout(() => {
      this.refreshDescription().catch((error) => this.error('Could not read /sysinfo:', error));
    }, 10 * 1000);

    this.descriptionInterval = this.homey.setInterval(() => {
      this.refreshDescription().catch((error) => this.error('Could not read /sysinfo:', error));
    }, 24 * 60 * 60 * 1000);
  }

  async onUninit() {
    if (this.descriptionTimeout) this.homey.clearTimeout(this.descriptionTimeout);
    if (this.descriptionInterval) this.homey.clearInterval(this.descriptionInterval);
  }

  /**
   * Reads /sysinfo and stores what it says in the device settings.
   *
   * The address comes from the app settings rather than from what the device
   * was paired with, so an AP that moved to a new address still describes
   * itself correctly once the user updates the app setting.
   */
  async refreshDescription() {
    const address = readGateway(this.homey);
    if (!address) return;

    const ap = await apDiscovery.probe(address, 8000);
    if (!ap) {
      this.log('No /sysinfo from', address);
      return;
    }

    await this.applySettings({
      address: ap.address,
      firmware: ap.buildversion || '-',
      board: ap.env || '-',
      apVersion: ap.apVersion === undefined ? '-' : String(ap.apVersion),
    });
  }

  /**
   * Writes settings, and only the ones that actually differ.
   */
  async applySettings(values) {
    const current = this.getSettings() || {};
    const changed = {};

    for (const [key, value] of Object.entries(values)) {
      if (current[key] !== value) changed[key] = value;
    }

    if (Object.keys(changed).length === 0) return;

    try {
      await this.setSettings(changed);
    } catch (error) {
      this.error('Could not write settings:', error.message || error);
    }
  }

  /**
   * Applies one `sys` frame from the AP's websocket.
   *
   * At most once every SYS_WRITE_INTERVAL_MS, except that a change in the
   * number of tags or an AP restart (uptime going backwards) is written at
   * once, since those are the changes a flow might want to react to.
   *
   * @param {object} sys
   */
  async applySysFrame(sys) {
    if (!sys || typeof sys !== 'object') return;

    const now = Date.now();
    const tags = typeof sys.recordcount === 'number' ? sys.recordcount : undefined;
    const uptime = typeof sys.uptime === 'number' ? sys.uptime : undefined;

    const urgent = this.lastSysWrite === undefined
      || (tags !== undefined && tags !== this.lastSysTags)
      || (uptime !== undefined && this.lastSysUptime !== undefined && uptime < this.lastSysUptime);

    if (tags !== undefined) this.lastSysTags = tags;
    if (uptime !== undefined) this.lastSysUptime = uptime;

    if (!urgent && now - this.lastSysWrite < SYS_WRITE_INTERVAL_MS) return;
    this.lastSysWrite = now;

    const set = async (capability, value) => {
      if (value === null || value === undefined || Number.isNaN(value)) return;
      if (typeof this.getCapabilityValue === 'function' && this.getCapabilityValue(capability) === value) return;
      try {
        await this.setCapabilityValue(capability, value);
      } catch (error) {
        this.error(`Could not set ${capability}:`, error.message || error);
      }
    };

    if (typeof sys.rssi === 'number') await set('measure_signal_strength', sys.rssi);
    if (typeof sys.recordcount === 'number') await set('oepl_ap_tags', sys.recordcount);

    // Reported in seconds; hours reads better and graphs usefully, and a reset
    // shows up as the drop back to zero.
    if (typeof sys.uptime === 'number') {
      await set('oepl_ap_uptime', Math.round((sys.uptime / 3600) * 10) / 10);
    }

    if (typeof sys.heap === 'number') await set('oepl_ap_heap', Math.round(sys.heap / 1024));

    if (typeof sys.wifissid === 'string' && sys.wifissid) {
      await this.applySettings({ wifiSsid: sys.wifissid });
    }
  }

}

ApDevice.SYS_WRITE_INTERVAL_MS = SYS_WRITE_INTERVAL_MS;

module.exports = ApDevice;
