'use strict';

const FormData = require('form-data');
const qs = require('qs');
const { http } = require('./lib/http');
const { normalizeMac } = require('./lib/devices');

/**
 * The action cards that change what a tag shows.
 *
 * Every card either succeeds or throws. The error message is what Homey shows
 * the user on the failed flow card, so it says what went wrong in their terms.
 * Swallowing errors here used to make every card report success, including
 * when the AP was unreachable or the gateway was never configured.
 */
class CardManager {

  /**
   * @param {object} homey  the app; named so for historic reasons
   */
  constructor(homey) {
    this.homey = homey;
    this.homey.log(`Card constructor gateway: ${this.homey.getGateway()}`);
  }

  /** A translated message; falls back to the key outside Homey. */
  t(key, tokens) {
    const { homey } = this.homey;
    const message = homey && typeof homey.__ === 'function' ? homey.__(key, tokens) : null;
    return message || key;
  }

  requireGateway() {
    const gateway = this.homey.getGateway();
    if (!gateway) throw new Error(this.t('errors.noGateway'));
    return gateway;
  }

  /**
   * Switches a tag to one of the AP's own content modes.
   *
   * @param {object} args          the card's arguments; args.Id is the device
   * @param {number} contentMode   the AP's content id
   * @param {object} modeConfig    that mode's settings
   * @param {object} [extraFields] sent as form fields next to the config
   */
  async saveContentConfig(args, contentMode, modeConfig, extraFields = {}) {
    const mac = args.Id.getData().id;
    const tag = await this.fetchTag(mac);

    const data = new FormData();
    data.append('mac', mac);
    data.append('alias', tag.alias || '');
    data.append('contentmode', String(contentMode));
    // Rotation, colour table and inversion are set per tag in the AP's web
    // interface. Sending zeros here reset them every time a flow ran.
    data.append('rotate', String(tag.rotate ?? 0));
    data.append('lut', String(tag.lut ?? 0));
    data.append('invert', String(tag.invert ?? 0));
    // Serialised rather than pieced together from strings: a location or QR
    // text containing a quote or backslash used to produce invalid JSON.
    data.append('modecfgjson', JSON.stringify(modeConfig));
    for (const [key, value] of Object.entries(extraFields)) {
      data.append(key, String(value));
    }

    await this.SaveConfig(data);
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
    await this.saveContentConfig(args, 1, {});
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
    // The AP reads both from the mode config. They are also sent as the
    // separate form fields this card has always sent.
    const config = { counter: String(args.Counter), thresholdred: String(args.Threshold) };
    await this.saveContentConfig(args, 2, config, config);
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
    const config = { counter: String(args.Counter), thresholdred: String(args.Threshold) };
    await this.saveContentConfig(args, 3, config, config);
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
    await this.saveContentConfig(args, 4, { location: String(args.Location), units: String(args.Units) });
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
    await this.saveContentConfig(args, 8, { location: String(args.Location), units: String(args.Units) });
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
    await this.saveContentConfig(args, 16, { location: String(args.Location) });
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
    await this.saveContentConfig(args, 9, {
      title: String(args.Title),
      url: String(args.URL),
      interval: String(args.Interval),
    });
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
    this.homey.log('CardManager: cardShowQRCode');
    this.homey.log(`Parameters: ${args.Title} ${args.QRContent}`);
    await this.saveContentConfig(args, 10, { title: String(args.Title), 'qr-content': String(args.QRContent) });
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
    // `interval`, lower case: the AP ignored the `Interval` this used to
    // send, so the refresh interval chosen on the card never applied.
    await this.saveContentConfig(args, 7, { url: String(args.URL), interval: String(args.Interval) });
  }

  // Show 3 lines of text on  HW01 type tag
  async cardHW01Show3Lines(args, state) {
    this.homey.log('CardManager: cardHW01Show3Lines');
    const deviceId = args.Id.getData().id;

    const jsonData = [
      { text: [5, 5, args.Title, 'bahnschrift20', 1, 0, 0] },
      { text: [5, 50, args.Key1, 't0_14b_tf', 1, 0, 0] },
      { text: [150, 50, args.Value1, 't0_14b_tf', 1, 0, 0] },
      { text: [5, 70, args.Key2, 't0_14b_tf', 1, 0, 0] },
      { text: [150, 70, args.Value2, 't0_14b_tf', 1, 0, 0] },
      { text: [5, 90, args.Key3, 't0_14b_tf', 1, 0, 0] },
      { text: [150, 90, args.Value3, 't0_14b_tf', 1, 0, 0] },
    ];

    await this.SaveJSON({
      mac: deviceId,
      json: JSON.stringify(jsonData),
    });
  }

