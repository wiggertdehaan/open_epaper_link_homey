'use strict';

const axios = require('axios');

/**
 * The one HTTP client the app uses.
 *
 * axios waits forever by default, and reads a response of any size into
 * memory. Neither is acceptable here: the AP is an ESP32 that can stall
 * mid-response, which left a flow card hanging with no error, and the remote
 * JSON card fetches whatever URL a flow hands it. Every request therefore gets
 * a timeout and a size cap, which a caller can still override per request.
 */

const DEFAULT_TIMEOUT_MS = 10000;

// Comfortably above the largest thing the app downloads on purpose: a 2 bpp
// framebuffer for a 13" panel is under 500 kB, a page of /get_db a few kB.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const http = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
  maxContentLength: MAX_RESPONSE_BYTES,
  maxBodyLength: MAX_RESPONSE_BYTES,
});

module.exports = { http, DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES };
