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
 *   "zlib_compression": "<minver>"  -> uint32 LE payload length, then zlib
 *   "g5_compression":   "<minver>"  -> Larry Bank's G5, not decoded here
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
 * and height swapped relative to the tag type. For bpp == 2 the two bit-planes
 * are stored as one image of double height.
 *
 * After the header the planes are consecutive, each ceil(w*h/8) bytes, MSB
 * first. The pixel value is plane0 | plane1<<1 and indexes directly into the
 * tag type's colortable.
 *
 * This mirrors drawCanvas()/processZlib() in the AP's own wwwroot/main.js, so
 * previews match what the AP's web UI draws.
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

  return {
    headerSize, width, height, bpp,
  };
}

/**
 * Geometry for a buffer that carries no header at all.
 *
 * AP firmware 2.8x stores /current/<mac>.raw as bare bit-planes: no header
 * and no compression, regardless of the tag type's zlib_compression and
 * g5_compression fields. Those two are the minimum AP firmware version that
 * supports the feature for the tag type, not a statement about this file.
 *
 * Accepting such a buffer means trusting the tag type's geometry rather than
 * a header, so require the length to be an exact multiple of the plane size
 * that geometry implies. A compressed, truncated or foreign buffer will not
 * line up.
 */
function bareHeader(buf, tagType) {
  if (!buf || !tagType || !tagType.width || !tagType.height) return null;

  // rotatebuffer counts quarter turns; an odd count means the buffer is
  // stored in the panel's other orientation, so its width and height are
  // swapped relative to the tag type.
  const swapped = Number(tagType.rotatebuffer || 0) % 2 === 1;
  const width = swapped ? tagType.height : tagType.width;
  const height = swapped ? tagType.width : tagType.height;

  const planeBytes = Math.ceil((width * height) / 8);
  if (planeBytes === 0 || buf.length === 0 || buf.length % planeBytes !== 0) return null;

  // Fewer planes than the tag type's bpp is normal: a tag showing only black
  // and white has no second plane stored.
  const planes = buf.length / planeBytes;
  if (planes < 1 || planes > (tagType.bpp || 1)) return null;

  return {
    headerSize: 0, width, height, bpp: planes,
  };
}

/**
 * Strips the transport container and returns { payload, container }.
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
      } catch {
        // not a zlib container after all, fall through
      }
    }
  }

  // Last resort: no header and no container, just the planes. Checked last so
  // a buffer that does carry a header is never reinterpreted as bare.
  if (bareHeader(data, tagType)) return { payload: data, container: 'bare' };

  return { payload: null, container: 'unknown' };
}

/**
 * Decodes an AP framebuffer file into flat RGB pixel data.
 *
 * @param {Buffer} data      bytes as downloaded from /current/<mac>.raw
 * @param {object} tagType   the tag type JSON from /tagtypes/<hw>.json
 * @returns {{width:number,height:number,rgb:Buffer,container:string,rotateDegrees:number,planes:number}}
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

  const header = readHeader(payload, tagType) || bareHeader(payload, tagType);
  if (!header) throw new Error('Cannot decode raw buffer: no usable geometry');
  const {
    headerSize, width, height, bpp,
  } = header;

  const body = payload.subarray(headerSize);
  const planeBytes = Math.ceil((width * height) / 8);

  if (body.length < planeBytes) {
    // Tag types that advertise g5_compression store the planes as a G5
    // stream, which is not decoded here. Refusing is deliberate: unpacking a
    // compressed stream as if it were bit-planes produces black-and-white
    // noise on the device tile, which is worse than keeping the last image.
    const reason = tagType && tagType.g5_compression
      ? 'g5-compressed buffers are not supported yet'
      : `body is ${body.length} bytes, need ${planeBytes} for ${width}x${height}`;
    throw new Error(`Cannot decode raw buffer: ${reason}`);
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

  // rotatebuffer says how the stored buffer is turned relative to the tag
  // type: odd values are a quarter turn (1 and 3 in opposite directions) and
  // 2 is upside down.
  const rb = Number((tagType && tagType.rotatebuffer) || 0);
  let rotateDegrees = 0;
  if (rb === 1) rotateDegrees = -90;
  else if (rb === 3) rotateDegrees = 90;
  else if (rb === 2) rotateDegrees = 180;

  return {
    width, height, rgb, container, bpp, planes, rotateDegrees,
  };
}

module.exports = {
  decodeRawImage, readHeader, bareHeader, unwrap,
};
