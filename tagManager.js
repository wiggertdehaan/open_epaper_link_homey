
class TagManager {

    // constructor
    constructor(homey)
    {
        this.homey = homey; 
        this.homey.log('TagManager constructor');     
        //this.log('Tag constructor');
    }

    // update tags
    updateTags(tags, drivers)
    {
        tags.forEach(tag => {
            this.updateTag(tag, drivers);
        }); 
    }

    updateTag(tag, drivers)
    {
        this.homey.log('updating homey with Tag (mac): '+tag.mac);
     //   let drivers = this.homey.drivers.getDrivers();
        Object.keys(drivers).forEach((id) => {
            let driver = drivers[id];
            let devices = driver.getDevices();
            
            Object.keys(devices).forEach(async (id)=>{
              let device = devices[id];
              let { id: deviceId } = device.getData();
              if (tag.mac==deviceId)
              {
                // Set capability value of devices

                this.updateDeviceCapability(device, "measure_temperature", tag.temperature);
                this.updateDeviceCapability(device, "measure_battery", ((tag.batteryMv/1000)-2.20)*250);
                let alarm_battery = false;
                if(tag.batteryMv <= 2400 || tag.batteryMv == 0 || tag.batteryMv == 1337)
                {
                  alarm_battery = true;
                }
                this.updateDeviceCapability(device, "alarm_battery", alarm_battery);
              //  let data = await this.getTagTypeData(tag[0].hwType);
        
        
                // update image of device
                this.UpdateTagImage(device, tag);

        
              }  // end if tag.mac==deviceId
            }); // end forEach Devices
        
          }); // end forEach Drivers
    } // end updateTag

    updateDeviceCapability(device, capability, value)
    {
        device.setCapabilityValue(capability,value)
        .then(() => {
          //this.log('Capability bijgewerkt');
        })
        .catch(error => {
          this.log('Fout bij het bijwerken van capability:', error);
        });
    }

    UpdateTagImage(device, tag)
    {
        this.homey.log('UpdateTagImage: '+tag.hwType);
        // Get Tag Hardware Type
        let hwType = this.homey.getTagTypeData(tag.hwType);
        

        // Get Raw Image

    }



}

module.exports = TagManager;