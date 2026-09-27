'use strict';

/* eslint-disable no-console */
/**
 * Covers what the action cards send to the AP, and that they fail loudly.
 *
 * Runs against a stand-in AP on localhost that records every request, so it
 * checks the actual bytes that would reach a real one: the mode config must be
 * valid JSON whatever the user typed, the tag's own rotation and colour
 * settings must survive, and every failure must reach the flow as an error
 * rather than be logged and forgotten.
 *
 * Run: node scripts/verify-card-manager.js
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');

const realLoad = Module._load;
Module._load = function stubbed(request) {
  if (request === 'homey') {
    return {
      App: class {

        log() {}

      },
      Device: class {},
      Driver: class {},
    };
  }
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const CardManager = require('../cardManager');
const MyApp = require('../app');

const MAC = 'AABBCCDDEEFF0001';
const TAG = {
  mac: MAC, alias: 'Kitchen', rotate: 2, lut: 1, invert: 1,
};

const translations = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8'));
const translate = (key, tokens = {}) => {
  const value = key.split('.').reduce((o, k) => (o || {})[k], translations);
  return value ? value.replace(/__(\w+)__/g, (_, t) => tokens[t]) : undefined;
};

/** Form fields from a multipart body. */
function multipartFields(body) {
  const fields = {};
  const re = /name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g;
  let match = re.exec(body);
  while (match) {
    const [, name, value] = match;
    fields[name] = value;
    match = re.exec(body);
  }
  return fields;
}

