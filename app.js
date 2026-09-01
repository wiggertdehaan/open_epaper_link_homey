'use strict';

const TagManager = require('./tagManager');
const APManager = require('./apManager');
const CardManager = require('./cardManager');
const { fetchAllTags } = require('./lib/apClient');
const imageStore = require('./lib/imageStore');

const Homey = require('homey');
const axios = require('axios');
const WebSocket = require('ws');
const Jimp = require('jimp');
const qs = require('qs');
const { Readable } = require('stream'); 
const fs = require('fs');
const path = require('path');

// Downloaded tag type definitions are cached here. The app directory itself
// is read-only on Homey, so this has to live under /userdata.
const TAGTYPE_CACHE_DIR = '/userdata/tagtypes';

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp is being initialized');
    
    // Controleer of de gateway is ingesteld
    const gateway = this.homey.settings.get('gateway');
    if (!gateway) {
      this.log('Warning: Gateway is not configured. Some functionality will not work.');
    } else {
      this.log('Gateway is configured at: ' + gateway);
    }
    
    // Initialiseer de managers
    this.tagManager = new TagManager(this, gateway);
    this.APManager = new APManager(this, gateway);
    this.cardManager = new CardManager(this, gateway);
    
    // Initialiseer of reset de cache
    this.tagTypeCache = {};

    // Configureer garbage collection hint (indien beschikbaar in Node.js)
    try {
      if (global.gc) {
        // Plan periodieke garbage collection
        this.gcInterval = setInterval(() => {
          try {
            global.gc();
            this.log('Manual garbage collection executed');
          } catch (e) {
            this.log('Error during garbage collection:', e);
          }
        }, 300000); // Elke 5 minuten
      }
    } catch (e) {
      this.log('Garbage collection is not available');
    }

    // The gateway used to be read once here and never again, so entering or
    // correcting the AP address in the settings page had no effect until the
    // app was restarted. Re-read it whenever it changes and reconnect.
    this.homey.settings.on('set', (key) => {
      if (key !== 'gateway') return;
      const gateway = this.homey.settings.get('gateway');
      this.log('Gateway setting changed to:', gateway);
      this.tagTypeCache = {};
      if (this.tagManager) this.tagManager.setGateway(gateway);
      if (this.APManager) this.APManager.gateway = gateway;
      if (this.cardManager) this.cardManager.gateway = gateway;
      this.WebSocketReader();
    });

    // Start WebSocket lezer
    this.WebSocketReader();

    // A device removed while the app was not running never gets its onDeleted
    // hook, so its screenshot survives. Sweep those shortly after boot and
    // once a day after that.
    this.cleanupTimeout = this.homey.setTimeout(() => {
      this.cleanupImages().catch((error) => this.error('Initial image cleanup failed:', error));
    }, 60 * 1000);
    this.cleanupInterval = this.homey.setInterval(() => {
      this.cleanupImages().catch((error) => this.error('Scheduled image cleanup failed:', error));
    }, 24 * 60 * 60 * 1000);

    // Initialiseer alle action cards
    this.initActionCards();
  }

  // Nieuwe methode om action cards te initialiseren (zorgt voor betere organisatie)
  initActionCards() {
    const cardShowLocalJSON = this.homey.flow.getActionCard('show-local-json-template');
    const cardShowRemoteJSON = this.homey.flow.getActionCard('show-remote-jsontemplate');
    const cardShowCurrentDate = this.homey.flow.getActionCard('show-current-date');
    const cardShowCountDays = this.homey.flow.getActionCard('show-count-days');
    const cardShowCountHours = this.homey.flow.getActionCard('show-count-hours');
    const cardShowCurrentWeather = this.homey.flow.getActionCard('show-current-weather');
    const cardShowWeatherForecast = this.homey.flow.getActionCard('show-weather-forecast');
    const cardShowBuienradar = this.homey.flow.getActionCard('show-buienradar');
    //const cardShowRSSFeed = this.homey.flow.getActionCard('show-rss-feed');
    const cardShowQRCode = this.homey.flow.getActionCard('show-qr-code');
    const cardShowImage = this.homey.flow.getActionCard('show-image');
    const cardHW01Show3Lines = this.homey.flow.getActionCard('hw01-show-3Lines');
    const cardLedFlash = this.homey.flow.getActionCard('led-flash');

    // Held on the app so TagManager can fire it when a tag reports that a
    // button press is what woke it up.
    this.buttonPressedTrigger = this.homey.flow.getDeviceTriggerCard('button-pressed');

    // Registreer action card handlers met try-catch blokken
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

  // Helper methode om action card handlers te registreren met foutafhandeling
  registerActionCardHandler(card, handlerFunction) {
    card.registerRunListener(async (args, state) => {
      try {
        await handlerFunction(args, state);
      } catch (error) {
        this.log(`Error executing action card: ${error.message}`);
      }
    });
  }

  /**
   * onUninit is called when the app is destroyed (eg. on disable/update), so
   * the websocket connection and any pending reconnect timer do not outlive
   * the app instance.
   */
  async onUninit() {
    this.uninitialized = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.socket) {
      this.socket.close();
    }
  }

  /**
   * onUninit is called when the app is destroyed (eg. on disable/update).
   */
  async onUninit() {
    if (this.cleanupTimeout) {
      this.homey.clearTimeout(this.cleanupTimeout);
    }
    if (this.cleanupInterval) {
      this.homey.clearInterval(this.cleanupInterval);
    }
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
    try {
      const gateway = this.homey.settings.get('gateway');
      this.log('Fetching tags from gateway: ' + gateway);
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
    } catch (error) {
      this.log('Error fetching tags:', error);
      return [];
    }
  }

  WebSocketReader() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      // removeAllListeners before closing: the old socket's 'close' handler
      // would otherwise schedule a second reconnect and they would stack up.
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }

    const gateway = this.homey.settings.get('gateway');
    if (!gateway) {
      // Without an address there is nothing to connect to; retrying every few
      // seconds against `ws://null/ws` only fills the log with ENOTFOUND. The
      // settings listener in onInit reconnects once an address is set.
      this.log('Gateway has not been configured, not connecting. Set the AP address in the app settings.');
      return;
    }

    const url = 'ws://' + gateway + '/ws';
    this.log('Connecting to websocket:', url);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on('open', () => {
      this.log('websocket connected to', url);
    });

    socket.on('message', async (data) => {
      const messageString = data.toString();

      try {
        const messageJSON = JSON.parse(messageString);

        if (messageJSON.tags) {
          // One message can contain tags of different hardware types, so the
          // type is resolved per tag rather than taken from the first one.
          const drivers = this.homey.drivers.getDrivers();
          this.tagManager.updateTags(messageJSON.tags, drivers, (hwType) => this.getTagTypeData(hwType));
        }

        if (messageJSON.sys) {
          this.APManager.updateAPs(messageJSON.sys);
        }
      } catch (error) {
        this.log('Error parsing JSON:', error);
        this.log('Received data:', messageString);
      }
    });

    socket.on('close', () => {
      this.log('websocket disconnected, attempting to reconnect');
      if (this.uninitialized) return;
      this.reconnectTimeout = setTimeout(() => this.WebSocketReader(), 5000);
    });

    socket.on('error', (error) => {
      this.log('WebSocket error:', error);
      // Laat de 'close' event handler de reconnect doen
    });
  }

  async getTagTypeData(hwtype) {
    // Check if hwtype is valid
    if (hwtype === undefined || hwtype === null) {
      this.log('Invalid hwtype: ', hwtype);
      return null;
    }

    // Check if the data is already in the cache
    if (this.tagTypeCache[hwtype]) {
      return this.tagTypeCache[hwtype];
    }

    // Beperk de grootte van de cache om geheugengebruik te beheren
    const maxCacheSize = 20;
    if (Object.keys(this.tagTypeCache).length >= maxCacheSize) {
      // Verwijder de oudste item uit de cache
      const oldestKey = Object.keys(this.tagTypeCache)[0];
      delete this.tagTypeCache[oldestKey];
      this.log('Cache limit reached, oldest item removed: ' + oldestKey);
    }

    // Try to load the tagtype from disk first: a copy written by an earlier
    // fetch, otherwise one of the definitions shipped with the app.
    const hwtypeHex = hwtype.toString(16).padStart(2, '0').toUpperCase();
    const cachedFilePath = path.join(TAGTYPE_CACHE_DIR, `${hwtypeHex}.json`);
    const bundledFilePath = path.join(__dirname, 'assets', 'tagtypes', `${hwtypeHex}.json`);

    for (const filePath of [cachedFilePath, bundledFilePath]) {
      if (!fs.existsSync(filePath)) continue;

      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        this.tagTypeCache[hwtype] = data;
        this.log('Using local tagtype data for hwtype ' + hwtype + ': ' + filePath);
        return data;
      } catch (err) {
        this.log('Error reading local tagtype file ' + filePath + ':', err.message);
        // Fall through to the next location, and to the gateway.
      }
    }

    // Nothing usable on disk, fetch it from the gateway
    const gateway = this.homey.settings.get('gateway');
    if (!gateway) {
      this.log('Gateway is not configured for retrieving tagtype data');
      return null;
    }

    const url = 'http://' + gateway + '/tagtypes/' + hwtypeHex + '.json';
    try {
      this.log('Fetching tagtype data from gateway:', url);

      // axios, not global fetch: fetch ignores a `timeout` option, so the
      // 5 second timeout that used to be passed here never applied.
      const response = await axios.get(url, { timeout: 10000 });
      const data = response.data;

      if (!data || typeof data !== 'object') {
        this.log('Invalid format for tagtype data for hwType ' + hwtype);
        return null;
      }

      this.tagTypeCache[hwtype] = data;

      // Keep a copy so the gateway is not needed for this tag type again
      try {
        fs.mkdirSync(TAGTYPE_CACHE_DIR, { recursive: true });
        fs.writeFileSync(cachedFilePath, JSON.stringify(data, null, 2), 'utf8');
        this.log('Saved tagtype data to:', cachedFilePath);
      } catch (err) {
        this.log('Error saving tagtype data to local file:', err.message);
      }

      return data;
    } catch (error) {
      // Returning null (instead of undefined via a swallowed throw) lets the
      // caller skip this tag cleanly rather than crash on tagType.width.
      this.log('Error while fetching tagtype data for hwType ' + hwtype + ':', error.message);
      return null;
    }
  }

  /**
   * onUninit wordt aangeroepen wanneer de app wordt gestopt.
   */
  async onUninit() {
    this.log('MyApp is shutting down');

    // Stops the socket's 'close' handler from scheduling another reconnect.
    this.uninitialized = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Stop de WebSocket verbinding
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.close();
        this.socket = null;
        this.log('WebSocket connection closed');
      } catch (error) {
        this.log('Error closing WebSocket connection:', error);
      }
    }

    // Stop de garbage collection interval
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.log('Garbage collection interval stopped');
    }

    // Wis caches
    this.tagTypeCache = {};

    // Voer een laatste garbage collection uit indien mogelijk
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

module.exports = MyApp;


