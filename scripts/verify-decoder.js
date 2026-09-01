'use strict';

/* eslint-disable no-console */
/**
 * Verifies lib/rawImage.js against a live AP.
 *
 * Downloads every tag's /current/<mac>.raw plus its tag type, decodes it, and
 * writes a PNG per tag so the result can be compared with what the physical
 * display is showing. Prints container, geometry and rotation per tag.
 *
 * Usage: node scripts/verify-decoder.js [ap-ip] [outdir]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const { decodeRawImage } = require('../lib/rawImage');

const AP = process.argv[2] || '192.168.1.10';
const OUT = process.argv[3] || path.join(__dirname, '..', '.tmp-decode');

function get(p, timeout = 15000) {
  return new Promise((resolve) => {
    const req = http.get(`http://${AP}${p}`, { timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, buf: Buffer.alloc(0) });
    });
    req.on('error', () => resolve({ status: 0, buf: Buffer.alloc(0) }));
  });
}

/** /get_db is paginated: it returns a page at a time and sets `continu`. */
async function fetchAllTags() {
  const tags = [];
  const seen = new Set();
  let pos = 0;
  for (let page = 0; page < 100; page++) {
    // eslint-disable-next-line no-await-in-loop
    const r = await get(`/get_db?pos=${pos}`);
    if (r.status !== 200) break;
    const data = JSON.parse(r.buf.toString('utf8'));
    if (!Array.isArray(data.tags)) break;
    for (const t of data.tags) {
      const key = String(t.mac || '').toUpperCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tags.push(t);
    }
    if (data.continu === undefined || data.tags.length === 0) break;
    pos += data.tags.length;
  }
  return tags;
}

async function toJimp(decoded) {
  const img = new Jimp({ width: decoded.width, height: decoded.height, color: 0xffffffff });
  for (let p = 0; p < decoded.width * decoded.height; p++) {
    img.bitmap.data[p * 4] = decoded.rgb[p * 3];
    img.bitmap.data[p * 4 + 1] = decoded.rgb[p * 3 + 1];
    img.bitmap.data[p * 4 + 2] = decoded.rgb[p * 3 + 2];
    img.bitmap.data[p * 4 + 3] = 255;
  }
  return decoded.rotateDegrees ? img.rotate(decoded.rotateDegrees) : img;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const tags = await fetchAllTags();
  if (tags.length === 0) {
    throw new Error(`No tags from ${AP} - is the address right?`);
  }
  console.log(`AP ${AP}: ${tags.length} tags\n`);

  const typeCache = {};
  let ok = 0;
  let skipped = 0;

  for (const tag of tags) {
    const hex = Number(tag.hwType).toString(16).padStart(2, '0').toUpperCase();
    if (!typeCache[hex]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await get(`/tagtypes/${hex}.json`);
      typeCache[hex] = r.status === 200 ? JSON.parse(r.buf.toString('utf8')) : null;
    }
    const tt = typeCache[hex];
    const label = `${tag.mac} ${(tag.alias || '-').padEnd(10)} hw=0x${hex}`;

    if (!tt) {
      console.log(`${label}  no tag type on the AP`);
      skipped++;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const raw = await get(`/current/${tag.mac}.raw`);
    if (raw.status !== 200 || raw.buf.length === 0) {
      console.log(`${label}  no .raw on the AP`);
      continue;
    }

    try {
      const dec = decodeRawImage(raw.buf, tt);
      // eslint-disable-next-line no-await-in-loop
      const img = await toJimp(dec);
      // eslint-disable-next-line no-await-in-loop
      await img.write(path.join(OUT, `${tag.mac}.png`));
      console.log(`${label}  ${String(raw.buf.length).padStart(5)}B ${dec.container.padEnd(5)}`
        + ` buf=${dec.width}x${dec.height} planes=${dec.planes}`
        + ` rot=${String(dec.rotateDegrees).padStart(4)} -> ${img.bitmap.width}x${img.bitmap.height} OK`);
      ok++;
    } catch (err) {
      console.log(`${label}  ${String(raw.buf.length).padStart(5)}B  SKIPPED: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\ndecoded ${ok}, skipped ${skipped}`);
  console.log(`PNGs in ${OUT}`);
})().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
