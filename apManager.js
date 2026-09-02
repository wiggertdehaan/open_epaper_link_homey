'use strict';

/**
 * Routes the AP's own status to the access point device.
 *
 * The AP broadcasts a `sys` frame over the same websocket the tag updates
 * arrive on, every few seconds, carrying its uptime, free heap, how many tags
 * it knows and its Wi-Fi signal. Until the access point could be added as a
 * device there was nowhere to put any of that, and this class did nothing.
 */
class APManager {

    constructor(homey, gateway) {
        this.homey = homey;
        this.gateway = gateway;
        this.homey.log('AP Manager constructor gateway: ' + this.gateway);
    }

    setGateway(gateway) {
        this.gateway = gateway;
    }

    /**
     * Hands one `sys` frame to the AP device, if one is paired.
     *
     * Frames arrive every few seconds whether or not anyone added the access
     * point, so this stays cheap and silent when there is no device: no
     * logging, no work beyond the lookup.
     */
    updateAPs(sys) {
        const device = this.apDevice();
        if (!device) return;

        device.applySysFrame(sys).catch((error) => {
            this.homey.log('Error applying AP status:', error.message || error);
        });
    }

    /** The paired access point device, if there is one. */
    apDevice() {
        try {
            const driver = this.homey.homey.drivers.getDriver('ap');
            if (!driver) return null;

            const devices = driver.getDevices();
            const keys = Object.keys(devices);
            return keys.length > 0 ? devices[keys[0]] : null;
        } catch (error) {
            // getDriver throws if the driver is not ready yet, which it is not
            // during the first moments after boot.
            return null;
        }
    }

}

module.exports = APManager;
