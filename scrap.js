




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


