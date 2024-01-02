'use strict';

//import { json } from 'stream/consumers';

const Homey = require('homey');
const axios = require('axios');
const WebSocket = require('ws');
const Jimp = require('jimp');
const qs = require('qs');

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('MyApp has been initialized');
    this.tagTypeCache = {};
    
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
        // check if messageJSON starts with msg.tags
        if (messageJSON.tags)
        {
          this.log("tags!");
          this.updateHomeyTag(messageJSON.tags);
        }
        if (messageJSON.sys)
        {
          this.updateHomeyRouter(messageJSON.sys);
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

updateHomeyRouter(sys)
{
  this.log('updating Router');
}


 convertRawToImage(rawData, width, height) {
  const image = new Jimp(width, height);

  for (let i = 0; i < width * height; i++) {
      const dataIndex = i * 2; // Assuming 16-bit data per pixel
      const rgb16 = (rawData[dataIndex] << 8) | rawData[dataIndex + 1];

      const r = ((rgb16 >> 11) & 0x1F) << 3;
      const g = ((rgb16 >> 5) & 0x3F) << 2;
      const b = (rgb16 & 0x1F) << 3;

      const color = Jimp.rgbaToInt(r, g, b, 255);
      image.setPixelColor(color, i % width, Math.floor(i / width));
  }

  return image;
}

downloadRawData(url) {
  return axios.get(url, { responseType: 'arraybuffer' })
      .then(response => response.data)
      .catch(error => {
          console.error('Error bij het downloaden van de raw data:', error);
          throw error; // Of verwerk de fout op een andere manier
      });
}

convertRawToPNG(rawData, width, height, colorTable) {
  const image = new Jimp(width, height);

  for (let i = 0; i < width * height; i++) {
      // Aannemend dat je raw data in een specifiek formaat is, bijvoorbeeld 16-bit kleurwaarden
      const dataIndex = i * 2; // Voorbeeld voor 16-bit data
      const rgb = (rawData[dataIndex] << 8) | rawData[dataIndex + 1];

      // Omzetten van raw data naar kleurwaarden, vergelijkbaar met je browsercode
      // ...

      image.setPixelColor(Jimp.rgbaToInt(r, g, b, 255), i % width, Math.floor(i / height));
  }

  return image.getBufferAsync(Jimp.MIME_PNG);
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



        if (deviceId=="0000021C69433B1E")
        {
            const url = 'http://192.168.0.16/current/0000021C69433B1E.raw?e39b4cdc996f94fe37e35965cb57c910';
            const myImage = await this.homey.images.createImage();
            myImage.setStream(async (stream) => {
              const res = await fetch(url);
              if (!res.ok) {
                  throw new Error('Invalid Response');
              }

              const pngBuffer = this.convertRawToPNG(new Uint8ClampedArray(rawData), width, height, colorTable);


              return res.body.pipe(stream);
          });

          this.log('Image gedownload:', myImage);
          // Stel nu de camera-afbeelding in met het Image-object
          // Vervang 'myDevice' met je specifieke Homey-apparaat en 'unique-id' & 'Image Title' met de relevante waarden
          try {
              await device.setCameraImage('unique-id', 'Image Title', myImage);
              console.log('Camera Image ingesteld in Homey');
          } catch (error) {
              console.error('Fout bij het instellen van Camera Image in Homey:', error);
          }
        }
        



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
      this.log('Tagtype data fetched from gateway:', data);
      return data;
  } catch (error) {
      console.error(error);
      // Optionally handle the error, e.g., return default values
  }
}

  
}

module.exports = MyApp;
