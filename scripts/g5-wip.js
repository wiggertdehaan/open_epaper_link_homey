'use strict';

/* eslint-disable */
/**
 * WORK IN PROGRESS - NOT USED BY THE APP, DO NOT WIRE IN YET.
 *
 * This decodes far too few bits per row (it collapses almost every line to a
 * single V0 code) and produces a near-blank image, so the reference-line
 * handling is still wrong somewhere. It is kept only because the container
 * analysis around it is correct and worth not redoing:
 *
 *   - g5 payloads are: 6 byte common header, then 2 unidentified bytes
 *     (0x28 0x80 on every sample seen), then the MMR stream at offset 8.
 *   - starting the decode at offset 8 is the only offset that walks all 296
 *     rows without hitting invalid codes, which is good evidence the stream
 *     really is T.6/MMR and that the prefix is 2 bytes.
 *   - plane 1 appears to follow plane 0 in the same stream.
 *
 * Next step is to instrument the per-row changing-element arrays and compare
 * against a known-good G4 decoder.
 *
 * Decoder for the "G5" bit-planes the OpenEPaperLink AP produces for tag types
 * that advertise `g5_compression`.
 *
 * G5 (bitbank2's library, used by OEPL to cut radio airtime) is a CCITT
 * Group 4 / ITU-T T.6 derivative: two-dimensional MMR coding, each line coded
 * against the line above it, with an imaginary all-white line above the first.
 * This implements T.6 decoding directly, which is what the bitstream turns out
 * to be.
 *
 * A set bit in the output means "black" in G4 terms, i.e. the run colour that
 * is not the initial white. The caller maps that onto the tag's colortable.
 */

// --- run-length code tables (ITU-T T.4) -----------------------------------
// Each entry is [bitLength, codeValue, runLength].

const WHITE_CODES = [
  [8, 0x35, 0], [6, 0x07, 1], [4, 0x07, 2], [4, 0x08, 3], [4, 0x0b, 4],
  [4, 0x0c, 5], [4, 0x0e, 6], [4, 0x0f, 7], [5, 0x13, 8], [5, 0x14, 9],
  [5, 0x07, 10], [5, 0x08, 11], [6, 0x08, 12], [6, 0x03, 13], [6, 0x34, 14],
  [6, 0x35, 15], [6, 0x2a, 16], [6, 0x2b, 17], [7, 0x27, 18], [7, 0x0c, 19],
  [7, 0x08, 20], [7, 0x17, 21], [7, 0x03, 22], [7, 0x04, 23], [7, 0x28, 24],
  [7, 0x2b, 25], [7, 0x13, 26], [7, 0x24, 27], [7, 0x18, 28], [8, 0x02, 29],
  [8, 0x03, 30], [8, 0x1a, 31], [8, 0x1b, 32], [8, 0x12, 33], [8, 0x13, 34],
  [8, 0x14, 35], [8, 0x15, 36], [8, 0x16, 37], [8, 0x17, 38], [8, 0x28, 39],
  [8, 0x29, 40], [8, 0x2a, 41], [8, 0x2b, 42], [8, 0x2c, 43], [8, 0x2d, 44],
  [8, 0x04, 45], [8, 0x05, 46], [8, 0x0a, 47], [8, 0x0b, 48], [8, 0x52, 49],
  [8, 0x53, 50], [8, 0x54, 51], [8, 0x55, 52], [8, 0x24, 53], [8, 0x25, 54],
  [8, 0x58, 55], [8, 0x59, 56], [8, 0x5a, 57], [8, 0x5b, 58], [8, 0x4a, 59],
  [8, 0x4b, 60], [8, 0x32, 61], [8, 0x33, 62], [8, 0x34, 63],
  // makeup codes
  [5, 0x1b, 64], [5, 0x12, 128], [6, 0x17, 192], [7, 0x37, 256],
  [8, 0x36, 320], [8, 0x37, 384], [8, 0x64, 448], [8, 0x65, 512],
  [8, 0x68, 576], [8, 0x67, 640], [9, 0xcc, 704], [9, 0xcd, 768],
  [9, 0xd2, 832], [9, 0xd3, 896], [9, 0xd4, 960], [9, 0xd5, 1024],
  [9, 0xd6, 1088], [9, 0xd7, 1152], [9, 0xd8, 1216], [9, 0xd9, 1280],
  [9, 0xda, 1344], [9, 0xdb, 1408], [9, 0x98, 1472], [9, 0x99, 1536],
  [9, 0x9a, 1600], [6, 0x18, 1664], [9, 0x9b, 1728],
];

