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
    updateTags(tags, drivers, tagtype)
    {
        tags.forEach(tag => {
            this.updateTag(tag, drivers, tagtype);
        });
    }

    updateTag(tag, drivers, tagtype) {
        this.homey.log('updating homey with Tag (mac): ' + tag.mac);
        Object.keys(drivers).forEach((driverId) => {
            let driver = drivers[driverId];
            let devices = driver.getDevices();

            Object.keys(devices).forEach((deviceKey) => {
                let device = devices[deviceKey];
                let { id: deviceId } = device.getData();
                if (tag.mac == deviceId) {
                    // Each device is updated independently so one device's
                    // failure (eg. a rejected setSettings call) can't be
                    // left as an unhandled rejection or block the others.
                    this.processTagUpdate(device, tag, tagtype).catch((error) => {
                        this.homey.log('Error updating device for tag ' + tag.mac + ':', error);
                    });
                }
            });
        });
    }

    async processTagUpdate(device, tag, tagtype) {
        this.updateDeviceCapability(device, "measure_temperature", tag.temperature);
        this.updateDeviceCapability(device, "measure_voltage", (tag.batteryMv / 1000));
        let alarm_battery = tag.batteryMv <= 2400 || tag.batteryMv == 0 || tag.batteryMv == 1337;
        this.updateDeviceCapability(device, "alarm_battery", alarm_battery);

        await this.UpdateTagImage(device, tag, tagtype);

        await device.setSettings({
            MACAddress: tag.mac,
        });
    }

    updateDeviceCapability(device, capability, value) {
        device.setCapabilityValue(capability, value)
            .catch(error => {
                this.homey.log('Error updating capability:', error);
            });
    }

    async UpdateTagImage(device, tag, tagType) {
        let width = tagType.width;
        let height = tagType.height;
        let colorTable = tagType.colortable;
        let simpleColorTable = {};
        let bpp = tagType.bpp;
        this.homey.log('Trying to convert raw image for tag:' + tag.mac + ' with hwType:' + tag.hwType + ' and bpp:' + bpp + ' and width:' + width + ' and height:' + height);

        if (bpp == 16) {
            this.homey.log('bpp 16 tags are not supported for image rendering yet, skipping image update for tag:' + tag.mac);
            return;
        }

        let colorIndex = 0;
        for (const [key, value] of Object.entries(colorTable)) {
            simpleColorTable[colorIndex] = value;
            colorIndex++;
        }

        const image = new Jimp(height, width);
        if (tagType.rotatebuffer) [image.width, image.height] = [image.height, image.width];

        this.homey.log('Fetching raw image for tag: ' + tag.mac);
        const data = await this.downloadRawImage(tag);

        if (!data || data.length == 0) {
            return;
        }

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

        try {
            const squareImage = this.createSquareImage(image);
            const path = device.getScreenshotPath();

            // Wait for the file to actually be on disk before pointing
            // Homey's camera Image at it, otherwise Homey can read a
            // half-written (or not-yet-existing) file.
            await squareImage.writeAsync(path);

            // Reuses the device's own registered Image (created once,
            // cached on the device) instead of registering a new one on
            // every update.
            await device.updateCameraImage(path);

            this.homey.log('Image updated for tag:', tag.mac);
        } catch (error) {
            this.homey.log('Error processing image:', error);
        }
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
            const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
            return response.data;
        } catch (error) {
            console.error('Error while downloading the raw data:', error);
            return null;
            //throw error; // Or handle the error in a different way
        }
    }


}

module.exports = TagManager;
