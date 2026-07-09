/**
 * Minimal dependency-free PNG encoder: 8-bit RGB (colour type 2), filter
 * type 0 (None) on every scanline. The only outside code used is the raw
 * DEFLATE implementation injected from node:zlib (a Node builtin, not an
 * npm dependency); signature, chunk framing, and CRC-32 are implemented
 * here and unit-tested against known answers.
 */
import { deflateSync, inflateSync } from 'node:zlib';

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

export interface DecodedPng {
  width: number;
  height: number;
  /** 3 for truecolour RGB (type 2), 4 for RGBA (type 6). */
  channels: 3 | 4;
  /** Row-major pixels, `channels` bytes per pixel. */
  pixels: Uint8Array;
}

/** PNG Paeth predictor (a = left, b = above, c = upper-left). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Minimal dependency-free PNG decoder mirroring the encoder: 8-bit truecolour
 * RGB / RGBA, non-interlaced, all five scanline filters (None/Sub/Up/Average/
 * Paeth). Chunk CRCs are verified; INFLATE comes from the node:zlib builtin.
 */
export function decodePng(bytes: Uint8Array): DecodedPng {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG (bad signature)');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels: 3 | 4 = 3;
  const idat: Uint8Array[] = [];

  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const typeStart = pos + 4;
    const type = String.fromCharCode(
      bytes[typeStart]!,
      bytes[typeStart + 1]!,
      bytes[typeStart + 2]!,
      bytes[typeStart + 3]!,
    );
    const dataStart = typeStart + 4;
    const data = bytes.subarray(dataStart, dataStart + len);
    const crcStored = view.getUint32(dataStart + len);
    if (crc32(bytes.subarray(typeStart, dataStart + len)) !== crcStored) {
      throw new Error(`PNG chunk ${type} failed CRC check`);
    }
    pos = dataStart + len + 4;

    if (type === 'IHDR') {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = dv.getUint32(0);
      height = dv.getUint32(4);
      if (data[8] !== 8) throw new Error(`unsupported PNG bit depth ${data[8]}`);
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
      const colourType = data[9];
      if (colourType === 2) channels = 3;
      else if (colourType === 6) channels = 4;
      else throw new Error(`unsupported PNG colour type ${colourType}`);
    } else if (type === 'IDAT') {
      idat.push(data.slice());
    } else if (type === 'IEND') {
      break;
    }
  }
  if (width === 0 || height === 0) throw new Error('PNG missing IHDR');

  const raw = inflateSync(Buffer.concat(idat.map((p) => Buffer.from(p))));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  let prev: Uint8Array | null = null;
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride);
    const filter = raw[rowStart]!;
    const cur = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowStart + 1 + x]!;
      const a = x >= channels ? cur[x - channels]! : 0;
      const b = prev ? prev[x]! : 0;
      const c = prev && x >= channels ? prev[x - channels]! : 0;
      let recon: number;
      switch (filter) {
        case 0:
          recon = rawByte;
          break;
        case 1:
          recon = rawByte + a;
          break;
        case 2:
          recon = rawByte + b;
          break;
        case 3:
          recon = rawByte + ((a + b) >> 1);
          break;
        case 4:
          recon = rawByte + paeth(a, b, c);
          break;
        default:
          throw new Error(`unknown PNG filter type ${filter}`);
      }
      cur[x] = recon & 0xff;
    }
    prev = cur;
  }
  return { width, height, channels, pixels };
}

export const GAMMA = 2.2;

/** Tone-mapping operator applied to linear radiance before the gamma encode. */
export type ToneMapOp = 'linear' | 'reinhard' | 'aces';

/** ACES filmic approximation (Narkowicz 2015): maps [0, inf) into [0, 1). */
function acesFilmic(x: number): number {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return (x * (a * x + b)) / (x * (c * x + d) + e);
}

/**
 * Map linear HDR radiance to 8-bit values: apply exposure, a tone-mapping
 * operator (`linear` clip / `reinhard` / `aces`), then the gamma 2.2 encode.
 * The defaults (linear, exposure 1) reproduce the original plain-gamma output.
 */
export function toneMap(hdr: Float64Array, op: ToneMapOp = 'linear', exposure = 1): Uint8Array {
  const out = new Uint8Array(hdr.length);
  const inv = 1 / GAMMA;
  for (let i = 0; i < hdr.length; i++) {
    const raw = hdr[i]!;
    const v = Number.isNaN(raw) ? 0 : Math.max(0, raw * exposure);
    let mapped: number;
    switch (op) {
      case 'reinhard':
        mapped = v / (1 + v);
        break;
      case 'aces':
        mapped = acesFilmic(v);
        break;
      default:
        mapped = Math.min(1, v);
    }
    out[i] = Math.round(255 * Math.pow(Math.min(1, Math.max(0, mapped)), inv));
  }
  return out;
}