const BLACK_CODES = [
  [10, 0x37, 0], [3, 0x02, 1], [2, 0x03, 2], [2, 0x02, 3], [3, 0x03, 4],
  [4, 0x03, 5], [4, 0x02, 6], [5, 0x03, 7], [6, 0x05, 8], [6, 0x04, 9],
  [7, 0x04, 10], [7, 0x05, 11], [7, 0x07, 12], [8, 0x04, 13], [8, 0x07, 14],
  [9, 0x18, 15], [10, 0x17, 16], [10, 0x18, 17], [10, 0x08, 18],
  [11, 0x67, 19], [11, 0x68, 20], [11, 0x6c, 21], [11, 0x37, 22],
  [11, 0x28, 23], [11, 0x17, 24], [11, 0x18, 25], [12, 0xca, 26],
  [12, 0xcb, 27], [12, 0xcc, 28], [12, 0xcd, 29], [12, 0x68, 30],
  [12, 0x69, 31], [12, 0x6a, 32], [12, 0x6b, 33], [12, 0xd2, 34],
  [12, 0xd3, 35], [12, 0xd4, 36], [12, 0xd5, 37], [12, 0xd6, 38],
  [12, 0xd7, 39], [12, 0x6c, 40], [12, 0x6d, 41], [12, 0xda, 42],
  [12, 0xdb, 43], [12, 0x54, 44], [12, 0x55, 45], [12, 0x56, 46],
  [12, 0x57, 47], [12, 0x64, 48], [12, 0x65, 49], [12, 0x52, 50],
  [12, 0x53, 51], [12, 0x24, 52], [12, 0x37, 53], [12, 0x38, 54],
  [12, 0x27, 55], [12, 0x28, 56], [12, 0x58, 57], [12, 0x59, 58],
  [12, 0x2b, 59], [12, 0x2c, 60], [12, 0x5a, 61], [12, 0x66, 62],
  [12, 0x67, 63],
  // makeup codes
  [10, 0x0f, 64], [12, 0xc8, 128], [12, 0xc9, 192], [12, 0x5b, 256],
  [12, 0x33, 320], [12, 0x34, 384], [12, 0x35, 448], [13, 0x6c, 512],
  [13, 0x6d, 576], [13, 0x4a, 640], [13, 0x4b, 704], [13, 0x4c, 768],
  [13, 0x4d, 832], [13, 0x72, 896], [13, 0x73, 960], [13, 0x74, 1024],
  [13, 0x75, 1088], [13, 0x76, 1152], [13, 0x77, 1216], [13, 0x52, 1280],
  [13, 0x53, 1344], [13, 0x54, 1408], [13, 0x55, 1472], [13, 0x5a, 1536],
  [13, 0x5b, 1600], [13, 0x64, 1664], [13, 0x65, 1728],
];

// Extended makeup codes, shared by both colours.
const SHARED_CODES = [
  [11, 0x08, 1792], [11, 0x0c, 1856], [11, 0x0d, 1920], [12, 0x12, 1984],
  [12, 0x13, 2048], [12, 0x14, 2112], [12, 0x15, 2176], [12, 0x16, 2240],
  [12, 0x17, 2304], [12, 0x1c, 2368], [12, 0x1d, 2432], [12, 0x1e, 2496],
  [12, 0x1f, 2560],
];

function buildLookup(codes) {
  const map = new Map();
  for (const [len, val, run] of codes) map.set(`${len}:${val}`, run);
  return map;
}

const WHITE_LOOKUP = buildLookup(WHITE_CODES.concat(SHARED_CODES));
const BLACK_LOOKUP = buildLookup(BLACK_CODES.concat(SHARED_CODES));
const MAX_CODE_BITS = 14;

class BitReader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0; // bit position
  }

  get exhausted() {
    return this.pos >= this.buf.length * 8;
  }

  peek(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const p = this.pos + i;
      const bit = p < this.buf.length * 8
        ? (this.buf[p >> 3] >> (7 - (p & 7))) & 1
        : 0;
      v = (v << 1) | bit;
    }
    return v;
  }

  skip(n) { this.pos += n; }

  read(n) { const v = this.peek(n); this.pos += n; return v; }
}

/** Reads one complete run length (makeup codes followed by a terminating code). */
function readRun(br, white) {
  const lookup = white ? WHITE_LOOKUP : BLACK_LOOKUP;
  let total = 0;

  for (let guard = 0; guard < 64; guard++) {
    let run = null;
    let used = 0;
    for (let len = white ? 4 : 2; len <= MAX_CODE_BITS; len++) {
      const hit = lookup.get(`${len}:${br.peek(len)}`);
      if (hit !== undefined) { run = hit; used = len; break; }
    }
    if (run === null) return null;
    br.skip(used);
    total += run;
    if (run < 64) return total; // terminating code
    // makeup code (>= 64): another code follows
  }
  return null;
}

