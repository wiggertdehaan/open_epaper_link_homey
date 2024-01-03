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