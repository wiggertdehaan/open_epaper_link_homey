'use strict';

const TagManager = require('./tagManager');
const APManager = require('./apManager');

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
    
    this.tagManager = new TagManager(this);
    this.APManager = new APManager(this);
    this.tagTypeCache = {};
    
    this.WebSocketReader();

    const card = this.homey.flow.getActionCard('writemessage');
    const cardShowCurrentDate = this.homey.flow.getActionCard('show-current-date');
    const cardShowCurrentWeather = this.homey.flow.getActionCard('show-current-weather');
  }



   extractName(str) {
    let parts = str.split(' (');
    return parts[0].trim(); 
  }


  async fetchTags() {
    try {

      const gateway = this.homey.settings.get('gateway');
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

  socket.on('message', (data) => {
    const messageString = data.toString();

    // Probeer het bericht te parsen als JSON
    try {
        const messageJSON = JSON.parse(messageString);
        // check if messageJSON starts with msg.tags
        if (messageJSON.tags)
        {
          this.updateHomeyTags(messageJSON.tags);
          this.tagManager.updateTags(messageJSON.tags);
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

updateHomeyTags(tags)
{
  this.log('updating Tags');
  tags.forEach(tag => {
    this.updateHomeyTag([tag]);
  }); 
}


updateHomeyTag(tag)
{
  
  this.log('updating Tag '+tag[0].mac);
  let drivers = this.homey.drivers.getDrivers();
  Object.keys(drivers).forEach((id) => {
    let driver = drivers[id];
    let devices = driver.getDevices();
    
    Object.keys(devices).forEach(async (id)=>{
      let device = devices[id];
      let { id: deviceId } = device.getData();
      if (tag[0].mac==deviceId)
      {
        device.updateFromRouter(tag[0])
        .then(() => {
          //this.log('Device bijgewerkt');
        })

        device.setCapabilityValue("measure_temperature",tag[0].temperature)
        .then(() => {
          //this.log('Capability bijgewerkt');
        })
        .catch(error => {
          this.log('Fout bij het bijwerken van capability:', error);
        });

        device.setCapabilityValue("measure_battery",((tag[0].batteryMv/1000)-2.20)*250)
        .then(() => {
          //this.log('Capability bijgewerkt');
        })
        .catch(error => {
          this.log('Fout bij het bijwerken van capability:', error);
        });


        // set alarm_battery to true if && (batteryMv >= 2400 || batteryMv == 0 || batteryMv == 1337)) show = false;
        if(tag[0].batteryMv <= 2400 || tag[0].batteryMv == 0 || tag[0].batteryMv == 1337)
        {
          device.setCapabilityValue("alarm_battery",true)
          .then(() => {
            //this.log('Capability bijgewerkt');
          })
          .catch(error => {
            this.log('Fout bij het bijwerken van capability:', error);
          }
          );
        }
        else
        {
          device.setCapabilityValue("alarm_battery",false)
          .then(() => {
            //this.log('Capability bijgewerkt');
            })
          .catch(error => {
            this.log('Fout bij het bijwerken van capability:', error);
          }
          );
        }


        let data = await this.getTagTypeData(tag[0].hwType);




      }
    });

  });

}














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