(async () => {
  const requests = [];
  let failNext = false;

  const ap = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url, 'http://ap');
      requests.push({
        method: req.method, path: url.pathname, query: url.searchParams, body,
      });

      if (failNext) {
        failNext = false;
        res.statusCode = 500;
        res.end('boom');
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      switch (url.pathname) {
        case '/get_db': {
          const wanted = url.searchParams.get('mac');
          res.end(JSON.stringify({ tags: wanted === MAC ? [TAG] : [] }));
          return;
        }
        case '/template-ok':
          res.end(JSON.stringify([{ text: [5, 5, 'hi', 'bahnschrift20', 1, 0, 0] }]));
          return;
        case '/template-object':
          res.end(JSON.stringify({ not: 'a list' }));
          return;
        case '/template-huge':
          res.end(`[${'"x",'.repeat(700000)}"x"]`);
          return;
        default:
          res.end('"OK"');
      }
    });
  });
  await new Promise((resolve) => ap.listen(0, '127.0.0.1', resolve));
  const gateway = `127.0.0.1:${ap.address().port}`;

  let configured = gateway;
  const manager = new CardManager({
    log: () => {},
    getGateway: () => configured,
    homey: { __: translate },
  });

  const device = (mac = MAC) => ({ getData: () => ({ id: mac }) });
  const lastSave = () => multipartFields(requests.filter((r) => r.path === '/save_cfg').pop().body);
  const rejects = async (fn) => {
    try {
      await fn();
      return null;
    } catch (error) {
      return error.message;
    }
  };

  const checks = [];

  // Mode config is real JSON, whatever the text contains
  await manager.cardShowCurrentWeather({ Id: device(), Location: 'Amsterdam "centrum" \\ oost', Units: '1' });
  let saved = lastSave();
  let config = null;
  try {
    config = JSON.parse(saved.modecfgjson);
  } catch {
    // stays null
  }
  checks.push(['a location with quotes and a backslash is valid JSON',
    config && config.location === 'Amsterdam "centrum" \\ oost' && config.units === '1']);

  // The tag's own display settings survive
  checks.push(['rotate, lut and invert are kept from the AP',
    saved.rotate === '2' && saved.lut === '1' && saved.invert === '1']);
  checks.push(['the alias is kept', saved.alias === 'Kitchen']);
  checks.push(['the content mode is set', saved.contentmode === '4']);

  await manager.cardShowQRCode({ Id: device(), Title: 'Wi-Fi', QRContent: 'WIFI:S:"home";P:x;;' });
  config = JSON.parse(lastSave().modecfgjson);
  checks.push(['QR content survives intact', config['qr-content'] === 'WIFI:S:"home";P:x;;']);

  // The image card's interval reaches the AP under the key it reads
  await manager.cardShowImage({ Id: device(), URL: 'http://example.com/a.jpg', Interval: 15 });
  config = JSON.parse(lastSave().modecfgjson);
  checks.push(['the image interval is sent as `interval`', config.interval === '15' && !('Interval' in config)]);

  // Counters carry their values in the mode config
  await manager.cardShowCountDays({ Id: device(), Counter: 12, Threshold: 30 });
  saved = lastSave();
  config = JSON.parse(saved.modecfgjson);
  checks.push(['the day counter sends counter and threshold in the config',
    config.counter === '12' && config.thresholdred === '30']);
  checks.push(['and still as the separate fields it always sent', saved.counter === '12' && saved.thresholdred === '30']);

  // Failures reach the flow
  const unknown = await rejects(() => manager.cardShowCurrentDate({ Id: device('0000000000000000') }));
  checks.push(['a tag the AP does not know fails the card', /does not know tag/.test(unknown || '')]);

  configured = null;
  const noGateway = await rejects(() => manager.cardShowCurrentDate({ Id: device() }));
  checks.push(['no configured AP fails the card', /app settings/.test(noGateway || '')]);
  const noGatewayJson = await rejects(() => manager.cardShowLocalJSON({ Id: device(), JSON: '[]' }));
  checks.push(['also for the JSON cards', /app settings/.test(noGatewayJson || '')]);
  const noGatewayLed = await rejects(() => manager.cardLedFlash({
    Id: device(), Colour: 'red', Flashes: 1, Interval: 1, Minutes: 1,
  }));
  checks.push(['and for the LED card', /app settings/.test(noGatewayLed || '')]);

  configured = '127.0.0.1:1';
  const unreachable = await rejects(() => manager.cardShowCurrentDate({ Id: device() }));
  checks.push(['an unreachable AP fails the card', /Could not reach/.test(unreachable || '')]);
  configured = gateway;

  failNext = false;
  const saveCount = requests.filter((r) => r.path === '/save_cfg').length;
  // get_db succeeds, then save_cfg gets the 500
  const origFetch = manager.fetchTag.bind(manager);
  manager.fetchTag = async (mac) => {
    const tag = await origFetch(mac);
    failNext = true;
    return tag;
  };
  const refused = await rejects(() => manager.cardShowCurrentDate({ Id: device() }));
  manager.fetchTag = origFetch;
  checks.push(['an AP refusing the config fails the card',
    /did not accept/.test(refused || '') && requests.filter((r) => r.path === '/save_cfg').length === saveCount + 1]);

  failNext = true;
  const ledRefused = await rejects(() => manager.cardLedFlash({
    Id: device(), Colour: 'red', Flashes: 1, Interval: 1, Minutes: 1,
  }));
  checks.push(['an AP refusing the LED command fails the card', /did not accept/.test(ledRefused || '')]);

  // JSON templates are checked before anything is sent
  const uploadsBefore = requests.filter((r) => r.path === '/jsonupload').length;
  const badJson = await rejects(() => manager.cardShowLocalJSON({ Id: device(), JSON: '[{ "text": [1, 2' }));
  const notList = await rejects(() => manager.cardShowLocalJSON({ Id: device(), JSON: '{"text": [1]}' }));
  checks.push(['invalid template JSON fails the card', /not valid JSON/.test(badJson || '')]);
  checks.push(['a template that is not a list fails the card', /JSON list/.test(notList || '')]);
  checks.push(['and neither reached the AP', requests.filter((r) => r.path === '/jsonupload').length === uploadsBefore]);

  await manager.cardShowLocalJSON({ Id: device(), JSON: ' [{"text":[5,5,"ok","bahnschrift20",1,0,0]}] ' });
  const upload = new URLSearchParams(requests.filter((r) => r.path === '/jsonupload').pop().body);
  checks.push(['a valid template is sent', upload.get('mac') === MAC && JSON.parse(upload.get('json'))[0].text[2] === 'ok']);

  const remoteDown = await rejects(() => manager.cardShowRemoteJSON({ Id: device(), RemoteURL: 'http://127.0.0.1:1/t.json' }));
  checks.push(['an unreachable remote template fails the card', /Could not fetch the template/.test(remoteDown || '')]);
  const remoteObject = await rejects(() => manager.cardShowRemoteJSON({ Id: device(), RemoteURL: `http://${gateway}/template-object` }));
  checks.push(['a remote template that is not a list fails the card', /JSON list/.test(remoteObject || '')]);
  const remoteHuge = await rejects(() => manager.cardShowRemoteJSON({ Id: device(), RemoteURL: `http://${gateway}/template-huge` }));
  checks.push(['a remote template over the size cap fails the card', /Could not fetch the template.*maxContentLength/.test(remoteHuge || '')]);
  const uploadsBeforeRemote = requests.filter((r) => r.path === '/jsonupload').length;
  await manager.cardShowRemoteJSON({ Id: device(), RemoteURL: `http://${gateway}/template-ok` });
  checks.push(['a good remote template is sent', requests.filter((r) => r.path === '/jsonupload').length === uploadsBeforeRemote + 1]);

  // The app passes card errors on to Homey
  const app = Object.create(MyApp.prototype);
  app.log = () => {};
  let listener;
  app.registerActionCardHandler({
    id: 'test',
    registerRunListener: (fn) => {
      listener = fn;
    },
  }, async () => {
    throw new Error('the AP said no');
  });
  const passedOn = await rejects(() => listener({}, {}));
  checks.push(['a failing card handler rejects the flow card', passedOn === 'the AP said no']);

  ap.close();

  let failures = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures++;
  }
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((error) => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
