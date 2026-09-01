'use strict';

/* eslint-disable no-console */
/**
 * Checks when lib/tagTimeout.js calls a tag late, against real tag shapes.
 *
 * The risk here is false alarms: a tag that reports twice a day is not in
 * trouble for being twenty minutes late, and a flow that says otherwise is
 * worse than no flow at all.
 *
 * Run: node scripts/verify-tag-timeout.js
 */

const { isTimedOut, graceFor, overdueMinutes } = require('../lib/tagTimeout');

const NOW = 1788300000000; // fixed clock, milliseconds
const s = (ms) => Math.floor(ms / 1000);
const MIN = 60 * 1000;

// A tag whose interval is `intervalMin` and whose next check-in was
// `dueMinAgo` minutes ago (negative means still in the future).
function tag(intervalMin, dueMinAgo) {
  const nextcheckin = s(NOW - dueMinAgo * MIN);
  return { mac: 'AA', nextcheckin, lastseen: nextcheckin - intervalMin * 60 };
}

const checks = [
  ['a tag due in the future is fine',
    isTimedOut(tag(60, -10), NOW) === false],

  ['a tag five minutes late is not called late yet',
    isTimedOut(tag(60, 5), NOW) === false],

  ['a fast tag gets the 15 minute floor, not half its interval',
    graceFor(tag(5, 0)) === 15 * MIN],

  ['a 5-minute tag is fine at 14 minutes late',
    isTimedOut(tag(5, 14), NOW) === false],

  ['a 5-minute tag is late at 16 minutes',
    isTimedOut(tag(5, 16), NOW) === true],

  ['a 12-hour tag gets half its interval as grace',
    graceFor(tag(720, 0)) === 360 * MIN],

  ['a 12-hour tag is not late after 2 hours',
    isTimedOut(tag(720, 120), NOW) === false],

  ['a 12-hour tag is late after 7 hours',
    isTimedOut(tag(720, 420), NOW) === true],

  ['a tag with no expected check-in is never late',
    isTimedOut({ mac: 'AA', nextcheckin: 0, lastseen: 0 }, NOW) === false],

  ['a freshly discovered tag is never late',
    isTimedOut({ mac: 'AA', nextcheckin: 0, lastseen: s(NOW) }, NOW) === false],

  ['a tag never heard from is never late',
    isTimedOut({ mac: 'AA', nextcheckin: s(NOW - 60 * MIN), lastseen: 0 }, NOW) === false],

  ['rubbish input does not throw or fire',
    isTimedOut({}, NOW) === false && isTimedOut(null, NOW) === false],

  ['overdue minutes are reported',
    overdueMinutes(tag(60, 90), NOW) === 90],

  ['a tag not yet due reports zero overdue',
    overdueMinutes(tag(60, -30), NOW) === 0],
];

let failures = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

console.log('');
console.log(`grace for a 5 min tag   ${graceFor(tag(5, 0)) / MIN} min`);
console.log(`grace for a 1 hour tag  ${graceFor(tag(60, 0)) / MIN} min`);
console.log(`grace for a 12 hour tag ${graceFor(tag(720, 0)) / MIN} min`);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
