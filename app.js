'use strict';

const Homey = require('homey');
const WebSocket = require('ws');
const path = require('path');
const TagManager = require('./tagManager');
const APManager = require('./apManager');
const CardManager = require('./cardManager');
const { fetchAllTags } = require('./lib/apClient');
const { normalizeGateway, readGateway } = require('./lib/gateway');
const { devicesByMac, normalizeMac } = require('./lib/devices');
const { TagTypeStore } = require('./lib/tagTypes');
const imageStore = require('./lib/imageStore');
const tagTimeout = require('./lib/tagTimeout');
const apDiscovery = require('./lib/apDiscovery');

// Downloaded tag type definitions are cached here. The app directory itself
// is read-only on Homey, so this has to live under /userdata.
const TAGTYPE_CACHE_DIR = '/userdata/tagtypes';

// The AP sends a `sys` frame every few seconds, so a connection that has been
// silent this long is dead even if TCP has not noticed: an AP that loses power
// or Wi-Fi never closes the connection, and without this the app would wait
// on it forever while every tag stopped updating.
const WS_IDLE_TIMEOUT_MS = 60 * 1000;
// Silent for this long, ping it; the pong counts as a sign of life.
const WS_PING_AFTER_MS = 20 * 1000;
const WS_WATCHDOG_INTERVAL_MS = 10 * 1000;
const WS_HANDSHAKE_TIMEOUT_MS = 15 * 1000;

