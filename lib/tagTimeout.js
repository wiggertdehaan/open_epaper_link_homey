'use strict';

/**
 * Deciding when a tag has stopped checking in.
 *
 * A tag reports on its own schedule and sleeps in between, so the app only
 * hears about it when it checks in. That is exactly why a tag going quiet
 * cannot be noticed from the websocket: silence produces no message. It has to
 * be looked for, by comparing the AP's own expectation against the clock.
 *
 * The AP publishes two timestamps per tag:
 *
 *   lastseen     when it last heard from the tag
 *   nextcheckin  when it expects to hear from it again
 *
 * The difference between them is the tag's own check-in interval, which varies
 * from minutes to many hours depending on how the tag is configured. A fixed
 * grace period would therefore be wrong at one end or the other: half an hour
 * is an eternity for a tag that reports every five minutes, and hair-trigger
 * for one that reports twice a day.
 */

// Never call a tag late until at least this much time has passed, however
// short its interval. Tags drift, and radio check-ins get missed and retried.
const MINIMUM_GRACE_MS = 15 * 60 * 1000;

// On top of that, allow half the tag's own interval.
const GRACE_FRACTION = 0.5;

/**
 * How long after nextcheckin a tag is allowed to stay quiet.
 *
 * @param {object} tag  a tag record from /get_db
 * @returns {number} milliseconds
 */
function graceFor(tag) {
  const interval = (Number(tag.nextcheckin) - Number(tag.lastseen)) * 1000;
  if (!Number.isFinite(interval) || interval <= 0) return MINIMUM_GRACE_MS;
  return Math.max(MINIMUM_GRACE_MS, interval * GRACE_FRACTION);
}

/**
 * Whether a tag has missed its expected check-in by more than the grace.
 *
 * @param {object} tag   a tag record from /get_db
 * @param {number} [now] milliseconds since the epoch
 * @returns {boolean}
 */
function isTimedOut(tag, now = Date.now()) {
  if (!tag) return false;

  const nextCheckin = Number(tag.nextcheckin);
  // A tag the AP has no expectation for cannot be late. This covers a tag that
  // has only just been discovered, where nextcheckin is still zero.
  if (!Number.isFinite(nextCheckin) || nextCheckin <= 0) return false;

  const lastSeen = Number(tag.lastseen);
  if (!Number.isFinite(lastSeen) || lastSeen <= 0) return false;

  return now > (nextCheckin * 1000) + graceFor(tag);
}

/** Minutes a tag has been overdue, for the flow token. */
function overdueMinutes(tag, now = Date.now()) {
  const nextCheckin = Number(tag.nextcheckin);
  if (!Number.isFinite(nextCheckin) || nextCheckin <= 0) return 0;
  return Math.max(0, Math.round((now - nextCheckin * 1000) / 60000));
}

module.exports = {
  MINIMUM_GRACE_MS, GRACE_FRACTION, graceFor, isTimedOut, overdueMinutes,
};
