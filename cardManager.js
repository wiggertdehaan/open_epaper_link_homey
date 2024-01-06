const axios = require('axios');

class CardManager {

    constructor(homey, gateway)
    {
        this.homey = homey; 
   
        this.gateway = gateway;
        this.homey.log('Card constructor gateway: '+this.gateway);
    }


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