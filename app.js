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
    
    this.WebSocketReader();

    const card = this.homey.flow.getActionCard('writemessage');
    const cardShowCurrentDate = this.homey.flow.getActionCard('show-current-date');
    const cardShowCountDays = this.homey.flow.getActionCard('show-count-days');
    const cardShowCountHours = this.homey.flow.getActionCard('show-count-hours');
    const cardShowCurrentWeather = this.homey.flow.getActionCard('show-current-weather');


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

  }


  async fetchTags() {
    try {

      
      const gateway = this.homey.settings.get('gateway');
      this.log('Fetching tags from gateway'+gateway);
      if (!gateway) {
      this.log('gateway has not been configured.');
      return;
      }
      const response = await axios.get('http://'+gateway+'/get_db'); 
  

      if (response.data && response.data.tags) {
        return response.data.tags;
      } else {
        throw new Error('Geen tags gevonden in de respons');
      }
    } catch (error) {
      console.error('Fout bij het ophalen van de tags:', error);
      throw error; // 
    }
  }



WebSocketReader() {
  this.log("Starting WebsocketReader");
  const socket = new WebSocket('ws://'+this.homey.settings.get('gateway')+'/ws');

  socket.on('open', () => {
      this.log('websocket connected');
  });

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
      const response = await fetch(url);
      if (!response.ok) {
          throw new Error(`Error fetching tagtype data for hwtype ${hwtype}`);
      }
      const data = await response.json();

      // Save the fetched data in the cache
      this.tagTypeCache[hwtype] = data;
      return data;
  } catch (error) {
      console.error(error);
      // Optionally handle the error, e.g., return default values
  }
}

  
}



module.exports = MyApp;


