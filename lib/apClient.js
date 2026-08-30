'use strict';

const axios = require('axios');

/**
 * Talking to the OpenEPaperLink AP's tag database.
 *
 * /get_db is paginated: it returns at most a page of tags at a time and sets a
 * `continu` key when there are more. The app used to request
 * `?pos=<continu>`, which the AP parses with atoi() - that evaluates to 0, so
 * every call returned the first page and nothing else. On a setup with more
 * than a page of tags the rest were simply invisible.
 */

const PAGE_GUARD = 100; // pages, not tags - a stop so a bad AP cannot loop us

/**
 * Fetches the AP's entire tag database, following pagination.
 *
 * @param {string} gateway  AP host or IP
 * @param {object} [options]
 * @param {number} [options.timeout]  per-request timeout in ms
 * @returns {Promise<Array<object>>} every tag the AP knows about
 */
async function fetchAllTags(gateway, options = {}) {
  if (!gateway) throw new Error('No gateway configured');

  const timeout = options.timeout || 15000;
  const tags = [];
  const seen = new Set();
  let pos = 0;

  for (let page = 0; page < PAGE_GUARD; page++) {
    // eslint-disable-next-line no-await-in-loop
    const response = await axios.get(`http://${gateway}/get_db?pos=${pos}`, { timeout });
    const data = response.data;
    if (!data || !Array.isArray(data.tags)) {
      throw new Error(`Unexpected response from ${gateway}/get_db`);
    }

    for (const tag of data.tags) {
      // The AP can repeat a tag across pages if its DB shifts mid-walk.
      const key = String(tag.mac || '').toUpperCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }

    // `continu` is only present while more pages remain.
    if (data.continu === undefined || data.tags.length === 0) break;
    pos += data.tags.length;
  }

  return tags;
}

module.exports = { fetchAllTags };
