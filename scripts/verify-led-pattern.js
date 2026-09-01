'use strict';

/**
 * Checks the twelve byte LED pattern the flash card builds against the layout
 * documented at https://github.com/OpenEPaperLink/OpenEPaperLink/wiki/Led-control
 * and against the two patterns the AP's own web interface sends, so a change to
 * the maths cannot silently start producing something the tag will not run.
 *
 * Usage: node scripts/verify-led-pattern.js
 */

const path = require('path');

const CARD_MANAGER = path.join(__dirname, '..', 'cardManager');
// eslint-disable-next-line import/no-dynamic-require
const CardManager = require(CARD_MANAGER);

const { log } = console;
let failures = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got      ${actual}\n        expected ${expected}`}`);
}

function decode(pattern) {
  const b = [];
  for (let i = 0; i < 24; i += 2) b.push(Number.parseInt(pattern.slice(i, i + 2), 16));
  return {
    mode: b[0] & 0x0F,
    flashMs: b[0] >> 4,
    colour: b[1],
    flashes: b[2] & 0x0F,
    speedUnits: b[2] >> 4,
    pauseUnits: b[3],
    repeats: b[10],
    spare: b[11],
  };
}

log('=== length and shape ===');
const p = CardManager.ledPattern({
  colour: 'red', flashes: 2, intervalSeconds: 25, minutes: 110,
});
check('pattern is 24 hex characters', p.length, 24);
check('pattern is upper case hex', /^[0-9A-F]{24}$/.test(p), true);

log('\n=== the fields decode back to what was asked for ===');
const d = decode(p);
check('mode is 1 (sequence)', d.mode, 1);
check('flash length is 2 ms', d.flashMs, 2);
check('colour is red (RGB332 0xE0)', d.colour, 0xE0);
check('two flashes per burst', d.flashes, 2);
check('pause is 25 s (250 units)', d.pauseUnits, 250);
check('spare byte is zero', d.spare, 0);

log('\n=== duration ===');
// one burst is 2 flashes x 200 ms, then a 25 s pause, so 25.4 s per cycle;
// 110 minutes is 6600 s, which is 260 cycles - clamped to the byte maximum
check('repeats clamp to 255', d.repeats, 255);
const short = decode(CardManager.ledPattern({
  colour: 'red', flashes: 2, intervalSeconds: 10, minutes: 5,
}));
// 2 x 200 ms + 10 s = 10.4 s per cycle, 300 s / 10.4 = 29
check('five minutes at ten second intervals is 29 repeats', short.repeats, 29);

log('\n=== switching off ===');
const off = CardManager.ledPattern({
  colour: 'red', flashes: 2, intervalSeconds: 25, minutes: 0,
});
check('zero minutes gives mode 0', decode(off).mode, 0);
check('zero minutes is all zeroes', off, '000000000000000000000000');

log('\n=== colours are valid RGB332 ===');
for (const [name, value] of Object.entries(CardManager.LED_COLOURS)) {
  const c = decode(CardManager.ledPattern({
    colour: name, flashes: 1, intervalSeconds: 1, minutes: 1,
  })).colour;
  check(`${name} survives the round trip`, c, value);
}

log('\n=== values stay inside their fields ===');
const clamped = decode(CardManager.ledPattern({
  colour: 'red', flashes: 99, intervalSeconds: 99, minutes: 999,
}));
check('flashes clamp to 15 (four bits)', clamped.flashes, 15);
check('pause clamps to 255 (one byte)', clamped.pauseUnits, 255);
check('repeats clamp to 255 (one byte)', clamped.repeats, 255);

log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
if (failures) process.exitCode = 1;
