'use strict';

const TagManager = require('./tagManager');
const APManager = require('./apManager');
const CardManager = require('./cardManager');

const Homey = require('homey');
const axios = require('axios');
const WebSocket = require('ws');
const Jimp = require('jimp');
const qs = require('qs');
const { Readable } = require('stream'); 

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
    
    // Start WebSocket lezer
    this.WebSocketReader();

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

  async fetchTags() {
    try {
      const gateway = this.homey.settings.get('gateway');
      this.log('Fetching tags from gateway: ' + gateway);
      if (!gateway) {
        this.log('Gateway is not configured.');
        return [];
      }
      
      try {
        // Verbeterde URL: parameter 'pos' verwijderd, was <continu> wat niet juist lijkt
        // Eventueel een limiet toevoegen met ?limit=50 als dat door de API wordt ondersteund
        const response = await axios.get('http://' + gateway + '/get_db');

        if (response.data && response.data.tags) {
          // Return maximaal 100 tags om geheugengebruik te beperken
          return response.data.tags.slice(0, 100);
        } else {
          this.log('No tags found in response');
          return [];
        }
      } catch (error) {
        this.log('Error fetching tags: ' + error.message);
        return [];
      }
    } catch (error) {
      this.log('Error fetching tags:', error);
      return [];
    }
  }

  WebSocketReader() {
    if (this.socket) {
      try {
        this.socket.terminate(); // Gebruik terminate in plaats van close voor directe afsluiting
        this.socket = null;
      } catch (error) {
        this.log('Error closing existing WebSocket connection:', error);
      }
    }

    const gateway = this.homey.settings.get('gateway');
    if (!gateway) {
      this.log('WebSocketReader: Gateway is not configured, retrying in 30 seconds');
      setTimeout(() => this.WebSocketReader(), 30000);
      return;
    }

    try {
      this.socket = new WebSocket('ws://' + gateway + '/ws');

      this.socket.on('open', () => {
        this.log('WebSocket connected to gateway');
      });

      this.socket.on('message', async (data) => {
        try {
          const messageString = data.toString();
          const messageJSON = JSON.parse(messageString);
          
          // Beperken van aantal tags in geheugen
          if (messageJSON.tags && Array.isArray(messageJSON.tags)) {
            const tagLimit = 10; // Verwerk maximaal 10 tags tegelijk
            const tagsToProcess = messageJSON.tags.slice(0, tagLimit);
            
            if (tagsToProcess.length > 0) {
              try {
                let tagType = await this.getTagTypeData(tagsToProcess[0].hwType);
                let homeyImage = await this.homey.images.createImage();
                let drivers = this.homey.drivers.getDrivers();
                this.tagManager.updateTags(tagsToProcess, drivers, tagType, homeyImage);
              } catch (innerError) {
                this.log('Error processing tags:', innerError);
              }
            }
          }
          
          if (messageJSON.sys) {
            try {
              this.APManager.updateAPs(messageJSON.sys);
            } catch (innerError) {
              this.log('Error updating APs:', innerError);
            }
          }
        } catch (error) {
          this.log('Error processing WebSocket message:', error);
        }
      });

      this.socket.on('close', (code, reason) => {
        this.log(`WebSocket connection closed with code ${code}, reason: ${reason || 'unknown'}, reconnecting in 5 seconds`);
        this.socket = null;
        setTimeout(() => this.WebSocketReader(), 5000);
      });

      this.socket.on('error', (error) => {
        this.log('WebSocket error:', error);
        // Laat de 'close' event handler de reconnect doen
      });
    } catch (error) {
      this.log('Error setting up WebSocket connection:', error);
      setTimeout(() => this.WebSocketReader(), 10000);
    }
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

    // Data is not in the cache, fetch it from the gateway
    try {
      const gateway = this.homey.settings.get('gateway');
      if (!gateway) {
        this.log('Gateway is not configured for retrieving tagtype data');
        return null;
      }

      const hwtypeHex = hwtype.toString(16).padStart(2, '0').toUpperCase();
      const url = 'http://' + gateway + '/tagtypes/' + hwtypeHex + '.json';
      this.log('Fetching tagtype data from gateway:', url);
      
      try {
        const response = await fetch(url, { 
          method: 'GET',
          timeout: 5000 // Timeout na 5 seconden om hanging requests te voorkomen
        });
        
        if (!response.ok) {
          throw new Error(`Error fetching tagtype data for hwtype ${hwtype}: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Alleen opslaan in cache als het een geldig JSON-object is
        if (data && typeof data === 'object') {
          this.tagTypeCache[hwtype] = data;
          return data;
        } else {
          throw new Error('Invalid format for tagtype data');
        }
      } catch (error) {
        this.log('Error fetching tagtype data:', error.message);
        return null;
      }
    } catch (error) {
      this.log('Error processing tagtype request:', error.message);
      return null;
    }
  }

  /**
   * onUninit wordt aangeroepen wanneer de app wordt gestopt.
   */
  async onUninit() {
    this.log('MyApp is shutting down');
    
    // Stop de WebSocket verbinding
    if (this.socket) {
      try {
        this.socket.terminate();
        this.socket = null;
        this.log('WebSocket connection terminated');
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


