'use strict';

const FormData = require('form-data');
const axios = require('axios');
const qs = require('qs');

class CardManager {

  constructor(homey, gateway) {
    this.homey = homey;

    this.gateway = gateway;
    this.homey.log(`Card constructor gateway: ${this.gateway}`);
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

  async cardShowCurrentDate(args, state) {

    this.homey.log('CardManager: cardShowCurrentDate');
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const tags = await this.fetchTag(deviceId);
    const data = new FormData();
    data.append('mac', deviceId);
    data.append('alias', tags[0].alias);
    data.append('contentmode', '1');
    data.append('rotate', '0');
    data.append('lut', '0');
    data.append('invert', '0');
    data.append('modecfgjson', '{}');
    await this.SaveConfig(data);

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

  async cardShowCountDays(args, state) {

    this.homey.log('CardManager: cardCountDays');
    this.homey.log(`Parameters: ${args.Counter} ${args.Threshold}`);
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const tags = await this.fetchTag(deviceId);
    const data = new FormData();
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
    await this.SaveConfig(data);

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

  async cardShowCountHours(args, state) {

    this.homey.log('CardManager: cardCountHours');
    this.homey.log(`Parameters: ${args.Counter} ${args.Threshold}`);
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const tags = await this.fetchTag(deviceId);
    const data = new FormData();
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
    await this.SaveConfig(data);

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

  async cardShowCurrentWeather(args, state) {

    this.homey.log('CardManager: cardShowCurrentWeather');
    this.homey.log(`Parameters: ${args.Location} ${args.Units}`);
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const tags = await this.fetchTag(deviceId);
    const data = new FormData();
    data.append('mac', deviceId);
    data.append('alias', tags[0].alias);
    data.append('contentmode', '4');
    data.append('rotate', '0');
    data.append('lut', '0');
    data.append('invert', '0');
    data.append('modecfgjson', `{"location":"${args.Location}","units":"${args.Units}"}`);
    this.homey.log(' before SaveConfig');
    await this.SaveConfig(data);

  }

  // {
  //     "id": 8,
  //     "name": "Weather forecast",
  //     "desc": "Weather forecast for the next five days. Weather data by Open-Meteo.com",
  //     "hwtype": [
  //       1,
  //       2,
  //       5,
  //       49,
  //       51,
  //       17
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
  async cardShowWeatherForecast(args, state) {

    this.homey.log('CardManager: cardShowWeatherForecast');
    this.homey.log(`Parameters: ${args.Location} ${args.Units}`);
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const tags = await this.fetchTag(deviceId);
    const data = new FormData();
    data.append('mac', deviceId);
    data.append('alias', tags[0].alias);
    data.append('contentmode', '8');
    data.append('rotate', '0');
    data.append('lut', '0');
    data.append('invert', '0');
    data.append('modecfgjson', `{"location":"${args.Location}","units":"${args.Units}"}`);
    this.homey.log(' before SaveConfig');
    await this.SaveConfig(data);
  }

  // {
  //     "id": 16,
  //     "name": "Buienradar",
  //     "desc": "Dutch rain predictions for the next two hours. Only works for locations in the Netherlands and Belgium.",
  //     "hwtype": [
  //       1,
  //       49,
  //       51,
  //       17
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
  //       }
  //     ]
  //   },

  async cardShowBuienradar(args, state) {

    this.homey.log('CardManager: cardShowBuienradar');
    this.homey.log(`Parameters: ${args.Location}`);
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const tags = await this.fetchTag(deviceId);
    const data = new FormData();
    data.append('mac', deviceId);
    data.append('alias', tags[0].alias);
    data.append('contentmode', '16');
    data.append('rotate', '0');
    data.append('lut', '0');
    data.append('invert', '0');
    data.append('modecfgjson', `{"location":"${args.Location}"}`);
    this.homey.log(' before SaveConfig');
    await this.SaveConfig(data);
  }

  // {
  //     "id": 9,
  //     "name": "RSS feed",
  //     "desc": "Gets an RSS feed, and display the first few lines of it",
  //     "hwtype": [
  //       1,
  //       2,
  //       5,
  //       49,
  //       51,
  //       17
  //     ],
  //     "param": [
  //       {
  //         "key": "title",
  //         "name": "Title",
  //         "desc": "Displayed title",
  //         "type": "text"
  //       },
  //       {
  //         "key": "url",
  //         "name": "URL",
  //         "desc": "Full URL of the RSS feed",
  //         "type": "text"
  //       },
  //       {
  //         "key": "interval",
  //         "name": "Interval",
  //         "desc": "How often (in minutes) the feed is being refreshed",
  //         "type": "int"
  //       }
  //     ]
  //   },
  // too many RSS feeds makes the AP unstable. Diabling for now
  async cardShowRSSFeed(args, state) {

    this.homey.log('CardManager: cardShowRSSFeed');
    this.homey.log(`Parameters: ${args.Title} ${args.URL} ${args.Interval}`);
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const tags = await this.fetchTag(deviceId);
    const data = new FormData();
    data.append('mac', deviceId);
    data.append('alias', tags[0].alias);
    data.append('contentmode', '9');
    data.append('rotate', '0');
    data.append('lut', '0');
    data.append('invert', '0');
    data.append('modecfgjson', `{"title":"${args.Title}","url":"${args.URL}","interval":"${args.Interval}"}`);
    this.homey.log(' before SaveConfig');
    await this.SaveConfig(data);
  }

  // {
  //     "id": 10,
  //     "name": "QR code",
  //     "desc": "Displayes a full screen QR code",
  //     "hwtype": [
  //       0,
  //       1,
  //       2,
  //       5,
  //       17,
  //       49,
  //       51
  //     ],
  //     "param": [
  //       {
  //         "key": "title",
  //         "name": "Title",
  //         "desc": "Displayed title",
  //         "type": "text"
  //       },
  //       {
  //         "key": "qr-content",
  //         "name": "QR content",
  //         "desc": "Any content that can be coded into a QR code",
  //         "type": "text"
  //       }
  //     ]
  //   },

  async cardShowQRCode(args, state) {

    this.homey.log('CardManager: cardShowRSSFeed');
    this.homey.log(`Parameters: ${args.Title} ${args.QRContent}`);
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const tags = await this.fetchTag(deviceId);
    const data = new FormData();
    data.append('mac', deviceId);
    data.append('alias', tags[0].alias);
    data.append('contentmode', '10');
    data.append('rotate', '0');
    data.append('lut', '0');
    data.append('invert', '0');
    data.append('modecfgjson', `{"title":"${args.Title}","qr-content":"${args.QRContent}"}`);
    this.homey.log(' before SaveConfig');
    await this.SaveConfig(data);
  }

  // {
  //     "id": 7,
  //     "name": "Image URL",
  //     "desc": "Gets an external image and displays it",
  //     "hwtype": [
  //       0,
  //       1,
  //       2,
  //       5,
  //       49,
  //       51,
  //       17
  //     ],
  //     "param": [
  //       {
  //         "key": "url",
  //         "name": "URL",
  // "desc": "Full URL of the image. Image should be in jpeg format (non-progressive), and with exactly the right resolution for the screen (eg
  // 128x296 or 152x152). Will be auto-rotated. Colors will be dithered",
  //         "type": "text"
  //       },
  //       {
  //         "key": "interval",
  //         "name": "Interval",
  //         "desc": "How often (in minutes) the image is being fetched. Minimum is 3 minutes.",
  //         "type": "int"
  //       }
  //     ]
  //   },

  async cardShowImage(args, state) {

    this.homey.log('CardManager: cardShowImage');
    this.homey.log(`Parameters: ${args.URL} ${args.Interval}`);
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const tags = await this.fetchTag(deviceId);
    const data = new FormData();
    data.append('mac', deviceId);
    data.append('alias', tags[0].alias);
    data.append('contentmode', '7');
    data.append('rotate', '0');
    data.append('lut', '0');
    data.append('invert', '0');
    data.append('modecfgjson', `{"url":"${args.URL}","Interval":"${args.Interval}"}`);
    this.homey.log(' before SaveConfig');
    await this.SaveConfig(data);
  }

  // Show 3 lines of text on  HW01 type tag
  async cardHW01Show3Lines(args, state) {
    this.homey.log('CardManager: cardHW01Show3Lines');
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const jsonData = [
      { text: [5, 5, args.Title, 'bahnschrift20', 1, 0, 0] },
      { text: [5, 50, args.Key1, 't0_14b_tf', 1, 0, 0] },
      { text: [150, 50, args.Value1, 't0_14b_tf', 1, 0, 0] },
      { text: [5, 70, args.Key2, 't0_14b_tf', 1, 0, 0] },
      { text: [150, 70, args.Value2, 't0_14b_tf', 1, 0, 0] },
      { text: [5, 90, args.Key3, 't0_14b_tf', 1, 0, 0] },
      { text: [150, 90, args.Value3, 't0_14b_tf', 1, 0, 0] },
    ];

    // Stel de POST-data samen
    const data = {
      mac: deviceId,
      json: JSON.stringify(jsonData),
    };
    await this.SaveJSON(data);
  }

  // fetches the remote JSON
  async fetchRemoteJSON(url) {
    this.homey.log(`CardManager: fetchRemoteJSON URL: ${url}`);
    try {
      const response = await axios.get(url);
      if (response.data) {
        return response.data;
      }
      // Null rather than falling off the end: the callers check the result,
      // and an implicit undefined made that check look accidental.
      this.homey.log('Geen JSON gevonden in de respons');
      return null;
    } catch (error) {
      this.homey.log('Fout bij het ophalen van de JSON:', error);
      return null;
    }
  }

  // fetch remote JSON and display it on the tag
  async cardShowRemoteJSON(args, state) {
    this.homey.log('CardManager: cardShowRemoteJSON');
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const jsonData = await this.fetchRemoteJSON(args.RemoteURL);
    this.homey.log(`CardManager: cardShowRemoteJSON: ${JSON.stringify(jsonData)}`);
    // Stel de POST-data samen
    const data = {
      mac: deviceId,
      json: JSON.stringify(jsonData),
    };
    await this.SaveJSON(data);
  }

  // fetch local JSON and display it on the tag
  async cardShowLocalJSON(args, state) {
    this.homey.log('CardManager: cardShowLocalJSON');
    const deviceData = args.Id.getData();
    const deviceId = deviceData.id;

    const data = {
      mac: deviceId,
      json: args.JSON,
    };
    await this.SaveJSON(data);
  }

  // Tags whose type lists the "led" option carry an RGB LED. The AP drives it
  // with a twelve byte pattern documented at
  // https://github.com/OpenEPaperLink/OpenEPaperLink/wiki/Led-control
  //
  //   byte 0   low nibble  mode, 1 = sequence, 0 = off
  //            high nibble flash length in ms; above 3 ms costs battery
  //                        without being noticeably brighter
  //   byte 1   colour of group 1 as RGB332
  //   byte 2   high nibble flash speed in units of 100 ms
  //            low nibble  number of flashes
  //   byte 3   pause after the group in units of 100 ms
  //   bytes 4-9  groups 2 and 3, same layout, left at zero here
  //   byte 10  how many times to repeat the sequence
  //   byte 11  spare, always zero
  //
  // Only one group is used, which is enough for "blink n times, wait, repeat"
  // and keeps the card's settings understandable.
  static LED_COLOURS = {
    red: 0xE0,
    green: 0x1C,
    blue: 0x03,
    yellow: 0xFC,
    magenta: 0xE3,
    cyan: 0x1F,
    white: 0xFF,
  };

  static ledPattern({
    colour, flashes, intervalSeconds, minutes,
  }) {
    const hex = (n) => Number(n).toString(16).toUpperCase().padStart(2, '0');
    // mode 0 in the first byte means "sequence off"
    if (!minutes) return '000000000000000000000000';

    // the wiki's recommended compromise between visibility and battery
    const FLASH_MS = 2;
    // 200 ms between the flashes within one burst
    const SPEED_UNITS = 2;
    const count = Math.min(15, Math.max(1, Math.round(flashes)));
    // one pause unit is 100 ms and the field is a single byte
    const pause = Math.min(255, Math.max(1, Math.round(intervalSeconds * 10)));

    const burstMs = count * SPEED_UNITS * 100;
    const cycleMs = burstMs + pause * 100;
    const repeats = Math.min(255, Math.max(1, Math.round((minutes * 60000) / cycleMs)));

    return [
      hex((FLASH_MS << 4) | 1),
      hex(CardManager.LED_COLOURS[colour] ?? CardManager.LED_COLOURS.red),
      hex((SPEED_UNITS << 4) | count),
      hex(pause),
      '00', '00', '00',
      '00', '00', '00',
      hex(repeats),
      '00',
    ].join('');
  }

  async cardLedFlash(args, state) {
    this.homey.log('CardManager: cardLedFlash');
    const { gateway } = this;
    if (!gateway) {
      this.homey.log('Gateway has not been configured.');
      return;
    }

    const mac = args.Id.getData().id;
    const pattern = CardManager.ledPattern({
      colour: args.Colour,
      flashes: args.Flashes,
      intervalSeconds: args.Interval,
      minutes: args.Minutes,
    });

    try {
      // Drop anything still queued for this tag first. A start and a stop can
      // otherwise both be waiting, and the tag would run the old pattern the
      // moment it wakes up.
      await axios.post(`http://${gateway}/tag_cmd`, qs.stringify({ mac, cmd: 'clear' }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const response = await axios.get(`http://${gateway}/led_flash`, {
        params: { mac, pattern },
      });
      this.homey.log(`CardManager: cardLedFlash ${mac} ${pattern}: ${response.data}`);
    } catch (error) {
      this.homey.log('CardManager: cardLedFlash failed:', error.message);
    }
  }

  async SaveJSON(data) {
    this.homey.log('CardManager: SaveJSON');
    const { gateway } = this;
    if (!gateway) {
      this.homey.log('Gateway has not been configured.');
      return;
    }

    try {
      this.homey.log(`CardManager: SaveJSON: ${JSON.stringify(data)}`);

      const response = await axios.post(`http://${gateway}/jsonupload`, qs.stringify(data), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      this.homey.log('Succes:', response.data);
    } catch (error) {
      this.homey.log('Fout tijdens de POST-aanvraag:', error.message);
    }
  }

  async SaveConfig(data) {
    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `http://${this.gateway}/save_cfg`,
      headers: {
        Accept: ' */*',
        'Accept-Encoding': ' gzip, deflate',
        Connection: ' keep-alive',
        'Content-Type': ' multipart/form-data; boundary=----WebKitFormBoundarybBNp1y5OGFqhCfxl',
        Origin: ` http://${this.gateway}`,
        Referer: ` http://${this.gateway}/`,
        ...data.getHeaders(),
      },
      data,
    };

    // Awaited, not fired and forgotten. This method is what actually writes to
    // the AP, so returning before the request finished meant every caller's
    // `await` waited on nothing: the flow card reported done while the tag was
    // still unchanged, and a failure surfaced as an unhandled rejection rather
    // than in the app log.
    try {
      const response = await axios.request(config);
      this.homey.log('CardManager: SaveConfig ok:', JSON.stringify(response.data));
      return response.data;
    } catch (error) {
      this.homey.log('CardManager: SaveConfig failed:', error.message || error);
      throw error;
    }
  }

  async fetchTag(mac) {
    try {
      if (!this.gateway) {
        this.homey.log('Gateway has not been configured.');
        return []; // Retourneer een lege array als de gateway niet is geconfigureerd
      }

      const response = await axios.get(`http://${this.gateway}/get_db?mac=${mac}`);

      if (response.data && response.data.tags) {
        return response.data.tags;
      }
      this.homey.log('Geen tags gevonden in de respons');
      return []; // Retourneer een lege array als er geen tags zijn gevonden

    } catch (error) {
      this.homey.log('Fout bij het ophalen van de tags:', error.message);
      return []; // Retourneer een lege array bij een fout
    }
  }

}

module.exports = CardManager;
