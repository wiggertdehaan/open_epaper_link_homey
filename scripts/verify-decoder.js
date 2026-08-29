/* eslint-disable no-console */
/**
 * Verifies lib/rawImage.js against the live AP.
 *
 * Downloads every tag's /current/<mac>.raw plus its tag type, decodes it, and
 * writes a PNG per tag so the result can be eyeballed against the physical
 * display. Prints a table of container / geometry / outcome.
 *
 * Usage: node scripts/verify-decoder.js [ap-ip] [outdir]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const { decodeRawImage } = require('../lib/rawImage');

const AP = process.argv[2] || '192.168.111.179';
const OUT = process.argv[3] || path.join(__dirname, '..', '.tmp-decode');

function get(p, timeout = 10000) {
  return new Promise((resolve) => {
    const req = http.get(`http://${AP}${p}`, { timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, buf: Buffer.alloc(0) }); });
    req.on('error', () => resolve({ status: 0, buf: Buffer.alloc(0) }));
  });
}

async function toJimp(decoded) {
  const img = new Jimp(decoded.width, decoded.height, 0xffffffff);
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

  const db = await get('/get_db?pos=%3Ccontinu%3E');
  if (db.status !== 200) {
    console.error(`Cannot reach AP at ${AP} (status ${db.status})`);
    process.exit(1);
  }
  const tags = JSON.parse(db.buf.toString('utf8')).tags || [];
  console.log(`AP ${AP}: ${tags.length} tags\n`);

  const typeCache = {};
  let ok = 0;
  let failed = 0;

  for (const tag of tags) {
    const hex = Number(tag.hwType).toString(16).padStart(2, '0').toUpperCase();
    if (!typeCache[hex]) {
      const r = await get(`/tagtypes/${hex}.json`);
      typeCache[hex] = r.status === 200 ? JSON.parse(r.buf.toString('utf8')) : null;
    }
    const tt = typeCache[hex];
    const label = `${tag.mac} ${(tag.alias || '-').padEnd(8)} hw=0x${hex}`;

    if (!tt) { console.log(`${label}  NO TAGTYPE`); failed++; continue; }

    const raw = await get(`/current/${tag.mac}.raw`);
    if (raw.status !== 200 || raw.buf.length === 0) {
      console.log(`${label}  no .raw on AP`);
      continue;
    }

    try {
      const dec = decodeRawImage(raw.buf, tt);
      const img = await toJimp(dec);
      const file = path.join(OUT, `${tag.mac}.png`);
      await img.writeAsync(file);
      console.log(`${label}  ${String(raw.buf.length).padStart(5)}B ${dec.container.padEnd(4)}`
        + ` buf=${dec.width}x${dec.height} planes=${dec.planes}`
        + ` rot=${String(dec.rotateDegrees).padStart(4)} -> ${img.bitmap.width}x${img.bitmap.height} OK`);
      ok++;
    } catch (err) {
      console.log(`${label}  ${String(raw.buf.length).padStart(5)}B  SKIPPED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\ndecoded ${ok}, skipped ${failed}`);
  console.log(`PNGs in ${OUT}`);
})();