/**
 * Decodes a T.6 (MMR) stream into a 1bpp bitmap, MSB first, set bit == black.
 *
 * @param {Buffer} data    the compressed stream
 * @param {number} width   image width in pixels
 * @param {number} height  image height in pixels
 * @returns {{plane: Buffer, bytesUsed: number}}
 */
function decodeG4(data, width, height) {
  const rowBytes = Math.ceil(width / 8);
  const plane = Buffer.alloc(rowBytes * height, 0);
  const br = new BitReader(data);

  // Changing elements of the reference line. The imaginary line above the
  // first one is all white, so it has no changing elements before `width`.
  let ref = [width, width];

  for (let y = 0; y < height; y++) {
    const cur = [];
    let a0 = -1;
    let color = 0; // 0 = white, 1 = black

    while (a0 < width) {
      if (br.exhausted) {
        // Truncated stream: keep whatever we decoded rather than throwing.
        return { plane, bytesUsed: data.length, truncated: true, rows: y };
      }

      // b1: first changing element on the reference line to the right of a0
      //     with the opposite colour of a0's colour run.
      let b1 = width;
      for (let i = 0; i < ref.length; i++) {
        if (ref[i] > (a0 < 0 ? -1 : a0)) {
          // changing elements alternate colour starting with white->black
          if ((i & 1) === color) { b1 = ref[i]; break; }
        }
      }
      let b2 = width;
      for (let i = 0; i < ref.length; i++) {
        if (ref[i] > b1) { b2 = ref[i]; break; }
      }

      // --- mode code ---
      if (br.peek(1) === 1) {                 // V0  : 1
        br.skip(1);
        cur.push(b1); a0 = b1; color ^= 1;
      } else if (br.peek(3) === 0b011) {      // VR1 : 011
        br.skip(3);
        cur.push(b1 + 1); a0 = b1 + 1; color ^= 1;
      } else if (br.peek(3) === 0b010) {      // VL1 : 010
        br.skip(3);
        cur.push(b1 - 1); a0 = b1 - 1; color ^= 1;
      } else if (br.peek(3) === 0b001) {      // H   : 001
        br.skip(3);
        const r1 = readRun(br, color === 0);
        const r2 = readRun(br, color !== 0);
        if (r1 === null || r2 === null) {
          return { plane, bytesUsed: data.length, truncated: true, rows: y };
        }
        const start = a0 < 0 ? 0 : a0;
        const a1 = Math.min(start + r1, width);
        const a2 = Math.min(a1 + r2, width);
        cur.push(a1, a2);
        a0 = a2;
        // colour is unchanged after a horizontal pair
      } else if (br.peek(4) === 0b0001) {     // Pass: 0001
        br.skip(4);
        a0 = b2;
      } else if (br.peek(6) === 0b000011) {   // VR2
        br.skip(6);
        cur.push(b1 + 2); a0 = b1 + 2; color ^= 1;
      } else if (br.peek(6) === 0b000010) {   // VL2
        br.skip(6);
        cur.push(b1 - 2); a0 = b1 - 2; color ^= 1;
      } else if (br.peek(7) === 0b0000011) {  // VR3
        br.skip(7);
        cur.push(b1 + 3); a0 = b1 + 3; color ^= 1;
      } else if (br.peek(7) === 0b0000010) {  // VL3
        br.skip(7);
        cur.push(b1 - 3); a0 = b1 - 3; color ^= 1;
      } else {
        // EOFB / EOL / garbage - stop here.
        return { plane, bytesUsed: (br.pos + 7) >> 3, truncated: y + 1 < height, rows: y };
      }
    }

    // Paint the row from its changing elements: runs alternate starting white.
    const rowOffset = y * rowBytes;
    let x = 0;
    let paint = 0;
    for (let i = 0; i < cur.length && x < width; i++) {
      const next = Math.max(0, Math.min(cur[i], width));
      if (paint === 1) {
        for (let px = x; px < next; px++) {
          plane[rowOffset + (px >> 3)] |= 0x80 >> (px & 7);
        }
      }
      x = next;
      paint ^= 1;
    }
    if (paint === 1) {
      for (let px = x; px < width; px++) {
        plane[rowOffset + (px >> 3)] |= 0x80 >> (px & 7);
      }
    }

    // Normalise the reference line for the next row.
    ref = cur.slice();
    ref.push(width, width);
  }

  return { plane, bytesUsed: (br.pos + 7) >> 3, truncated: false, rows: height };
}

module.exports = { decodeG4, BitReader };
