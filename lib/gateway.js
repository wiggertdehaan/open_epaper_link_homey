'use strict';

/**
 * The AP address, as typed into the app settings, turned into something a URL
 * can be built from.
 *
 * The settings field asks for a bare address, but people paste what their
 * browser shows: `http://192.168.1.10/`, with a trailing space more often than
 * not. Every URL in the app is built as `http://${gateway}/...`, so each of
 * those used to end up as `http://http://192.168.1.10//get_db` and fail with an
 * error that says nothing about the setting being the problem.
 *
 * Everything that needs the address reads it through readGateway(), so there
 * is one place that decides what a usable address is.
 */

// One DNS label: letters, digits and inner hyphens. An IPv4 address is four of
// these, so it needs no rule of its own.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`, 'i');

/**
 * @param {*} value  whatever is stored in the `gateway` setting
 * @returns {string|null}  `host` or `host:port`, or null if it is not usable
 */
function normalizeGateway(value) {
  if (typeof value !== 'string') return null;

  const address = value
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // scheme
    .replace(/[/?#].*$/, ''); // path, query, fragment
  if (!address) return null;

  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(address);
  if (!match) return null;

  const [, host, port] = match;
  if (!HOST_RE.test(host)) return null;
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;

  return port ? `${host}:${port}` : host;
}

/**
 * The configured AP address, normalised, or null when none is usable.
 *
 * @param {object} homey  anything with `settings.get`
 */
function readGateway(homey) {
  return normalizeGateway(homey.settings.get('gateway'));
}

module.exports = { normalizeGateway, readGateway };
