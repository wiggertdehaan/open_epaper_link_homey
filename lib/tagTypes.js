'use strict';

const fs = require('fs');
const path = require('path');

const { http } = require('./http');

/**
 * Tag type definitions: what /tagtypes/<hw>.json on the AP says about a
 * hardware type (size, colours, rotation, LED and buttons).
 *
 * Where a definition comes from, in order:
 *
 *   1. the copy on disk, written by an earlier fetch, while it is fresh;
 *   2. the AP itself, which is authoritative - it renders with these files, and
 *      a firmware upgrade can change them;
 *   3. the copy on disk even when stale, then the one shipped with the app,
 *      when the AP cannot be asked.
 *
 * The disk copy used to be kept forever and preferred over everything, so a
 * definition the AP later corrected was never picked up, and one bad response
 * (an error object, `{}`) broke rendering for that tag type for good. Now
 * nothing is cached until it looks like a tag type, and copies expire.
 */

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// How soon to ask the AP again after it could not supply a definition. Short
// enough to recover quickly once it is back, long enough that a tag type the
// AP does not know is not asked for on every check-in.
const RETRY_MS = 5 * 60 * 1000;

/** A hardware type is one byte on the wire. */
function isValidHwType(hwType) {
  return Number.isInteger(hwType) && hwType >= 0 && hwType <= 255;
}

/**
 * Whether a parsed JSON body is a tag type definition at all.
 *
 * Deliberately not whether it can be rendered: some real definitions (for
 * segment displays, or tags with no display) have no size and no colour
 * table, and they are still what the AP says about that hardware.
 */
function isTagType(data) {
  return Boolean(data)
    && typeof data === 'object'
    && !Array.isArray(data)
    && typeof data.name === 'string'
    && Number.isInteger(data.width) && data.width >= 0
    && Number.isInteger(data.height) && data.height >= 0;
}

function hexOf(hwType) {
  return hwType.toString(16).padStart(2, '0').toUpperCase();
}

class TagTypeStore {

  /**
   * @param {object} options
   * @param {string} options.cacheDir    where fetched definitions are kept
   * @param {string} options.bundledDir  definitions shipped with the app
   * @param {function(): string|null} options.getGateway
   * @param {function(...*)} [options.log]
   * @param {number} [options.maxAgeMs]
   * @param {number} [options.retryMs]
   */
  constructor(options) {
    this.cacheDir = options.cacheDir;
    this.bundledDir = options.bundledDir;
    this.getGateway = options.getGateway;
    this.log = options.log || (() => {});
    this.maxAgeMs = options.maxAgeMs || MAX_AGE_MS;
    this.retryMs = options.retryMs || RETRY_MS;

    // hwType -> { data, expiresAt }
    this.memory = new Map();
    // hwType -> Promise, so a burst of tags of one new type costs one fetch
    this.loading = new Map();
  }

  /** Forgets what is held in memory, eg. when the AP address changes. */
  clear() {
    this.memory.clear();
  }

  /**
   * @param {number} hwType
   * @returns {Promise<object|null>} the definition, or null if none is known
   */
  async get(hwType) {
    // hwType arrives in websocket frames and ends up in a file path, so it
    // is checked before it is used for anything.
    if (!isValidHwType(hwType)) {
      this.log('Ignoring invalid hwType:', hwType);
      return null;
    }

    const held = this.memory.get(hwType);
    if (held && Date.now() < held.expiresAt) return held.data;

    if (!this.loading.has(hwType)) {
      const load = this.load(hwType, held ? held.data : null)
        .finally(() => this.loading.delete(hwType));
      this.loading.set(hwType, load);
    }
    return this.loading.get(hwType);
  }

  async load(hwType, previous) {
    const hex = hexOf(hwType);
    const cachedPath = path.join(this.cacheDir, `${hex}.json`);
    const cached = this.readFile(cachedPath);

    if (cached && Date.now() - cached.mtimeMs < this.maxAgeMs) {
      return this.remember(hwType, cached.data, cached.mtimeMs + this.maxAgeMs);
    }

    const fetched = await this.fetch(hex);
    if (fetched) {
      this.writeFile(cachedPath, fetched);
      return this.remember(hwType, fetched, Date.now() + this.maxAgeMs);
    }

    // The AP could not help. Anything is better than nothing, but try the AP
    // again soon rather than settling on a fallback for a week.
    const fallback = (cached && cached.data)
      || previous
      || (this.readFile(path.join(this.bundledDir, `${hex}.json`)) || {}).data
      || null;
    if (!fallback) {
      this.log(`No tag type definition available for hwType ${hwType}`);
      return null;
    }
    return this.remember(hwType, fallback, Date.now() + this.retryMs);
  }

  remember(hwType, data, expiresAt) {
    this.memory.set(hwType, { data, expiresAt });
    return data;
  }

  /** A definition from disk, or null if there is none or it is unusable. */
  readFile(filePath) {
    let raw;
    let stat;
    try {
      stat = fs.statSync(filePath);
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }

    try {
      const data = JSON.parse(raw);
      if (isTagType(data)) return { data, mtimeMs: stat.mtimeMs };
      this.log(`Ignoring ${filePath}: not a tag type definition`);
    } catch (error) {
      this.log(`Ignoring ${filePath}:`, error.message);
    }
    return null;
  }

  /** Writes via a temporary file, so a crash cannot leave half a definition. */
  writeFile(filePath, data) {
    const temporary = `${filePath}.tmp`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(temporary, filePath);
    } catch (error) {
      this.log('Could not save tag type definition:', error.message);
      try {
        fs.unlinkSync(temporary);
      } catch {
        // nothing was written
      }
    }
  }

  async fetch(hex) {
    const gateway = this.getGateway();
    if (!gateway) return null;

    const url = `http://${gateway}/tagtypes/${hex}.json`;
    try {
      this.log('Fetching tag type definition:', url);
      const { data } = await http.get(url);
      if (isTagType(data)) return data;
      this.log(`The AP's answer for ${url} is not a tag type definition`);
    } catch (error) {
      this.log(`Could not fetch ${url}:`, error.message);
    }
    return null;
  }

}

module.exports = {
  TagTypeStore, isTagType, isValidHwType, MAX_AGE_MS, RETRY_MS,
};
