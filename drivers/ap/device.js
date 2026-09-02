'use strict';

const { Device } = require('homey');

const apDiscovery = require('../../lib/apDiscovery');

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
    const address = this.homey.settings.get('gateway');
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
   * @param {object} sys
   */
  async applySysFrame(sys) {
    if (!sys || typeof sys !== 'object') return;

    const set = async (capability, value) => {
      if (value === null || value === undefined || Number.isNaN(value)) return;
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

module.exports = ApDevice;
