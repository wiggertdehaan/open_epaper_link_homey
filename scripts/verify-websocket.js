'use strict';

/* eslint-disable no-console */
/**
 * Covers the app's websocket connection to the AP: that tearing it down can
 * never crash the app, that a connection which has silently died is noticed,
 * that reconnects back off, and that a `sys` frame is applied before the tags
 * in the same frame.
 *
 * Run: node scripts/verify-websocket.js
 */

const net = require('net');
const Module = require('module');
const { WebSocketServer } = require('ws');

const realLoad = Module._load;
Module._load = function stubbed(request) {
  if (request === 'homey') {
    return {
      App: class {

        log() {}

        error() {}

      },
      Device: class {},
      Driver: class {},
    };
  }
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const MyApp = require('../app');

let uncaught = null;
process.on('uncaughtException', (error) => {
  uncaught = error;
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Just enough of the Homey object for the app's onInit. */
function makeHomey(gateway) {
  const store = { gateway };
  const listeners = {};
  const emit = (event, key) => (listeners[event] || []).forEach((fn) => fn(key));
  const homey = {
    // When set, timers fire almost at once and record what they asked for.
    fast: false,
    settings: {
      get: (key) => store[key],
      set: (key, value) => {
        store[key] = value; emit('set', key);
      },
      unset: (key) => {
        delete store[key]; emit('unset', key);
      },
      on: (event, fn) => {
        (listeners[event] = listeners[event] || []).push(fn);
      },
    },
    setTimeout: (fn, ms) => setTimeout(fn, homey.fast ? 5 : ms),
    clearTimeout: (t) => clearTimeout(t),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (t) => clearInterval(t),
    flow: {
      getActionCard: (id) => ({ id, registerRunListener() {} }),
      getDeviceTriggerCard: () => ({ trigger: async () => {} }),
    },
    drivers: {
      getDrivers: () => ({}),
      getDriver: () => {
        throw new Error('not ready');
      },
    },
    __: (key) => key,
  };
  return homey;
}

async function makeApp(gateway) {
  const app = new MyApp();
  app.homey = makeHomey(gateway);
  await app.onInit();
  return app;
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

(async () => {
  const checks = [];

  // 1. Changing the address, or stopping the app, while a connection attempt
  //    is still in its handshake. An AP that accepts TCP but never answers the
  //    upgrade holds the socket there for as long as we like.
  const mute = net.createServer(() => {});
  const mutePort = await listen(mute);

  const app1 = await makeApp(`127.0.0.1:${mutePort}`);
  await wait(100);
  const connectingBefore = app1.socket && app1.socket.readyState === 0;
  app1.homey.settings.set('gateway', `127.0.0.1:${mutePort}`);
  await wait(300);
  checks.push(['the test really catches the socket mid-handshake', connectingBefore]);
  checks.push(['changing the address mid-handshake does not crash the app', uncaught === null]);

  await app1.onUninit();
  await wait(300);
  checks.push(['stopping the app mid-handshake does not crash it', uncaught === null]);
  checks.push(['stopping the app leaves no socket or reconnect behind', !app1.socket && !app1.reconnectTimeout]);

  // 2. A connection whose far end has gone without closing it: the server
  //    stops reading, so nothing arrives and pings go unanswered.
  const silent = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => silent.once('listening', resolve));
  silent.on('connection', (client) => {
    // eslint-disable-next-line no-underscore-dangle
    client._socket.pause();
  });

  const app2 = await makeApp(`127.0.0.1:${silent.address().port}`);
  await wait(200);
  const openedFirst = app2.socket && app2.socket.readyState === 1;
  app2.wsIdleTimeoutMs = 300;
  app2.wsPingAfterMs = 100;
  for (let i = 0; i < 20 && app2.socket; i++) {
    app2.checkSocket();
    // eslint-disable-next-line no-await-in-loop
    await wait(50);
  }
  checks.push(['the test really had an open connection', openedFirst]);
  checks.push(['a silent connection is dropped', !app2.socket]);
  checks.push(['and a reconnect is scheduled', Boolean(app2.reconnectTimeout)]);
  checks.push(['the next attempt backs off', app2.reconnectDelayMs === MyApp.WS_RECONNECT_MIN_MS * 2]);
  await app2.onUninit();
  silent.close();

  // 3. An AP that refuses every connection: the delay doubles up to its cap.
  const closed = net.createServer();
  const closedPort = await listen(closed);
  closed.close();

  const app3 = new MyApp();
  app3.homey = makeHomey(`127.0.0.1:${closedPort}`);
  const delays = [];
  const schedule = app3.scheduleReconnect.bind(app3);
  app3.scheduleReconnect = () => {
    if (!app3.reconnectTimeout) delays.push(app3.reconnectDelayMs);
    schedule();
  };
  await app3.onInit();
  app3.homey.fast = true;
  for (let i = 0; i < 100 && delays.length < 9; i++) {
    // eslint-disable-next-line no-await-in-loop
    await wait(20);
  }
  await app3.onUninit();
  console.log(`reconnect delays: ${delays.map((d) => `${d / 1000}s`).join(', ')}`);
  checks.push(['reconnect delays double', delays[0] === 5000 && delays[1] === 10000 && delays[2] === 20000]);
  checks.push(['and stop at five minutes', delays.length >= 9 && delays[8] === MyApp.WS_RECONNECT_MAX_MS]);

  // 4. A frame carrying both `sys` and `tags`: the AP clock is known by the
  //    time the tags are handled.
  const talker = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => talker.once('listening', resolve));
  const apTime = Math.floor(Date.now() / 1000) - 3600;
  talker.on('connection', (client) => {
    client.send(JSON.stringify({ sys: { currtime: apTime }, tags: [{ mac: 'AABBCCDDEEFF0001' }] }));
  });

  const app4 = await makeApp(`127.0.0.1:${talker.address().port}`);
  let apNowDuringTags = null;
  app4.tagManager.updateTags = async () => {
    apNowDuringTags = app4.apNow();
  };
  await wait(300);
  const skew = apNowDuringTags === null ? null : Math.round((Date.now() - apNowDuringTags) / 1000);
  console.log(`AP clock an hour behind, seen while handling tags as ${skew} s behind`);
  checks.push(['the AP clock is applied before the tags', skew !== null && Math.abs(skew - 3600) <= 2]);
  checks.push(['a connection that works resets the backoff', app4.reconnectDelayMs === MyApp.WS_RECONNECT_MIN_MS]);
  await app4.onUninit();
  talker.close();
  mute.close();

  checks.push(['no uncaught exception anywhere', uncaught === null]);
  if (uncaught) console.log('uncaught:', uncaught.message);

  console.log('');
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
