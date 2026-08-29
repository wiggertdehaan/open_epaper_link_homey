'use strict';

const zlib = require('zlib');
const { processG5 } = require('./vendor/g5decoder');

/**
 * Decoder for the framebuffer files the OpenEPaperLink AP stores under
 * /current/<mac>.raw.
 *
 * Those files are NOT bare framebuffers. The AP serves /current as a plain
 * static directory (see ESP32_AP-Flasher/src/web.cpp), so what you download is
 * the transmit-ready file exactly as it is stored, which means it may be
 * compressed. Which container is used is advertised per tag type:
 *
 *   "zlib_compression": "<minver>"  -> uint32 LE payload length, then zlib
 *   "g5_compression":   "<minver>"  -> Larry Bank's G5, decoded by the
 *                                      vendored decoder from the AP itself
 *   neither                         -> stored uncompressed
 *
 * Every payload starts with a small header, and its first byte is the header's
 * own length (6 in every build seen so far):
 *
 *   offset 0 : uint8      header size
 *   offset 1 : uint16 LE  buffer width
 *   offset 3 : uint16 LE  buffer height
 *   offset 5 : uint8      bits per pixel
 *
 * The header carries the *buffer* geometry, which for tag types with
 * rotatebuffer set is the panel's native orientation and therefore has width
 * and height swapped relative to the tag type.
 *
 * For bpp == 2 the two bit-planes are stored as one image of double height,
 * which matters for G5: the whole thing is a single stream, not two.
 *
 * After decoding, the planes are consecutive, each ceil(w*h/8) bytes, MSB
 * first. The pixel value is plane0 | plane1<<1 and indexes directly into the
 * tag type's colortable.
 *
 * This mirrors drawCanvas()/processZlib() in the AP's own wwwroot/main.js, so
 * previews here match what the AP's web UI draws.
 */

/** Reads and sanity-checks the payload header. */
function readHeader(buf, tagType) {
  if (!buf || buf.length < 6) return null;

  const headerSize = buf[0];
  if (headerSize < 6 || headerSize > 16 || buf.length <= headerSize) return null;

  const width = buf.readUInt16LE(1);
  const height = buf.readUInt16LE(3);
  const bpp = buf[5];

  if (bpp < 1 || bpp > 3) return null;

  // The AP validates the header by checking the dimensions against the tag
  // type in either orientation; do the same so a stray buffer cannot be
  // mistaken for a valid one.
  if (tagType && tagType.width && tagType.height) {
    const fitsW = width === tagType.width || width === tagType.height;
    const fitsH = height === tagType.width || height === tagType.height;
    if (!fitsW || !fitsH) return null;
  } else if (width < 1 || height < 1 || width > 4096 || height > 4096) {
    return null;
  }

  return { headerSize, width, height, bpp };
}

/**
 * Strips the transport container and returns { payload, container }, where
 * payload is header + (possibly still G5-compressed) body.
 */
function unwrap(data, tagType) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (data.length < 6) return { payload: null, container: 'empty' };

  if (readHeader(data, tagType)) return { payload: data, container: 'raw' };

  // zlib container: uint32 LE uncompressed length, then the deflate stream.
  if (data.length > 4) {
    const declared = data.readUInt32LE(0);
    if (declared > 6 && declared <= 8 * 1024 * 1024) {
      try {
        const inflated = zlib.inflateSync(data.subarray(4));
        if (inflated.length === declared && readHeader(inflated, tagType)) {
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
 * @returns {{width:number,height:number,rgb:Buffer,container:string,rotated:boolean,planes:number}}
 * @throws when the buffer cannot be decoded, so the caller can keep the
 *         previous image rather than render noise
 */
function decodeRawImage(data, tagType) {
  const { payload, container } = unwrap(data, tagType);
  if (!payload) {
    const err = new Error(`Cannot decode raw buffer: unrecognised container (${container})`);
    err.container = container;
    throw err;
  }

  const header = readHeader(payload, tagType);
  const { headerSize, width, height, bpp } = header;

  let body = payload.subarray(headerSize);
  let usedContainer = container;

  const planeBytes = Math.ceil((width * height) / 8);

  // G5: the planes are one stream of double height when bpp is 2.
  if (body.length < planeBytes * Math.min(bpp, 2)) {
    if (!(tagType && tagType.g5_compression)) {
      throw new Error(`Raw buffer too short: ${body.length} bytes for ${width}x${height}`
        + ` (need ${planeBytes} per plane) and tag type claims no G5 compression`);
    }
    const streamHeight = bpp === 2 ? height * 2 : height;
    const decoded = processG5(body, width, streamHeight);
    if (!decoded) throw new Error('G5 decoding failed');
    body = Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    usedContainer = container === 'raw' ? 'g5' : `${container}+g5`;
  }

  const planes = Math.min(bpp, Math.max(1, Math.floor(body.length / planeBytes)));

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

  // The buffer is stored in the panel's native orientation. rotatebuffer says
  // how it is turned relative to the tag type: odd values are a quarter turn
  // (1 and 3 in opposite directions), and 2 is upside down.
  const rb = Number((tagType && tagType.rotatebuffer) || 0);
  let rotateDegrees = 0;
  if (rb === 1) rotateDegrees = -90;
  else if (rb === 3) rotateDegrees = 90;
  else if (rb === 2) rotateDegrees = 180;

  return {
    width, height, rgb, container: usedContainer, bpp, planes,
    rotateDegrees, rotated: rotateDegrees !== 0,
  };
}

module.exports = { decodeRawImage, readHeader, unwrap };
