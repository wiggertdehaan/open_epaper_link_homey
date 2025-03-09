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
            this.updateTag(tag, drivers, tagtype, homeyImage);
        }); 
    }

    updateTag(tag, drivers, tagtype, homeyImage) {
        this.homey.log('Updating homey with Tag (mac): ' + tag.mac);
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

    UpdateTagImage(device, tag, tagType, homeyImage) {
        // Als tagType niet beschikbaar is, annuleer het proces
        if (!tagType) {
            this.homey.log('No tagType available for tag: ' + tag.mac);
            return;
        }

        let width = tagType.width;
        let height = tagType.height;
        let colorTable = tagType.colortable;
        let bpp = tagType.bpp;

        // Controleer op geldige afmetingen
        if (!width || !height || width <= 0 || height <= 0 || width > 1000 || height > 1000) {
            this.homey.log('Invalid dimensions for tag: ' + tag.mac);
            return;
        }

        this.homey.log('Converting raw image for tag: ' + tag.mac + ', hwType: ' + tag.hwType + ', bpp: ' + bpp);

        // Maak een vereenvoudigde kleurentabel
        let simpleColorTable = {};
        let colorIndex = 0;
        try {
            for (const [key, value] of Object.entries(colorTable)) {
                simpleColorTable[colorIndex] = value;
                colorIndex++;
            }
        } catch (error) {
            this.homey.log('Error creating color table: ' + error.message);
            return;
        }

        // Download de raw image data
        this.downloadRawImage(tag)
            .then(async data => {
                if (!data || data.length === 0) {
                    this.homey.log('No raw image data for tag: ' + tag.mac);
                    return;
                }

                try {
                    // Maak een nieuwe Jimp afbeelding
                    const image = new Jimp(height, width);

                    // Verwerk de image afhankelijk van het bpp (bits per pixel)
                    if (bpp == 16) {
                        this.homey.log("16-bit per pixel not supported");
                    } else {
                        const offsetRed = (data.length >= (width * height / 8) * 2) ? width * height / 8 : 0;

                        // Beperk pixelIndex om buffer overflows te voorkomen
                        const maxPixels = image.bitmap.data.length / 4;

                        for (let i = 0; i < Math.min(data.length, (width * height / 8)); i++) {
                            for (let j = 0; j < 8; j++) {
                                const pixelIndex = i * 8 + j;
                                
                                // Voorkom buffer overflows
                                if (pixelIndex >= maxPixels) continue;

                                let pixelValue = 0;
                                if (offsetRed && i + offsetRed < data.length) {
                                    pixelValue = ((data[i] & (1 << (7 - j))) ? 1 : 0) | (((data[i + offsetRed] & (1 << (7 - j))) ? 1 : 0) << 1);
                                } else {
                                    pixelValue = ((data[i] & (1 << (7 - j))) ? 1 : 0);
                                }

                                // Zorg ervoor dat we een geldige pixelwaarde hebben
                                if (simpleColorTable[pixelValue]) {
                                    image.bitmap.data[pixelIndex * 4] = simpleColorTable[pixelValue][0];
                                    image.bitmap.data[pixelIndex * 4 + 1] = simpleColorTable[pixelValue][1];
                                    image.bitmap.data[pixelIndex * 4 + 2] = simpleColorTable[pixelValue][2];
                                    image.bitmap.data[pixelIndex * 4 + 3] = 255;
                                }
                            }
                        }
                    }

                    // Maak een square image en schrijf dit naar een bestand
                    const squareImage = this.createSquareImage(image);
                    const imagePath = '/tmp/scr_' + tag.mac + '.png';
                    
                    await new Promise((resolve, reject) => {
                        squareImage.write(imagePath, (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });

                    // Update het device met de nieuwe afbeelding
                    homeyImage.setPath(imagePath);
                    await device.setCameraImage(tag.mac, tag.mac, homeyImage);
                    this.homey.log('Image updated for tag: ' + tag.mac);
                    
                } catch (error) {
                    this.homey.log('Error processing image: ' + error.message);
                }
            })
            .catch(error => {
                this.homey.log('Error downloading raw data: ' + error.message);
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
        if (!tag || !tag.mac) {
            this.homey.log('Invalid tag for downloadRawImage');
            return null;
        }
        
        this.homey.log('Downloading raw image for tag: ' + tag.mac);
        
        // Gebruik een willekeurige waarde als hash niet beschikbaar of default is
        let cachetag = tag.hash;
        if (!cachetag || cachetag === '00000000000000000000000000000000') {
            cachetag = Date.now(); // Gebruik huidige timestamp in plaats van Math.random()
        }
        
        const url = 'http://' + this.gateway + '/current/' + tag.mac + '.raw?' + cachetag;
        this.homey.log('Fetching raw image from gateway: ' + url);
        
        try {
            const response = await axios.get(url, { 
                responseType: 'arraybuffer',
                timeout: 5000 // 5 seconden timeout
            });
            return response.data;
        } catch (error) {
            this.homey.log('Error downloading raw data: ' + (error.message || error));
            return null;
        }
    }
    

}

module.exports = TagManager;