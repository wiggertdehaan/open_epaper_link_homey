'use strict';

const TagManager = require('./tagManager');
const APManager = require('./apManager');
const CardManager = require('./cardManager');
const imageStore = require('./lib/imageStore');

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
    this.log('MyApp has been initialized');
    
    this.tagManager = new TagManager(this, this.homey.settings.get('gateway'));
    this.APManager = new APManager(this,this.homey.settings.get('gateway'));
    this.cardManager = new CardManager(this,this.homey.settings.get('gateway'));
    this.tagTypeCache = {};
    
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


    cardShowCurrentDate.registerRunListener(async (args, state)=>{
      this.cardManager.cardShowCurrentDate(args, state);
    })

    cardShowCountDays.registerRunListener(async (args, state)=>{
      this.cardManager.cardShowCountDays(args, state);
    })

    cardShowCountHours.registerRunListener(async (args, state)=>{
      this.cardManager.cardShowCountHours(args, state);
    })

    cardShowCurrentWeather.registerRunListener(async (args, state)=>{
      this.cardManager.cardShowCurrentWeather(args, state);
    })

    cardShowWeatherForecast.registerRunListener(async (args, state)=>{
      this.cardManager.cardShowWeatherForecast(args, state);
    })

    cardShowBuienradar.registerRunListener(async (args, state)=>{
      this.cardManager.cardShowBuienradar(args, state);
    })

    // Disabled for now
    // cardShowRSSFeed.registerRunListener(async (args, state)=>{
    //   this.cardManager.cardShowRSSFeed(args, state);
    // })

    cardShowQRCode.registerRunListener(async (args, state)=>{
      this.cardManager.cardShowQRCode(args, state);
    })

    cardShowImage.registerRunListener(async (args, state)=>{
      this.cardManager.cardShowImage(args, state);
    })

    cardHW01Show3Lines.registerRunListener(async (args, state)=>{
      this.cardManager.cardHW01Show3Lines(args, state);
    })

    cardShowRemoteJSON.registerRunListener(async (args, state)=>{
      this.cardManager.cardShowRemoteJSON(args, state);
    })

    cardShowLocalJSON.registerRunListener(async (args, state)=>{
      this.cardManager.cardShowLocalJSON(args, state);
    })


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
      this.log('Fetching tags from gateway'+gateway);
      if (!gateway) {
       this.log('gateway has not been configured.');
       return [];
      }
      try {
        const response = await axios.get('http://'+gateway+'/get_db?pos=<continu>'); 

        if (response.data && response.data.tags) {
          return response.data.tags;
        } else {
          throw new Error('Geen tags gevonden in de respons');
        }
      } catch (error) {
        this.log('Geen tags gevonden in de respons');
        return [];
      }
    } catch (error) {
      console.log('Fout bij het ophalen van de tags:', error);
      return [];
    }
  }



WebSocketReader() {
  if (this.socket) {
    this.socket.close();  // Sluit de oude WebSocket-verbinding als die bestaat
  }

  const socket = new WebSocket('ws://'+this.homey.settings.get('gateway')+'/ws');

  // socket.on('open', () => {
  //     this.log('websocket connected');
  // });

  socket.on('message', async (data) => {
    const messageString = data.toString();

    // Probeer het bericht te parsen als JSON
    try {
        const messageJSON = JSON.parse(messageString);
        // check if messageJSON starts with msg.tags
        if (messageJSON.tags)
        {
          // call getTagTypeData async
          let tagType = await this.getTagTypeData(messageJSON.tags[0].hwType);
          let homeyImage = await this.homey.images.createImage();
          let drivers = this.homey.drivers.getDrivers();
          this.tagManager.updateTags(messageJSON.tags, drivers, tagType,homeyImage);
        }
        if (messageJSON.sys)
        {
          this.APManager.updateAPs(messageJSON.sys);
        }

        //this.log(messageJSON);
    } catch (error) {
        this.log('Error parsing JSON:', error);
        this.log('Received data:', messageString);
    }
  });

  socket.on('close', () => {
      this.log('websocket disconnected, attempting to reconnect');
      setTimeout(() => this.WebSocketReader(), 5000); // Aangepast om de functie correct opnieuw aan te roepen
  });

  socket.on('error', (error) => {
      this.log('WebSocket error:', error);
  });
}


/**** CARDs */



async getTagTypeData(hwtype) {
  // Check if the data is already in the cache
  if (this.tagTypeCache[hwtype]) {
      return this.tagTypeCache[hwtype];
  }

  // Data is not in the cache, fetch it from the gateway
  try {
      const url = 'http://'+this.homey.settings.get('gateway')+'/tagtypes/'+hwtype.toString(16).padStart(2, '0').toUpperCase()+'.json';
      this.log('Fetching tagtype data from gateway:', url);
      try {
        const response = await fetch(url);
        if (!response.ok) {
           throw new Error(`Error fetching tagtype data for hwtype ${hwtype}`);
        }
        const data = await response.json();
        this.tagTypeCache[hwtype] = data;
        return data;
      } catch (error) {
        console.error('Error while fetching tagtype data:', error);
        throw error; // 
      }
  } catch (error) {
      console.error(error);
      // Optionally handle the error, e.g., return default values
  }
}

  
}



module.exports = MyApp;


