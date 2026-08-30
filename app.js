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
    this.log('MyApp has been initialized');
    
    this.tagManager = new TagManager(this, this.homey.settings.get('gateway'));
    this.APManager = new APManager(this,this.homey.settings.get('gateway'));
    this.cardManager = new CardManager(this,this.homey.settings.get('gateway'));
    this.tagTypeCache = {};

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

    this.WebSocketReader();

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
  if (this.reconnectTimeout) {
    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
  }

  if (this.socket) {
    this.socket.removeAllListeners();
    this.socket.close();
    this.socket = null;
  }

  const gateway = this.homey.settings.get('gateway');
  if (!gateway) {
    // Without an address there is nothing to connect to; retrying every few
    // seconds against `ws://null/ws` just fills the log with ENOTFOUND.
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

    // Probeer het bericht te parsen als JSON
    try {
        const messageJSON = JSON.parse(messageString);
        // check if messageJSON starts with msg.tags
        if (messageJSON.tags)
        {
          // One message can contain tags of different hardware types, so the
          // type is resolved per tag rather than taken from the first one.
          const drivers = this.homey.drivers.getDrivers();
          this.tagManager.updateTags(messageJSON.tags, drivers, (hwType) => this.getTagTypeData(hwType));
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
      if (this.uninitialized) return;
      this.reconnectTimeout = setTimeout(() => this.WebSocketReader(), 5000);
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

  const gateway = this.homey.settings.get('gateway');
  if (!gateway) return null;

  // Data is not in the cache, fetch it from the gateway
  const url = 'http://'+gateway+'/tagtypes/'+hwtype.toString(16).padStart(2, '0').toUpperCase()+'.json';
  try {
    this.log('Fetching tagtype data from gateway:', url);
    const response = await axios.get(url, { timeout: 10000 });
    this.tagTypeCache[hwtype] = response.data;
    return response.data;
  } catch (error) {
    // Returning null (instead of undefined via a swallowed throw) lets the
    // caller skip this tag cleanly rather than crash on tagType.width.
    this.log('Error while fetching tagtype data for hwType ' + hwtype + ':', error.message);
    return null;
  }
}

  
}



module.exports = MyApp;


