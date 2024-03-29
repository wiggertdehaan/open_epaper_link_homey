const Jimp = require('jimp');
const axios = require('axios');
const { Readable } = require('stream');

class TagManager {
    // constructor
    constructor(homey,gateway)
    {
        this.homey = homey; 
        this.gateway = gateway;
        this.homey.log('TagManager constructor gateway: '+this.gateway);
    }

    // update tags
    updateTags(tags, drivers, tagtype, homeyImage)
    {
        tags.forEach(tag => {
            this.updateTag(tag, drivers, tagtype,homeyImage);
        }); 
    }

    updateTag(tag, drivers, tagtype, homeyImage) {
        this.homey.log('updating homey with Tag (mac): ' + tag.mac);
        Object.keys(drivers).forEach((id) => {
            let driver = drivers[id];
            let devices = driver.getDevices();

            Object.keys(devices).forEach(async (id) => {
                let device = devices[id];
                let { id: deviceId } = device.getData();
                if (tag.mac == deviceId) {
                    this.updateDeviceCapability(device, "measure_temperature", tag.temperature);
                    this.updateDeviceCapability(device, "measure_voltage", (tag.batteryMv / 1000)) ;
                    let alarm_battery = tag.batteryMv <= 2400 || tag.batteryMv == 0 || tag.batteryMv == 1337;
                    this.updateDeviceCapability(device, "alarm_battery", alarm_battery);

                    this.UpdateTagImage(device, tag, tagtype, homeyImage);

                    await device.setSettings({
                        MACAddress: tag.mac,
                      });

                }
            });
        });
    }

    updateDeviceCapability(device, capability, value) {
        device.setCapabilityValue(capability, value)
            .then(() => {
                device.setCapabilityValue(capability,value);
            })
            .catch(error => {
                this.homey.log('Error updating capability:', error);
            });
    }

    UpdateTagImage(device, tag, tagType,homeyImage) {
        let width = tagType.width;
        let height = tagType.height;
        let colorTable = tagType.colortable;
        let simpleColorTable = {};
        let bpp = tagType.bpp;
        this.homey.log('Trying to convert raw image for tag:' + tag.mac + ' with hwType:' + tag.hwType + ' and bpp:' + bpp + ' and width:' + width + ' and height:' + height);

        let colorIndex = 0;
        for (const [key, value] of Object.entries(colorTable)) {
            simpleColorTable[colorIndex] = value;
            colorIndex++;
        }

        this.homey.log('simpleColorTable:' + simpleColorTable[0][0]);
        const image = new Jimp(height, width);

        if (tagType.rotatebuffer) [image.width, image.height] = [image.height, image.width];
        this.homey.log('Fetching raw image for tag: ' + tag.mac);
        this.downloadRawImage(tag)
            .then(async data => {
                this.homey.log('data:' + data.length);

                if(data.length!=0)
                {
                    if (bpp == 16) {
                        this.homey.log("bpp ==16:" + bpp);
                    }
                    else {
                        const offsetRed = (data.length >= (width  * height  / 8) * 2) ? width  * height  / 8 : 0;

                        let pixelValue = 0;
                        for (let i = 0; i < data.length; i++) {
                            for (let j = 0; j < 8; j++) {
                                const pixelIndex = i * 8 + j;
                                if (offsetRed) {
                                    pixelValue = ((data[i] & (1 << (7 - j))) ? 1 : 0) | (((data[i + offsetRed] & (1 << (7 - j))) ? 1 : 0) << 1);
                                } else {
                                    pixelValue = ((data[i] & (1 << (7 - j))) ? 1 : 0);
                                }
                                image.bitmap.data[pixelIndex * 4] =  simpleColorTable[pixelValue][0];
                                image.bitmap.data[pixelIndex * 4 + 1] = simpleColorTable[pixelValue][1];
                                image.bitmap.data[pixelIndex * 4 + 2] = simpleColorTable[pixelValue][2];
                                image.bitmap.data[pixelIndex * 4 + 3] = 255;
                            }
                        }
                        

                    }
                    try {
                        const squareImage = this.createSquareImage(image);
                        squareImage.write('/tmp/scr_'+tag.mac+'.png'); 

                        homeyImage.setPath('/tmp/scr_'+tag.mac+'.png');
                        device.setCameraImage(tag.mac, tag.mac, homeyImage)
                            .then(() => {
                                this.homey.log('Image updated for tag:', tag.mac);
                            }
                            )
                            .catch(error => {
                                this.homey.log('Error updating image:', error);
                            }
                            );

                    } catch (error) {
                        this.homey.log('Error processing image:', error);
                    }    
                 

                    }
                })
            .catch(error => {
                console.error('Error while downloading raw data:', error);
                // Handle the error here
            });
    }

    createSquareImage(originalImage) {
        let imageToProcess = originalImage;

        if (originalImage.bitmap.height > originalImage.bitmap.width) {
            imageToProcess = originalImage.rotate(-90);
        }
    
        const width = imageToProcess.bitmap.width;
        const height = imageToProcess.bitmap.height;
    
        const squareSize = Math.max(width, height);
    
        const squareImage = new Jimp(squareSize, squareSize, 0x00000000);
    
        const x = (squareSize - width) / 2;
        const y = (squareSize - height) / 2;
    
        squareImage.composite(imageToProcess, x, y);
    
        return squareImage;
    }


    async downloadRawImage(tag) {
        this.homey.log('downloadRawImage');
        let cachetag = tag.hash;
        if (tag.hash == '00000000000000000000000000000000') cachetag = Math.random();
        const url = 'http://'+this.gateway+'/current/' + tag.mac + '.raw?' + cachetag;
        this.homey.log('Fetching raw image from gateway:', url);
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            return response.data;
        } catch (error) {
            console.error('Error while downloading the raw data:', error);
            return null;
            //throw error; // Or handle the error in a different way
        }
    }
    

}

module.exports = TagManager;