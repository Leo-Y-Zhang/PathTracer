import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { crc32, decodePng, encodePng, PNG_SIGNATURE } from '../src/png.js';
import { ImageTexture } from '../src/texture.js';
import { vec3 } from '../src/vec3.js';
import { expectVecClose } from './helpers.js';

const ZERO = vec3(0, 0, 0);

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function frameChunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Build an 8-bit RGB PNG applying the given per-row filter types (forward). */
function buildFilteredPng(width: number, height: number, rgb: Uint8Array, filters: number[]): Buffer {
  const channels = 3;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (1 + stride));
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = filters[y]!;
    const rowStart = y * (1 + stride);
    raw[rowStart] = f;
    const cur = rgb.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let filt: number;
      switch (f) {
        case 1: filt = cur[x]! - a; break;
        case 2: filt = cur[x]! - b; break;
        case 3: filt = cur[x]! - ((a + b) >> 1); break;
        case 4: filt = cur[x]! - paeth(a, b, c); break;
        default: filt = cur[x]!;
      }
      raw[rowStart + 1 + x] = filt & 0xff;
    }
    prev = cur.slice();
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    frameChunk('IHDR', ihdr),
    frameChunk('IDAT', deflateSync(raw)),
    frameChunk('IEND', new Uint8Array(0)),
  ]);
}

describe('decodePng', () => {
  it('round-trips the encoder (filter 0, RGB)', () => {
    const w = 5;
    const h = 3;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37 + 11) % 256;
    const d = decodePng(encodePng(w, h, rgb));
    expect(d.width).toBe(w);
    expect(d.height).toBe(h);
    expect(d.channels).toBe(3);
    expect(Array.from(d.pixels)).toEqual(Array.from(rgb));
  });

  it('reconstructs every scanline filter (Sub/Up/Average/Paeth)', () => {
    const w = 3;
    const h = 4;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 53 + 7) % 256;
    const d = decodePng(buildFilteredPng(w, h, rgb, [1, 2, 3, 4]));
    expect(Array.from(d.pixels)).toEqual(Array.from(rgb));
  });

  it('rejects a non-PNG buffer', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/bad signature/);
  });

  it('throws when the inflated data is too short for the declared dimensions', () => {
    // IHDR claims height 3 but only two scanlines of raw data are provided.
    const w = 2;
    const stride = w * 3;
    const raw = Buffer.alloc(2 * (1 + stride));
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(3, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const png = Buffer.concat([
      Buffer.from(PNG_SIGNATURE),
      frameChunk('IHDR', ihdr),
      frameChunk('IDAT', deflateSync(raw)),
      frameChunk('IEND', new Uint8Array(0)),
    ]);
    expect(() => decodePng(png)).toThrow(/too short/);
  });
});

describe('ImageTexture', () => {
  it('samples decoded pixels (v-flipped, gamma-decoded to linear)', () => {
    // 2x2: top-left red, top-right green, bottom-left blue, bottom-right white
    const rgb = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const tex = ImageTexture.fromPng(encodePng(2, 2, rgb));
    // top row is texture v near 1 (v is flipped on sample)
    expectVecClose(tex.sample(0.25, 0.75, ZERO), vec3(1, 0, 0)); // top-left
    expectVecClose(tex.sample(0.75, 0.75, ZERO), vec3(0, 1, 0)); // top-right
    expectVecClose(tex.sample(0.25, 0.25, ZERO), vec3(0, 0, 1)); // bottom-left
    expectVecClose(tex.sample(0.75, 0.25, ZERO), vec3(1, 1, 1)); // bottom-right
  });

  it('wraps UVs outside [0,1)', () => {
    const rgb = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const tex = ImageTexture.fromPng(encodePng(2, 2, rgb));
    expectVecClose(tex.sample(1.25, 0.75, ZERO), tex.sample(0.25, 0.75, ZERO));
  });
});
