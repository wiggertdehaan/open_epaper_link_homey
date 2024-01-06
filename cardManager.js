const axios = require('axios');

class CardManager {

    constructor(homey, gateway)
    {
        this.homey = homey; 
   
        this.gateway = gateway;
        this.homey.log('Card constructor gateway: '+this.gateway);
    }


    // {
    //     "id": 1,
    //     "name": "Current date",
    //     "desc": "Shows the current date",
    //     "hwtype": [
    //       0,
    //       1,
    //       2,
    //       5,
    //       17,
    //       49,
    //       51,
    //       240
    //     ],
    //     "param": []
    //   },

    async cardShowCurrentDate(args, state){

        this.homey.log('CardManager: cardShowCurrentDate');
        let deviceData = args.Id.getData();
        let deviceId = deviceData.id;

        let tags = await this.fetchTag(deviceId);
        const FormData = require('form-data');
        let data = new FormData();
        data.append('mac', deviceId);
        data.append('alias', tags[0].alias);
        data.append('contentmode', '1');
        data.append('rotate', '0');
        data.append('lut', '0');
        data.append('invert', '0');
        data.append('modecfgjson', '{}');
        this.SaveConfig(data);
   
    }


    // {
    //     "id": 2,
    //     "name": "Count days",
    //     "desc": "Counts days, starting with the value below. If the count value gets higher than the threshold, the number is displayed in red, otherwise it's black",
    //     "hwtype": [
    //       0,
    //       1,
    //       2,
    //       5,
    //       17,
    //       49,
    //       51,
    //       240
    //     ],
    //     "param": [
    //       {
    //         "key": "counter",
    //         "name": "Counter value",
    //         "desc": "Current value",
    //         "type": "int"
    //       },
    //       {
    //         "key": "thresholdred",
    //         "name": "Threshold",
    //         "desc": "Value is displayed in red if higher than the threshold",
    //         "type": "int",
    //         "hwtype": [
    //           0,
    //           1,
    //           2,
    //           49,
    //           51,
    //           17
    //         ]
    //       }
    //     ]
    //   },

    async cardShowCountDays(args, state){


        this.homey.log('CardManager: cardCountDays');
        this.homey.log('Parameters: '+args.Counter+' '+args.Threshold);
        let deviceData = args.Id.getData();
        let deviceId = deviceData.id;

        let tags = await this.fetchTag(deviceId);
        const FormData = require('form-data');
        let data = new FormData();
        data.append('mac', deviceId);
        data.append('alias', tags[0].alias);
        data.append('contentmode', '2');
        data.append('rotate', '0');
        data.append('lut', '0');
        data.append('invert', '0');
        data.append('modecfgjson', '{}');
        data.append('counter', args.Counter);
        data.append('thresholdred', args.Threshold);
        this.homey.log(' before SaveConfig');
        this.SaveConfig(data);

    }

    // {
    //     "id": 3,
    //     "name": "Count hours",
    //     "desc": "Counts hours, starting with the value below. If the count value gets higher than the threshold, the number is displayed in red, otherwise it's black",
    //     "hwtype": [
    //       0,
    //       1,
    //       2,
    //       5,
    //       17,
    //       49,
    //       51,
    //       240
    //     ],
    //     "param": [
    //       {
    //         "key": "counter",
    //         "name": "Counter",
    //         "desc": "Current value",
    //         "type": "int"
    //       },
    //       {
    //         "key": "thresholdred",
    //         "name": "Threshold",
    //         "desc": "Value is displayed in red if higher than the threshold",
    //         "type": "int",
    //         "hwtype": [
    //           0,
    //           1,
    //           2,
    //           5,
    //           49,
    //           51,
    //           17
    //         ]
    //       }
    //     ]
    //   },

    async cardShowCountHours(args, state){


        this.homey.log('CardManager: cardCountHours');
        this.homey.log('Parameters: '+args.Counter+' '+args.Threshold);
        let deviceData = args.Id.getData();
        let deviceId = deviceData.id;

        let tags = await this.fetchTag(deviceId);
        const FormData = require('form-data');
        let data = new FormData();
        data.append('mac', deviceId);
        data.append('alias', tags[0].alias);
        data.append('contentmode', '3');
        data.append('rotate', '0');
        data.append('lut', '0');
        data.append('invert', '0');
        data.append('modecfgjson', '{}');
        data.append('counter', args.Counter);
        data.append('thresholdred', args.Threshold);
        this.homey.log(' before SaveConfig');
        this.SaveConfig(data);

    }



    // {
    //     "id": 4,
    //     "name": "Current weather",
    //     "desc": "Current weather. Weather data by Open-Meteo.com",
    //     "hwtype": [
    //       0,
    //       1,
    //       2,
    //       5,
    //       17,
    //       49,
    //       51,
    //       240
    //     ],
    //     "param": [
    //       {
    //         "key": "location",
    //         "name": "Location",
    //         "desc": "Name of the city. This is used to lookup the lat/long data, and to display as the title",
    //         "type": "text"
    //       },
    //       {
    //         "key": "#lat",
    //         "name": "Lat",
    //         "desc": "Latitude (set automatic when generating image)",
    //         "type": "ro"
    //       },
    //       {
    //         "key": "#lon",
    //         "name": "Lon",
    //         "desc": "Longitude (set automatic when generating image)",
    //         "type": "ro"
    //       },
    //       {
    //         "key": "units",
    //         "name": "Units",
    //         "desc": "Celcius or Fahrenheit?",
    //         "type": "select",
    //         "options": {
    //           "0": "-Celcius / Beaufort / millimeters",
    //           "1": "Fahrenheit / mph / millimeters"
    //         }
    //       }
    //     ]
    //   },

    async cardShowCurrentWeather(args, state){
            
            this.homey.log('CardManager: cardShowCurrentWeather');
            this.homey.log('Parameters: '+args.Location+' '+args.Units);
            let deviceData = args.Id.getData();
            let deviceId = deviceData.id;
    
            let tags = await this.fetchTag(deviceId);
            const FormData = require('form-data');
            let data = new FormData();
            data.append('mac', deviceId);
            data.append('alias', tags[0].alias);
            data.append('contentmode', '4');
            data.append('rotate', '0');
            data.append('lut', '0');
            data.append('invert', '0');
            data.append('modecfgjson', '{}');
            data.append('location', args.Location);
            data.append('units', args.Units);
            this.homey.log(' before SaveConfig');
            this.SaveConfig(data);
    
        }






    async SaveConfig(data){
        const axios = require('axios');

        let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'http://'+this.gateway+'/save_cfg',
        headers: { 
            'Accept': ' */*', 
            'Accept-Encoding': ' gzip, deflate', 
            'Connection': ' keep-alive', 
            'Content-Type': ' multipart/form-data; boundary=----WebKitFormBoundarybBNp1y5OGFqhCfxl', 
            'Origin': ' http://'+this.gateway, 
            'Referer': ' http://'+this.gateway+'/', 
            ...data.getHeaders()
        },
        data : data
        };

        axios.request(config)
        .then((response) => {
        console.log(JSON.stringify(response.data));
        })
        .catch((error) => {
        console.log(error);
        });
    }

    async fetchTag(mac) {
        try {
          if (!this.gateway) {
          this.log('gateway has not been configured.');
          return;
          }
          const response = await axios.get('http://'+this.gateway+'/get_db?mac='+mac); 
    
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




}

module.exports = CardManager;