'use strict';

//import { json } from 'stream/consumers';

const Homey = require('homey');
const axios = require('axios');
const WebSocket = require('ws');
const qs = require('qs');

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp has been initialized');
    this.log(this.homey.settings.get('gateway'));
   // this.log(Homey.devices.getDevices());
    
    //this.deviceUpdater();
    this.WebSocketReader();

    const card = this.homey.flow.getActionCard('writemessage');
    const cardShowCurrentDate = this.homey.flow.getActionCard('show-current-date');
    const cardShowCurrentWeather = this.homey.flow.getActionCard('show-current-weather');

    cardShowCurrentWeather.registerRunListener(async (args, state) =>{
  
        
        let aliasName = this.extractName(args.Id.getName());
        let deviceData = args.Id.getData();
        let deviceId = deviceData.id;
        let jsonData =  {"location":args.Location,"units":args.Units};
        const data = {
            alias: aliasName,
            mac: deviceId,
            contentmode: 4,
            modecfgjson: JSON.stringify(jsonData),
            rotate: 0,
            lut:0,
            invert:0
        };
        this.log(data);
        const gateway = this.homey.settings.get('gateway');
        if (!gateway) {
        this.log('gateway has not been configured.');
        return;
        }
        
        this.SaveConfig(gateway, data);


    })

    cardShowCurrentDate.registerRunListener(async (args, state)=>{

        let deviceData = args.Id.getData();
        let deviceId = deviceData.id;
        const data = {
          //  alias: "fenno",
            mac: deviceId,
            contentmode: 1,
            rotate: 0,
            lut:0,
            invert:0
        };
        const gateway = this.homey.settings.get('gateway');
        if (!gateway) {
        this.log('gateway has not been configured.');
        return;
        }
        
        this.SaveConfig(gateway, data);

    })

    card.registerRunListener(async (args, state) =>{
      // Run 
      
      
        let deviceData = args.Id.getData();
        let deviceId = deviceData.id;
        this.log(deviceId);

      const jsonData = [
        { "text": [5, 5, args.Message, "fonts/bahnschrift20", 1] }
        ];

        // Stel de POST-data samen
        const data = {
            mac: deviceId,
            json: JSON.stringify(jsonData)
        };

        const gateway = this.homey.settings.get('gateway');
        if (!gateway) {
        this.log('gateway has not been configured.');
        return;
        }
        
        axios.post('http://'+gateway+'/jsonupload', qs.stringify(data), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
            })
            .then(response => {
                this.log('Succes:', response.data);
            })
            .catch(error => {
                this.error('Fout tijdens de POST-aanvraag:', error);
              }); 
    })
  }

  async SaveConfig(gateway, data){
        axios.post('http://'+gateway+'/save_cfg', data, {
            headers: {
                'Content-Type': 'multipart/form-data;'
            }
            })
            .then(response => {
                this.log('Succes:', response.data);
            })
            .catch(error => {
                this.error('Fout tijdens de POST-aanvraag:', error);
              }); 
       
  }

   extractName(str) {
    // Split de string bij de eerste opening haakje '(' en neem het eerste deel
    let parts = str.split(' (');
    return parts[0].trim(); // Verwijder eventuele spaties aan het einde
  }


  async fetchTags() {
    try {

      const gateway = this.homey.settings.get('gateway');
      if (!gateway) {
      this.log('gateway has not been configured.');
      return;
      }
      // Voer de GET-aanvraag uit
      const response = await axios.get('http://'+gateway+'/get_db'); 
  

      if (response.data && response.data.tags) {
        return response.data.tags;
      } else {
        throw new Error('Geen tags gevonden in de respons');
      }
    } catch (error) {
      console.error('Fout bij het ophalen van de tags:', error);
      throw error; // Of handel de fout af zoals gewenst
    }
  }


  deviceUpdater() {
    setInterval(async () => {
        try {
            this.log("DeviceUpdatr");
            let tags = await this.fetchTags();
      

        } catch (error) {
            this.log('Fout bij het ophalen van tags:', error);
        }
    }, 10000); // 10 seconden interval

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
        this.log(messageJSON);
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

  
}

module.exports = MyApp;
