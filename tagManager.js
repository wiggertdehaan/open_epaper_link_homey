const Jimp = require('jimp');
const axios = require('axios');
const { Readable } = require('stream');
const { decodeRawImage } = require('./lib/rawImage');

class TagManager {
    // constructor
    constructor(homey,gateway)
    {
        this.homey = homey;
        this.gateway = gateway;
        this.homey.log('TagManager constructor gateway: '+this.gateway);
    }

    // The gateway address can be changed at any time from the app settings
    // page, so it must be updatable in place rather than captured at boot.
    setGateway(gateway)
    {
        this.gateway = gateway;
    }

    // update tags
    //
    // resolveTagType is called per tag: a single websocket message can carry
    // tags of different hardware types, so the type must be looked up for each
    // one instead of reusing the first tag's type for the whole batch.
    updateTags(tags, drivers, resolveTagType)
    {
        tags.forEach(tag => {
            Promise.resolve()
                .then(() => resolveTagType(tag.hwType))
                .then((tagtype) => this.updateTag(tag, drivers, tagtype))
                .catch((error) => {
                    this.homey.log('Error resolving tag type for ' + tag.mac + ':', error);
                });
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
        if (!tagType) {
            this.homey.log('No tag type data for tag ' + tag.mac + ' (hwType ' + tag.hwType + '), skipping image update');
            return;
        }

        if (tagType.bpp == 16) {
            this.homey.log('bpp 16 tags are not supported for image rendering yet, skipping image update for tag:' + tag.mac);
            return;
        }

        const data = await this.downloadRawImage(tag);
        if (!data || data.length == 0) {
            return;
        }

        let decoded;
        try {
            decoded = decodeRawImage(data, tagType);
        } catch (error) {
            // A buffer we cannot decode must not be rendered: unpacking it
            // anyway produces black/white noise on the device tile, which is
            // worse than simply keeping the previous image.
            this.homey.log('Skipping image for tag ' + tag.mac + ': ' + error.message);
            return;
        }

        this.homey.log('Decoded raw image for tag ' + tag.mac
            + ' (hwType ' + tag.hwType + ', ' + decoded.container + ', '
            + decoded.width + 'x' + decoded.height + ', ' + decoded.planes + ' plane(s))');

        try {
            let image = new Jimp(decoded.width, decoded.height, 0xffffffff);
            for (let p = 0; p < decoded.width * decoded.height; p++) {
                image.bitmap.data[p * 4] = decoded.rgb[p * 3];
                image.bitmap.data[p * 4 + 1] = decoded.rgb[p * 3 + 1];
                image.bitmap.data[p * 4 + 2] = decoded.rgb[p * 3 + 2];
                image.bitmap.data[p * 4 + 3] = 255;
            }

            // Panels whose framebuffer is stored rotated need turning upright
            // before we hand the picture to Homey.
            if (decoded.rotated) image = image.rotate(90);

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