  /**
   * A JSON template as the AP expects it: a list of drawing commands.
   *
   * @param {*} value  the template, as text or already parsed
   * @returns {Array}
   * @throws with a message fit for the flow card when it is not one
   */
  parseTemplate(value) {
    let template = value;
    if (typeof template === 'string') {
      try {
        template = JSON.parse(template);
      } catch (error) {
        throw new Error(this.t('errors.invalidJson', { error: error.message }));
      }
    }
    if (!Array.isArray(template)) {
      throw new Error(this.t('errors.notATemplate'));
    }
    return template;
  }

  // fetches the remote JSON
  async fetchRemoteJSON(url) {
    this.homey.log(`CardManager: fetchRemoteJSON URL: ${url}`);
    let response;
    try {
      response = await http.get(url);
    } catch (error) {
      throw new Error(this.t('errors.remoteFetch', { url, error: error.message }));
    }
    return this.parseTemplate(response.data);
  }

  // fetch remote JSON and display it on the tag
  async cardShowRemoteJSON(args, state) {
    this.homey.log('CardManager: cardShowRemoteJSON');
    const deviceId = args.Id.getData().id;

    // A failed fetch used to send the text "null" to the tag, blanking it.
    const template = await this.fetchRemoteJSON(args.RemoteURL);
    await this.SaveJSON({
      mac: deviceId,
      json: JSON.stringify(template),
    });
  }

  // fetch local JSON and display it on the tag
  async cardShowLocalJSON(args, state) {
    this.homey.log('CardManager: cardShowLocalJSON');
    const deviceId = args.Id.getData().id;

    const template = this.parseTemplate(args.JSON);
    await this.SaveJSON({
      mac: deviceId,
      json: JSON.stringify(template),
    });
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
    const gateway = this.requireGateway();

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
      await http.post(`http://${gateway}/tag_cmd`, qs.stringify({ mac, cmd: 'clear' }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const response = await http.get(`http://${gateway}/led_flash`, {
        params: { mac, pattern },
      });
      this.homey.log(`CardManager: cardLedFlash ${mac} ${pattern}: ${response.data}`);
    } catch (error) {
      this.homey.log('CardManager: cardLedFlash failed:', error.message);
      throw new Error(this.t('errors.requestFailed', { gateway, error: error.message }));
    }
  }

  async SaveJSON(data) {
    this.homey.log('CardManager: SaveJSON');
    const gateway = this.requireGateway();

    try {
      this.homey.log(`CardManager: SaveJSON: ${JSON.stringify(data)}`);

      const response = await http.post(`http://${gateway}/jsonupload`, qs.stringify(data), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      this.homey.log('CardManager: SaveJSON ok:', response.data);
    } catch (error) {
      this.homey.log('CardManager: SaveJSON failed:', error.message);
      throw new Error(this.t('errors.requestFailed', { gateway, error: error.message }));
    }
  }

  async SaveConfig(data) {
    const gateway = this.requireGateway();
    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `http://${gateway}/save_cfg`,
      headers: {
        Accept: ' */*',
        'Accept-Encoding': ' gzip, deflate',
        Connection: ' keep-alive',
        'Content-Type': ' multipart/form-data; boundary=----WebKitFormBoundarybBNp1y5OGFqhCfxl',
        Origin: ` http://${gateway}`,
        Referer: ` http://${gateway}/`,
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
      const response = await http.request(config);
      this.homey.log('CardManager: SaveConfig ok:', JSON.stringify(response.data));
      return response.data;
    } catch (error) {
      this.homey.log('CardManager: SaveConfig failed:', error.message || error);
      throw new Error(this.t('errors.requestFailed', { gateway, error: error.message || String(error) }));
    }
  }

  /**
   * The AP's record for one tag.
   *
   * @throws when the AP cannot be reached or does not know the tag; the
   *         cards used to carry on with an empty list and crash on tags[0]
   */
  async fetchTag(mac) {
    const gateway = this.requireGateway();

    let response;
    try {
      response = await http.get(`http://${gateway}/get_db`, { params: { mac } });
    } catch (error) {
      this.homey.log('CardManager: fetchTag failed:', error.message);
      throw new Error(this.t('errors.unreachable', { gateway, error: error.message }));
    }

    const tags = response.data && Array.isArray(response.data.tags) ? response.data.tags : [];
    // Matched on the MAC rather than taking the first entry: an AP that
    // ignored the filter would otherwise hand back some other tag, whose
    // alias and rotation would then be written onto this one.
    const tag = tags.find((candidate) => normalizeMac(candidate.mac) === normalizeMac(mac));
    if (!tag) {
      throw new Error(this.t('errors.tagUnknown', { gateway, mac }));
    }
    return tag;
  }

}

module.exports = CardManager;