// Reconnect delay: starts short, doubles on each failure, resets once a
// connection opens. An AP that is off for a day is not asked every 5 seconds.
const WS_RECONNECT_MIN_MS = 5 * 1000;
const WS_RECONNECT_MAX_MS = 5 * 60 * 1000;

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp is being initialized');

    const gateway = this.getGateway();
    if (!gateway) {
      this.log('Warning: Gateway is not configured. Some functionality will not work.');
    } else {
      this.log(`Gateway is configured at: ${gateway}`);
    }

    this.tagTypes = new TagTypeStore({
      cacheDir: TAGTYPE_CACHE_DIR,
      bundledDir: path.join(__dirname, 'assets', 'tagtypes'),
      getGateway: () => this.getGateway(),
      log: (...args) => this.log(...args),
    });

    this.tagManager = new TagManager(this);
    this.APManager = new APManager(this);
    this.cardManager = new CardManager(this);

    // Hint periodic garbage collection, where the runtime exposes it
    try {
      if (global.gc) {
        this.gcInterval = this.homey.setInterval(() => {
          try {
            global.gc();
            this.log('Manual garbage collection executed');
          } catch (e) {
            this.log('Error during garbage collection:', e);
          }
        }, 300000); // every 5 minutes
      }
    } catch {
      this.log('Garbage collection is not available');
    }

    // The gateway used to be read once here and never again, so entering or
    // correcting the AP address in the settings page had no effect until the
    // app was restarted. Re-read it whenever it changes and reconnect.
    const onGatewayChanged = (key) => {
      if (key !== 'gateway') return;
      this.log('Gateway setting changed to:', this.getGateway());
      this.tagTypes.clear();
      this.reconnectDelayMs = WS_RECONNECT_MIN_MS;
      this.WebSocketReader();
    };
    this.homey.settings.on('set', onGatewayChanged);
    this.homey.settings.on('unset', onGatewayChanged);

    this.reconnectDelayMs = WS_RECONNECT_MIN_MS;
    this.wsIdleTimeoutMs = WS_IDLE_TIMEOUT_MS;
    this.wsPingAfterMs = WS_PING_AFTER_MS;
    this.wsWatchdog = this.homey.setInterval(() => this.checkSocket(), WS_WATCHDOG_INTERVAL_MS);

    // Registered before the websocket starts, so the button trigger exists by
    // the time the first frame arrives.
    this.initActionCards();

    this.WebSocketReader();

    // A tag that stops reporting produces no websocket message - that is what
    // going quiet means - so the only way to notice is to ask the AP for its
    // tag list on a timer and compare against the clock.
    this.tagTimeoutTrigger = this.homey.flow.getDeviceTriggerCard('tag-timed-out');
    this.timeoutInterval = this.homey.setInterval(() => {
      this.checkTagTimeouts().catch((error) => this.error('Tag timeout check failed:', error));
    }, 5 * 60 * 1000);

    // A device removed while the app was not running never gets its onDeleted
    // hook, so its screenshot survives. Sweep those shortly after boot and
    // once a day after that.
    this.cleanupTimeout = this.homey.setTimeout(() => {
      this.cleanupImages().catch((error) => this.error('Initial image cleanup failed:', error));
    }, 60 * 1000);
    this.cleanupInterval = this.homey.setInterval(() => {
      this.cleanupImages().catch((error) => this.error('Scheduled image cleanup failed:', error));
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * The AP address to talk to, normalised, or null if none is usable. The one
   * place every part of the app reads it from, so none can hold a stale copy.
   */
  getGateway() {
    return readGateway(this.homey);
  }

  /**
   * Stores a new AP address, from the settings page.
   *
   * @param {string} value  as typed; empty clears it
   * @returns {string|null} the address as stored
   * @throws when the value is not an address at all
   */
  setGateway(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
      this.homey.settings.unset('gateway');
      return null;
    }

    const gateway = normalizeGateway(raw);
    if (!gateway) {
      throw new Error(this.homey.__('errors.invalidGateway', { value: raw }));
    }
    this.homey.settings.set('gateway', gateway);
    return gateway;
  }

  /** Now, on the AP's clock. Tag timestamps from the AP are on that clock. */
  apNow() {
    return this.APManager ? this.APManager.apNow() : Date.now();
  }

  // Registers every action card's handler
  initActionCards() {
    const cardShowLocalJSON = this.homey.flow.getActionCard('show-local-json-template');
    const cardShowRemoteJSON = this.homey.flow.getActionCard('show-remote-jsontemplate');
    const cardShowCurrentDate = this.homey.flow.getActionCard('show-current-date');
    const cardShowCountDays = this.homey.flow.getActionCard('show-count-days');
    const cardShowCountHours = this.homey.flow.getActionCard('show-count-hours');
    const cardShowCurrentWeather = this.homey.flow.getActionCard('show-current-weather');
    const cardShowWeatherForecast = this.homey.flow.getActionCard('show-weather-forecast');
    const cardShowBuienradar = this.homey.flow.getActionCard('show-buienradar');
    // const cardShowRSSFeed = this.homey.flow.getActionCard('show-rss-feed');
    const cardShowQRCode = this.homey.flow.getActionCard('show-qr-code');
    const cardShowImage = this.homey.flow.getActionCard('show-image');
    const cardHW01Show3Lines = this.homey.flow.getActionCard('hw01-show-3Lines');
    const cardLedFlash = this.homey.flow.getActionCard('led-flash');

    // Held on the app so TagManager can fire it when a tag reports that a
    // button press is what woke it up.
    this.buttonPressedTrigger = this.homey.flow.getDeviceTriggerCard('button-pressed');

    this.registerActionCardHandler(cardShowCurrentDate, this.cardManager.cardShowCurrentDate.bind(this.cardManager));
    this.registerActionCardHandler(cardShowCountDays, this.cardManager.cardShowCountDays.bind(this.cardManager));
    this.registerActionCardHandler(cardShowCountHours, this.cardManager.cardShowCountHours.bind(this.cardManager));
    this.registerActionCardHandler(cardShowCurrentWeather, this.cardManager.cardShowCurrentWeather.bind(this.cardManager));
    this.registerActionCardHandler(cardShowWeatherForecast, this.cardManager.cardShowWeatherForecast.bind(this.cardManager));
    this.registerActionCardHandler(cardShowBuienradar, this.cardManager.cardShowBuienradar.bind(this.cardManager));
    this.registerActionCardHandler(cardShowQRCode, this.cardManager.cardShowQRCode.bind(this.cardManager));
    this.registerActionCardHandler(cardShowImage, this.cardManager.cardShowImage.bind(this.cardManager));
    this.registerActionCardHandler(cardHW01Show3Lines, this.cardManager.cardHW01Show3Lines.bind(this.cardManager));
    this.registerActionCardHandler(cardShowRemoteJSON, this.cardManager.cardShowRemoteJSON.bind(this.cardManager));
    this.registerActionCardHandler(cardShowLocalJSON, this.cardManager.cardShowLocalJSON.bind(this.cardManager));
    this.registerActionCardHandler(cardLedFlash, this.cardManager.cardLedFlash.bind(this.cardManager));
  }

  // Logs a failing card and passes the error on, so Homey marks the flow
  // card as failed and shows the message; swallowing it made every card
  // look successful.
  registerActionCardHandler(card, handlerFunction) {
    card.registerRunListener(async (args, state) => {
      try {
        return await handlerFunction(args, state);
      } catch (error) {
        this.log(`Error executing action card ${card.id || ''}: ${error.message}`);
        throw error;
      }
    });
  }

  /**
   * Looks for an OpenEPaperLink AP on the same network as this Homey.
   *
   * Typing the AP's address by hand means finding it first, which is the whole
   * of issue #18 and a fair part of the confusion in #28. There is no mDNS
   * record to look up, so this sweeps the Homey's own /24; see
   * lib/apDiscovery.js for how it narrows that down.
   *
   * @returns {Promise<{subnet:string|null, found:Array<object>}>}
   */
  async discoverGateway() {
    const localAddress = await this.homey.cloud.getLocalAddress();
    this.log('Looking for an AP from', localAddress);

    const found = await apDiscovery.discover(localAddress, { log: (message) => this.log(message) });

    if (found.length === 0) {
      this.log('No AP found on this network');
    }

    return { subnet: apDiscovery.subnetOf(localAddress), found };
  }

  /**
   * Asks the AP for its tag list and fires the timeout trigger for paired tags
   * that have gone quiet past their grace period.
   *
   * State is held so the card fires on the transition rather than every five
   * minutes for as long as a tag stays away, and so a tag that comes back can
   * trigger again if it goes quiet a second time. It is kept in the device
   * store, not in memory, so an app restart does not fire it again for a tag
   * that was already reported.
   */
  async checkTagTimeouts() {
    const gateway = this.getGateway();
    if (!gateway) return;

    let tags;
    try {
      tags = await fetchAllTags(gateway);
    } catch (error) {
      // The AP being unreachable is not the same as a tag going quiet, and
      // reporting every tag as timed out because of it would be worse than
      // saying nothing.
      this.log('Timeout check skipped, could not reach the AP:', error.message);
      return;
    }

    const devices = devicesByMac(this.homey);
    // The AP's timestamps are on its own clock; compare them against that.
    const now = this.apNow();

    for (const tag of tags) {
      const mac = normalizeMac(tag.mac);
      for (const device of devices.get(mac) || []) {
        // eslint-disable-next-line no-await-in-loop
        await this.applyTagTimeout(device, tag, now);
      }
    }
  }

  async applyTagTimeout(device, tag, now) {
    const timedOut = tagTimeout.isTimedOut(tag, now);
    const wasTimedOut = device.getStoreValue('timedOut') === true;
    if (timedOut === wasTimedOut) return;

    try {
      await device.setStoreValue('timedOut', timedOut);
    } catch (error) {
      this.log(`Could not store the timeout state for ${tag.mac}:`, error.message);
    }

    if (!timedOut) {
      this.log(`Tag ${tag.mac} is checking in again`);
      return;
    }

    const overdue = tagTimeout.overdueMinutes(tag, now);
    this.log(`Tag ${tag.mac} has not checked in, ${overdue} minute(s) past due`);
    this.tagTimeoutTrigger.trigger(device, { overdue }).catch((error) => {
      this.log(`Could not fire the timeout trigger for ${tag.mac}:`, error.message);
    });
  }

  /**
   * What the app's screenshot files look like on disk. Used by the settings
   * page so the numbers shown are the real ones.
   */
  async getImageStorageReport() {
    return imageStore.report(this.homey);
  }

  /**
   * Deletes screenshots that no paired device owns. See lib/imageStore.js for
   * the rules; in short, only `scr_<mac>.png` files in the app's own
   * directories are considered, files belonging to a paired device are always
   * kept, and files touched in the last hour are always kept.
   */
  async cleanupImages(options = {}) {
    const before = imageStore.report(this.homey);
    const result = imageStore.cleanup(this.homey, options);

    // Logged unconditionally: it runs at boot and then once a day, so it is
    // not noisy, and it is the only way to see what the store looks like.
    this.log(`Image cleanup${options.dryRun ? ' (dry run)' : ''}:`
      + ` found ${before.files} screenshot(s) / ${before.bytes} bytes`
      + ` across ${JSON.stringify(before.byDir)}`
      + `, ${before.paired} paired device(s)`
      + ` -> removed ${result.deleted} (${result.bytes} bytes),`
      + ` kept ${result.kept}, failed ${result.failed}`);

    return { ...result, before };
  }

  async fetchTags() {
    const gateway = this.getGateway();
    this.log(`Fetching tags from gateway: ${gateway}`);
    if (!gateway) {
      this.log('Gateway is not configured.');
      return [];
    }

    try {
      // The AP returns a page of tags at a time; walk them all. This
      // replaces an earlier cap of 100 tags, which was a memory workaround
      // for a call that could only ever see the first page anyway.
      return await fetchAllTags(gateway);
    } catch (error) {
      this.log('Could not fetch the tag list:', error.message);
      return [];
    }
  }

  /**
   * Drops the current socket, if any, without letting it do anything else.
   */
  closeSocket() {
    const { socket } = this;
    if (!socket) return;
    this.socket = null;

    // removeAllListeners first: the old socket's 'close' handler would
    // otherwise schedule a reconnect of its own.
    socket.removeAllListeners();
    // A socket torn down mid-handshake still emits 'error' ("closed before
    // the connection was established") on the next tick. With no listener
    // left that is an uncaught exception, which takes the whole app down -
    // and mid-handshake is exactly where it sits when the configured address
    // is wrong and the user is correcting it.
    socket.on('error', () => {});
    try {
      socket.terminate();
    } catch (error) {
      this.log('Error closing WebSocket connection:', error.message);
    }
  }

  scheduleReconnect() {
    if (this.uninitialized || this.reconnectTimeout) return;

    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(WS_RECONNECT_MAX_MS, delay * 2);
    this.log(`Reconnecting to the websocket in ${Math.round(delay / 1000)} s`);

    this.reconnectTimeout = this.homey.setTimeout(() => {
      this.reconnectTimeout = null;
      this.WebSocketReader();
    }, delay);
  }

  /**
   * Called on a timer: pings a quiet connection and drops a dead one, which
   * then reconnects through the usual 'close' path.
   */
  checkSocket() {
    const { socket } = this;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const idle = Date.now() - this.lastSocketActivity;
    if (idle > this.wsIdleTimeoutMs) {
      this.log(`No word from the AP for ${Math.round(idle / 1000)} s, dropping the connection`);
      socket.terminate();
      return;
    }

    if (idle > this.wsPingAfterMs) {
      try {
        socket.ping();
      } catch {
        // the idle timeout will deal with it
      }
    }
  }

  WebSocketReader() {
    if (this.reconnectTimeout) {
      this.homey.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.closeSocket();

    if (this.uninitialized) return;

    const gateway = this.getGateway();
    if (!gateway) {
      // Without an address there is nothing to connect to; retrying every few
      // seconds against `ws://null/ws` only fills the log with ENOTFOUND. The
      // settings listener in onInit reconnects once an address is set.
      this.log('Gateway has not been configured, not connecting. Set the AP address in the app settings.');
      return;
    }

    const url = `ws://${gateway}/ws`;
    this.log('Connecting to websocket:', url);
    const socket = new WebSocket(url, { handshakeTimeout: WS_HANDSHAKE_TIMEOUT_MS });
    this.socket = socket;
    this.lastSocketActivity = Date.now();

    const alive = () => {
      this.lastSocketActivity = Date.now();
    };

    socket.on('open', () => {
      alive();
      this.reconnectDelayMs = WS_RECONNECT_MIN_MS;
      this.log('websocket connected to', url);
    });

    socket.on('pong', alive);

    socket.on('message', (data) => {
      alive();
      const messageString = data.toString();

      try {
        const messageJSON = JSON.parse(messageString);

        if (messageJSON.sys) {
          // First, so the AP's clock is known before tag timestamps from the
          // same frame are compared against it.
          this.APManager.updateAPs(messageJSON.sys);
        }

        if (messageJSON.tags) {
          // One message can contain tags of different hardware types, so the
          // type is resolved per tag rather than taken from the first one.
          const drivers = this.homey.drivers.getDrivers();
          this.tagManager.updateTags(messageJSON.tags, drivers, (hwType) => this.getTagTypeData(hwType))
            .catch((error) => this.log('Error processing tag update:', error));
        }
      } catch (error) {
        this.log('Error parsing JSON:', error);
        this.log('Received data:', messageString);
      }
    });

    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.log('websocket disconnected');
      this.scheduleReconnect();
    });

    socket.on('error', (error) => {
      this.log('WebSocket error:', error.message || error);
      // The 'close' event that follows does the reconnect
    });
  }

  /**
   * The tag type definition for a hardware type, or null when none can be
   * found. See lib/tagTypes.js for where it comes from.
   */
  async getTagTypeData(hwtype) {
    return this.tagTypes.get(hwtype);
  }

  /**
   * onUninit is called when the app is destroyed (eg. on disable/update), so
   * the websocket connection and every timer stop with it.
   */
  async onUninit() {
    this.log('MyApp is shutting down');

    // Stops the socket's 'close' handler from scheduling another reconnect.
    this.uninitialized = true;

    if (this.reconnectTimeout) {
      this.homey.clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.wsWatchdog) {
      this.homey.clearInterval(this.wsWatchdog);
      this.wsWatchdog = null;
    }

    // Poll that looks for tags which stopped checking in
    if (this.timeoutInterval) {
      this.homey.clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
    }

    // Screenshot sweep, both the delayed first run and the daily one
    if (this.cleanupTimeout) {
      this.homey.clearTimeout(this.cleanupTimeout);
      this.cleanupTimeout = null;
    }
    if (this.cleanupInterval) {
      this.homey.clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.closeSocket();
    this.log('WebSocket connection closed');

    // Stop the garbage collection interval
    if (this.gcInterval) {
      this.homey.clearInterval(this.gcInterval);
      this.gcInterval = null;
      this.log('Garbage collection interval stopped');
    }

    if (this.tagTypes) this.tagTypes.clear();

    // One last garbage collection, where available
    try {
      if (global.gc) {
        global.gc();
        this.log('Final garbage collection performed');
      }
    } catch (e) {
      this.log('Error during final garbage collection:', e);
    }
  }

}

MyApp.WS_RECONNECT_MIN_MS = WS_RECONNECT_MIN_MS;
MyApp.WS_RECONNECT_MAX_MS = WS_RECONNECT_MAX_MS;

module.exports = MyApp;
