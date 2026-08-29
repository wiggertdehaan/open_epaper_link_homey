'use strict';

const zlib = require('zlib');

/**
 * Decoder for the framebuffer files the OpenEPaperLink AP stores under
 * /current/<mac>.raw.
 *
 * Those files are NOT bare framebuffers. The AP serves /current as a plain
 * static directory (see ESP32_AP-Flasher/src/web.cpp), so what you download is
 * the transmit-ready file exactly as it is stored, which means it may be
 * compressed. Which container is used is advertised per tag type:
 *
 *   "zlib_compression": "27"  -> uint32 LE payload length, then a zlib stream
 *   "g5_compression":   "29"  -> G5 (CCITT-G4 derived) stream, not yet supported
 *   neither                   -> stored uncompressed
 *
 * Once unwrapped, every payload starts with the same 6 byte header:
 *
 *   offset 0 : 0x06   magic
 *   offset 1 : uint16 LE  buffer width
 *   offset 3 : uint16 LE  buffer height
 *   offset 5 : uint8      bits per pixel
 *
 * The header carries the *buffer* geometry, which for tag types with
 * rotatebuffer set is the panel's native orientation and therefore has width
 * and height swapped relative to the tag type. Trusting the header instead of
 * guessing from rotatebuffer is what keeps the unpacking stride correct.
 *
 * After the header come `bpp` consecutive bit-planes, each ceil(w*h/8) bytes,
 * MSB first. The pixel value is the plane bits combined little-end first
 * (plane0 | plane1<<1), and indexes directly into the tag type's colortable.
 */

const HEADER_MAGIC = 0x06;
const HEADER_SIZE = 6;

/** Reads and sanity-checks the 6 byte payload header. */
function readHeader(buf) {
  if (!buf || buf.length < HEADER_SIZE) return null;
  if (buf[0] !== HEADER_MAGIC) return null;

  const width = buf.readUInt16LE(1);
  const height = buf.readUInt16LE(3);
  const bpp = buf[5];

  if (width < 1 || height < 1 || width > 4096 || height > 4096) return null;
  if (bpp < 1 || bpp > 4) return null;

  return { width, height, bpp };
}

/**
 * Strips the transport container and returns the plain payload
 * (6 byte header + bit-planes), or null if it cannot be unwrapped.
 */
function unwrap(data) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length < HEADER_SIZE) return { payload: null, container: 'empty' };

  // Already plain?
  if (readHeader(data)) return { payload: data, container: 'raw' };

  // zlib container: uint32 LE uncompressed length, then the deflate stream.
  if (data.length > 4) {
    const declared = data.readUInt32LE(0);
    if (declared > HEADER_SIZE && declared <= 4 * 1024 * 1024) {
      try {
        const inflated = zlib.inflateSync(data.subarray(4));
        if (inflated.length === declared && readHeader(inflated)) {
          return { payload: inflated, container: 'zlib' };
        }
      } catch (err) {
        // not a zlib container after all, fall through
      }
    }
  }

  return { payload: null, container: 'unknown' };
}

/**
 * Decodes an AP framebuffer file into flat RGB pixel data.
 *
 * @param {Buffer} data      bytes as downloaded from /current/<mac>.raw
 * @param {object} tagType   the tag type JSON from /tagtypes/<hw>.json
 * @returns {{width:number,height:number,rgb:Buffer,container:string,rotated:boolean}|null}
 *          null when the buffer cannot be decoded (caller should keep the
 *          previous image rather than render garbage)
 */
function decodeRawImage(data, tagType) {
  const { payload, container } = unwrap(data);
  if (!payload) {
    const reason = tagType && tagType.g5_compression
      ? 'g5-compressed (not supported)'
      : `unrecognised container (${container})`;
    const err = new Error(`Cannot decode raw buffer: ${reason}`);
    err.container = container;
    err.unsupported = true;
    throw err;
  }

  const header = readHeader(payload);
  const { width, height, bpp } = header;

  const body = payload.subarray(HEADER_SIZE);
  const planeBytes = Math.ceil((width * height) / 8);
  const planes = Math.min(bpp, Math.floor(body.length / planeBytes));

  if (planes < 1) {
    throw new Error(`Raw buffer too short: ${body.length} bytes for ${width}x${height} (need ${planeBytes})`);
  }

  // colortable order defines the palette: index == combined pixel value.
  const palette = Object.values((tagType && tagType.colortable) || {});
  if (palette.length === 0) throw new Error('Tag type has no colortable');

  const rgb = Buffer.alloc(width * height * 3);

  for (let i = 0; i < planeBytes; i++) {
    for (let j = 0; j < 8; j++) {
      const pixelIndex = i * 8 + j;
      if (pixelIndex >= width * height) break;

      const mask = 1 << (7 - j);
      let value = 0;
      for (let p = 0; p < planes; p++) {
        if (body[i + p * planeBytes] & mask) value |= 1 << p;
      }

      const c = palette[value] || palette[0];
      const o = pixelIndex * 3;
      rgb[o] = c[0];
      rgb[o + 1] = c[1];
      rgb[o + 2] = c[2];
    }
  }

  // The buffer is stored in the panel's native orientation. When that is
  // rotated relative to the tag type, the caller has to rotate it upright.
  const rotated = Boolean(tagType
    && width === tagType.height
    && height === tagType.width
    && tagType.width !== tagType.height);

  return { width, height, rgb, container, rotated, bpp, planes };
}

module.exports = { decodeRawImage, readHeader, unwrap, HEADER_SIZE };
