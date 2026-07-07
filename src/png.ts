/**
 * Minimal dependency-free PNG encoder: 8-bit RGB (colour type 2), filter
 * type 0 (None) on every scanline. The only outside code used is the raw
 * DEFLATE implementation injected from node:zlib (a Node builtin, not an
 * npm dependency); signature, chunk framing, and CRC-32 are implemented
 * here and unit-tested against known answers.
 */
import { deflateSync } from 'node:zlib';

export const PNG_SIGNATURE: Uint8Array = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** CRC-32 (ISO 3309 / ITU-T V.42), as required by the PNG spec. */
export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = (table[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode an 8-bit RGB buffer (length = width * height * 3) as a PNG file. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid PNG dimensions ${width}x${height}`);
  }
  if (rgb.length !== width * height * 3) {
    throw new Error(`pixel buffer length ${rgb.length} != ${width * height * 3}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method 0
  ihdr[12] = 0; // no interlace

  // Raw image stream: one filter byte (0 = None) before each scanline.
  const stride = width * 3;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride);
    raw[rowStart] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export const GAMMA = 2.2;

/** Map linear radiance to 8-bit sRGB-ish values with a plain gamma 2.2 curve. */
export function toneMap(hdr: Float64Array): Uint8Array {
  const out = new Uint8Array(hdr.length);
  const inv = 1 / GAMMA;
  for (let i = 0; i < hdr.length; i++) {
    const v = hdr[i]!;
    const clamped = Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v));
    out[i] = Math.round(255 * Math.pow(clamped, inv));
  }
  return out;
}
